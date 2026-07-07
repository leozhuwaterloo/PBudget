"use client";
import { useCallback, useEffect, useState } from "react";
import { VendorIcon } from "./VendorIcon";
import SplitDialog from "./SplitDialog";
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
        // overflow-x so the wide 9-col table scrolls (not clips) inside a narrow
        // container — e.g. the vendor card, where it's slimmer than the accounts page.
        <div style={{ overflowX: "auto" }}>
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
                <td>{money(-r.amount, r.currency)}</td>
                <td>{new Date(r.date).toLocaleDateString("en-ZA", { timeZone: "UTC" })}</td>
                <td>{r.pending ? t("accounts.browser.pending") : t("accounts.browser.posted")}</td>
                <td>
                  {r.plaidPrimary ?? "—"}
                  {r.plaidDetailed && <span className="muted" style={{ display: "block", fontSize: 11 }}>{r.plaidDetailed}</span>}
                  {r.plaidConfidence && <span className="muted" style={{ display: "block", fontSize: 11 }}>{t("cust.vendors.plaidConfidence")}: {r.plaidConfidence}</span>}
                </td>
                <td>
                  <span className="row" style={{ gap: 6 }}>
                    <VendorIcon name={r.vendorName} link={r.vendorLink} icon={r.vendorIcon} size={20} />
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
    </div>
  );
}
