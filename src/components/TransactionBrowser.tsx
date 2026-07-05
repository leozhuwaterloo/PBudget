"use client";
import { useCallback, useEffect, useState } from "react";
import { VendorIcon } from "./VendorIcon";
import { useT } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n";

// Per-account RAW transaction browser (FR8). Pages through PlaidTransaction rows
// AS FETCHED (pre-funnel) via GET /api/accounts/transactions, showing each row's
// raw fields plus the currently-resolved vendor + category (F2). Eligible rows
// (posted, ungrouped, unsplit) get a Split action → SplitDialog → POST /api/splits
// (F5). Split rows show their state + an unsplit affordance (DELETE /api/splits).

type Part = { id: string; amount: number; label: string | null; categoryName: string | null };
type BrowserTxn = {
  transactionId: string;
  name: string;
  merchantName: string | null;
  amount: number;
  currency: string | null;
  date: string;
  pending: boolean;
  plaidPrimary: string | null;
  plaidDetailed: string | null;
  vendorName: string;
  vendorIcon: string | null;
  category: string | null;
  isMergeLeg: boolean;
  split: { parts: Part[] } | null;
  eligibleForSplit: boolean;
};
type Page = { transactions: BrowserTxn[]; page: number; pageSize: number; total: number };

const money = (amount: number, currency: string | null) => `${currency ? currency + " " : ""}${amount.toFixed(2)}`;

export default function TransactionBrowser({ accountId, locale }: { accountId: string; locale: Locale }) {
  const t = useT();
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [splitTarget, setSplitTarget] = useState<BrowserTxn | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/accounts/transactions?account_id=${encodeURIComponent(accountId)}&page=${page}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || t("accounts.browser.loadFailed"));
      setData(d);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [accountId, page, t]);

  useEffect(() => {
    load();
  }, [load]);

  const unsplit = async (parentTransactionId: string) => {
    if (!confirm(t("accounts.browser.unsplitConfirm"))) return;
    const res = await fetch("/api/splits", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentTransactionId }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || t("accounts.browser.unsplitFailed"));
      return;
    }
    load();
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div style={{ padding: "4px 2px 8px" }}>
      {error && <div className="error">{error}</div>}
      {loading && !data ? (
        <p className="muted" style={{ padding: 8 }}>{t("common.loading")}</p>
      ) : data && data.transactions.length === 0 ? (
        <p className="muted" style={{ padding: 8 }}>{t("accounts.browser.empty")}</p>
      ) : (
        <table className="nested">
          <thead>
            <tr>
              <th>{t("accounts.browser.colName")}</th>
              <th>{t("accounts.browser.colMerchant")}</th>
              <th>{t("accounts.browser.colAmount")}</th>
              <th>{t("accounts.browser.colDate")}</th>
              <th>{t("accounts.browser.colStatus")}</th>
              <th>{t("accounts.browser.colPlaid")}</th>
              <th>{t("accounts.browser.colVendor")}</th>
              <th>{t("accounts.browser.colCategory")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data?.transactions.map((r) => (
              <tr key={r.transactionId} className={r.pending ? "pending" : undefined}>
                <td>{r.name}</td>
                <td>{r.merchantName ?? ""}</td>
                <td>{money(r.amount, r.currency)}</td>
                <td>{new Date(r.date).toLocaleDateString("en-ZA", { timeZone: "UTC" })}</td>
                <td>{r.pending ? t("accounts.browser.pending") : t("accounts.browser.posted")}</td>
                <td>
                  {r.plaidPrimary ?? "—"}
                  {r.plaidDetailed && <span className="muted" style={{ display: "block", fontSize: 11 }}>{r.plaidDetailed}</span>}
                </td>
                <td>
                  <span className="row" style={{ gap: 6 }}>
                    <VendorIcon icon={r.vendorIcon} name={r.vendorName} size={20} />
                    {r.vendorName}
                  </span>
                </td>
                <td>{r.category ?? "—"}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {r.split ? (
                    <span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                      <span className="muted" style={{ fontSize: 11 }}>
                        {t("accounts.browser.splitBadge", { n: r.split.parts.length })}
                      </span>
                      <button className="btn btn-sm" onClick={() => unsplit(r.transactionId)}>
                        {t("accounts.browser.unsplit")}
                      </button>
                    </span>
                  ) : r.eligibleForSplit ? (
                    <button className="btn btn-sm" onClick={() => setSplitTarget(r)}>
                      {t("accounts.browser.split")}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data && data.total > data.pageSize && (
        <div className="row wrap" style={{ marginTop: 10, gap: 10 }}>
          <button className="btn btn-sm" disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}>
            {t("accounts.browser.prev")}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>{t("accounts.browser.pageOf", { page: page + 1, pages })}</span>
          <button className="btn btn-sm" disabled={page + 1 >= pages || loading} onClick={() => setPage((p) => p + 1)}>
            {t("accounts.browser.next")}
          </button>
        </div>
      )}

      {splitTarget && (
        <SplitDialog
          parent={splitTarget}
          onClose={() => setSplitTarget(null)}
          onDone={() => {
            setSplitTarget(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// N-part split dialog (FR5). Amounts must sum EXACTLY to the parent and share its
// sign (the F5 API re-validates in integer cents). Each part's category select
// DEFAULTS to the parent's currently-resolved category but stores nothing for it
// (null → resolves live through the parent's waterfall; never snapshotted).
type Cat = { id: string; name: string };

function evenSplit(total: number, n: number): string[] {
  const totalC = Math.round(total * 100);
  const base = Math.trunc(totalC / n);
  const rem = totalC - base * n; // same sign as total
  return Array.from({ length: n }, (_, i) => (((i === 0 ? base + rem : base) as number) / 100).toFixed(2));
}

function SplitDialog({ parent, onClose, onDone }: { parent: BrowserTxn; onClose: () => void; onDone: () => void }) {
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
