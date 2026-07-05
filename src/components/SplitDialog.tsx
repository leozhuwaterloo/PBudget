"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";

// Shared N-part split dialog (FR5). Used from the Accounts raw browser
// (TransactionBrowser) and from eligible Review rows. Amounts must sum EXACTLY to
// the parent and share its sign (the F5 API re-validates in integer cents). Each
// part's category select DEFAULTS to the parent's currently-resolved category but
// stores nothing for it (null → resolves live through the parent's waterfall;
// never snapshotted). Amounts stay Plaid-convention (+ = outflow), same as the
// stored parent, so parts sum to parent.amount as stored.

// Minimal parent shape the dialog needs — BrowserTxn (Accounts) and Review's
// transaction rows both satisfy it. `category` is only the default-option label
// (never sent); null renders "—" when the caller doesn't resolve it.
export type SplitParent = {
  transactionId: string;
  name: string;
  amount: number;
  currency: string | null;
  category: string | null;
};

type Cat = { id: string; name: string };

const money = (amount: number, currency: string | null) => `${currency ? currency + " " : ""}${amount.toFixed(2)}`;

function evenSplit(total: number, n: number): string[] {
  const totalC = Math.round(total * 100);
  const base = Math.trunc(totalC / n);
  const rem = totalC - base * n; // same sign as total
  return Array.from({ length: n }, (_, i) => (((i === 0 ? base + rem : base) as number) / 100).toFixed(2));
}

export default function SplitDialog({ parent, onClose, onDone }: { parent: SplitParent; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [amounts, setAmounts] = useState<string[]>(() => evenSplit(parent.amount, 2));
  const [labels, setLabels] = useState<string[]>(["", ""]);
  const [cats, setCats] = useState<string[]>(["", ""]);
  const [categories, setCategories] = useState<Cat[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/categories");
      const d = await res.json().catch(() => ({}));
      if (res.ok) setCategories(d.categories ?? []);
    })();
  }, []);

  const n = amounts.length;
  const setCount = (next: number) => {
    setAmounts(evenSplit(parent.amount, next));
    setLabels((l) => Array.from({ length: next }, (_, i) => l[i] ?? ""));
    setCats((c) => Array.from({ length: next }, (_, i) => c[i] ?? ""));
  };
  const editAmount = (i: number, v: string) => setAmounts((a) => a.map((x, j) => (j === i ? v : x)));

  const parentC = Math.round(parent.amount * 100);
  const sumC = amounts.reduce((s, a) => s + Math.round((Number(a) || 0) * 100), 0);
  const remainingC = parentC - sumC;
  const balanced = remainingC === 0 && amounts.every((a) => Math.round((Number(a) || 0) * 100) !== 0);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const parts = amounts.map((a, i) => ({
        amount: Number(a),
        label: labels[i].trim() || null,
        categoryName: cats[i] || null,
      }));
      const res = await fetch("/api/splits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentTransactionId: parent.transactionId, parts }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || t("accounts.split.createFailed"));
      onDone();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  const defaultLabel = t("accounts.split.defaultCategory", { name: parent.category ?? "—" });

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflow: "auto", zIndex: 50 }}
      onClick={onClose}
    >
      <div className="card" style={{ maxWidth: 620, width: "100%", margin: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="card-header">{t("accounts.split.title")}</div>
        <p className="muted" style={{ marginTop: 0 }}>
          {parent.name} · {money(parent.amount, parent.currency)}
        </p>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>{t("accounts.split.help")}</p>

        {amounts.map((amt, i) => (
          <div key={i} className="row wrap" style={{ gap: 8, marginBottom: 8, alignItems: "flex-end" }}>
            <div style={{ width: 120 }}>
              <label style={{ margin: "0 0 4px" }}>{t("accounts.split.partAmount")}</label>
              <input type="number" step="0.01" value={amt} onChange={(e) => editAmount(i, e.target.value)} />
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={{ margin: "0 0 4px" }}>{t("accounts.split.partLabel")}</label>
              <input value={labels[i]} onChange={(e) => setLabels((l) => l.map((x, j) => (j === i ? e.target.value : x)))} />
            </div>
            <div style={{ minWidth: 150 }}>
              <label style={{ margin: "0 0 4px" }}>{t("accounts.split.partCategory")}</label>
              <select value={cats[i]} onChange={(e) => setCats((c) => c.map((x, j) => (j === i ? e.target.value : x)))}>
                <option value="">{defaultLabel}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
            {n > 2 && (
              <button className="btn btn-sm btn-ghost" onClick={() => setCount(n - 1)} title={t("accounts.split.removePart")}>
                ✕
              </button>
            )}
          </div>
        ))}

        <div className="row wrap" style={{ gap: 12, margin: "12px 0" }}>
          <button className="btn btn-sm" onClick={() => setCount(n + 1)}>{t("accounts.split.addPart")}</button>
          <span className={remainingC === 0 ? "muted" : "error"} style={{ fontSize: 13 }}>
            {t("accounts.split.remaining")}: {money(remainingC / 100, parent.currency)}
          </span>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="row wrap">
          <button className="btn btn-primary" disabled={busy || !balanced} onClick={submit}>
            {busy ? t("common.saving") : t("accounts.split.create")}
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </div>
    </div>
  );
}
