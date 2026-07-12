"use client";
import { useCallback, useEffect, useState } from "react";
import { VendorIcon } from "./VendorIcon";
import SplitDialog from "./SplitDialog";
import ReviewMergePicker from "./ReviewMergePicker";
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
  plaidConfidence: string | null;
  vendorName: string;
  vendorLink: string | null;
  vendorIcon: string | null;
  category: string | null;
  isMergeLeg: boolean;
  split: { parts: Part[] } | null;
  eligibleForSplit: boolean;
};
type Page = { transactions: BrowserTxn[]; page: number; pageSize: number; total: number };

const money = (amount: number, currency: string | null) => `${currency ? currency + " " : ""}${amount.toFixed(2)}`;

// Source: one of accountId (per-account, FR8) or vendorId (a vendor's matched txns).
export default function TransactionBrowser({ accountId, vendorId }: { accountId?: string; vendorId?: string; locale?: Locale }) {
  const t = useT();
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [splitTarget, setSplitTarget] = useState<BrowserTxn | null>(null);
  const [editTarget, setEditTarget] = useState<BrowserTxn | null>(null);

  // A row is actionable when there's a whole-txn category to override (any
  // non-split row) or it can seed a merge (posted, ungrouped, unsplit — same as
  // split-eligibility). Split rows carry per-part categories, so no whole-txn edit.
  const canEdit = (r: BrowserTxn) => !r.split;
  const canMerge = (r: BrowserTxn) => r.eligibleForSplit;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const scope = accountId ? `account_id=${encodeURIComponent(accountId)}` : `vendor_id=${encodeURIComponent(vendorId!)}`;
      const res = await fetch(`/api/accounts/transactions?${scope}&page=${page}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || t("accounts.browser.loadFailed"));
      setData(d);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [accountId, vendorId, page, t]);

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
        // Statement-style list (raw descriptor → resolved vendor + category +
        // amount), mirroring the landing hero. Grid rows flow inside the account
        // card's <td> and stay readable on phones — no sideways-scrolling table.
        // Merchant + Plaid taxonomy move into the row-click dialog (AccountTxnDialog).
        <div className="txn-list">
          {data?.transactions.map((r) => {
            const actionable = canEdit(r) || canMerge(r);
            const shown = -r.amount; // user convention: negative = spend, positive = money in
            const sign = shown > 0 ? "+" : shown < 0 ? "−" : "";
            const amtText = `${r.currency ? r.currency + " " : ""}${sign}${Math.abs(shown).toFixed(2)}`;
            return (
              <div
                key={r.transactionId}
                className={`txn-row${r.pending ? " txn-pending" : ""}${actionable ? " txn-click" : ""}`}
                onClick={actionable ? () => setEditTarget(r) : undefined}
              >
                <span className="txn-icon">
                  <VendorIcon name={r.vendorName} link={r.vendorLink} icon={r.vendorIcon} size={22} />
                </span>
                <div className="txn-raw">{r.name}</div>
                <div className="txn-body">
                  <span className="txn-payee">{r.vendorName}</span>
                  {r.category && <span className="txn-tag">{r.category}</span>}
                  {r.pending && <span className="txn-badge">{t("accounts.browser.pending")}</span>}
                  {r.split ? (
                    <>
                      <span className="txn-badge">{t("accounts.browser.splitBadge", { n: r.split.parts.length })}</span>
                      <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); unsplit(r.transactionId); }}>
                        {t("accounts.browser.unsplit")}
                      </button>
                    </>
                  ) : r.eligibleForSplit ? (
                    <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); setSplitTarget(r); }}>
                      {t("accounts.browser.split")}
                    </button>
                  ) : null}
                </div>
                <div className="txn-side">
                  <span className={`txn-amt${shown > 0 ? " txn-in" : ""}`}>{amtText}</span>
                  <span className="txn-date">{new Date(r.date).toLocaleDateString("en-ZA", { timeZone: "UTC" })}</span>
                </div>
              </div>
            );
          })}
        </div>
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

      {editTarget && (
        <AccountTxnDialog
          txn={editTarget}
          canEdit={canEdit(editTarget)}
          canMerge={canMerge(editTarget)}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// Row-click editor for one raw transaction (Accounts): set a whole-txn category
// override with a required reason (PATCH /api/transactions/[id], same as Review)
// and/or seed an N-way merge (ReviewMergePicker → POST /api/merge). Closes on
// overlay click / Escape / Close.
function AccountTxnDialog({
  txn,
  canEdit,
  canMerge,
  onClose,
  onSaved,
}: {
  txn: BrowserTxn;
  canEdit: boolean;
  canMerge: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [cats, setCats] = useState<string[]>([]);
  const [cat, setCat] = useState(txn.category ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    fetch("/api/categories")
      .then((r) => (r.ok ? r.json() : { categories: [] }))
      .then((d) => {
        const names: string[] = (d.categories ?? []).map((c: { name: string }) => c.name);
        setCats(names);
        // Ensure the select value is always a real category (txn.category can be a
        // raw Plaid fallback that isn't one of the user's categories).
        if (!names.includes(txn.category ?? "")) setCat(names[0] ?? "");
      })
      .catch(() => {});
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const save = async () => {
    if (!reason.trim()) return;
    setSaving(true);
    setErr("");
    try {
      const res = await fetch(`/api/transactions/${txn.transactionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryName: cat, reason: reason.trim() }),
      });
      if (!res.ok) {
        setErr((await res.json().catch(() => null))?.error ?? t("common.genericError"));
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflow: "auto", zIndex: 50 }}
        onClick={onClose}
        role="dialog"
        aria-modal="true"
      >
        <div className="card" style={{ maxWidth: 520, width: "100%", margin: 0 }} onClick={(e) => e.stopPropagation()}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
            <div className="row" style={{ gap: 10, minWidth: 0 }}>
              <VendorIcon name={txn.vendorName} link={txn.vendorLink} icon={txn.vendorIcon} size={20} />
              <div style={{ minWidth: 0 }}>
                <div className="card-header" style={{ margin: 0 }}>{txn.name || txn.vendorName}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {new Date(txn.date).toLocaleDateString("en-ZA", { timeZone: "UTC" })} · {money(-txn.amount, txn.currency)}
                </div>
              </div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={onClose}>{t("common.close")}</button>
          </div>

          {/* Raw pre-funnel fields (merchant + Plaid taxonomy) — moved off the list row
              into this detail view so the ledger stays clean but nothing is lost. */}
          {(txn.merchantName || txn.category || txn.plaidPrimary) && (
            <div className="row wrap" style={{ gap: "5px 6px", marginBottom: 14 }}>
              {txn.merchantName && <span className="txn-tag">{t("cust.vendors.merchantName")}: {txn.merchantName}</span>}
              {txn.category && <span className="txn-tag">{txn.category}</span>}
              {txn.plaidPrimary && <span className="txn-tag">{txn.plaidPrimary}</span>}
              {txn.plaidDetailed && <span className="txn-tag">{txn.plaidDetailed}</span>}
              {txn.plaidConfidence && <span className="txn-tag">{t("cust.vendors.plaidConfidence")}: {txn.plaidConfidence}</span>}
            </div>
          )}

          {canEdit && (
            <div className="row wrap" style={{ gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
              <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: "auto", flex: "0 0 auto" }} aria-label={t("review.setCategory")}>
                {cats.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("review.categoryReasonPlaceholder")} style={{ flex: 1, minWidth: 140 }} />
              <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !reason.trim()}>
                {saving ? t("common.saving") : t("common.save")}
              </button>
            </div>
          )}
          {canMerge && (
            <button className="btn btn-sm" onClick={() => setMerging(true)}>{t("review.merge")}</button>
          )}
          {err && <p className="error">{err}</p>}
        </div>
      </div>

      {merging && (
        <ReviewMergePicker
          seedId={txn.transactionId}
          onClose={() => setMerging(false)}
          onMerged={() => {
            setMerging(false);
            onSaved();
          }}
        />
      )}
    </>
  );
}
