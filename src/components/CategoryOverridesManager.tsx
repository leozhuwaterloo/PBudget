"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";

// Customizations → "Category overrides" tab: every transaction whose category you
// set manually (GET /api/transactions/overrides), shown with the reason you gave.
// Clear one to revert it to its automatic (vendor / Plaid) category — reuses the
// same PATCH that Review uses to set the override. Amounts render user-convention
// (spend negative), mirroring the Marked-valid tab.

type Override = {
  transactionId: string;
  name: string;
  vendor: string | null;
  category: string;
  reason: string | null;
  amount: number;
  currency: string | null;
  date: string;
};

const money = (amount: number, currency: string | null) =>
  `${currency ? currency + " " : ""}${(-amount).toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString();

export default function CategoryOverridesManager() {
  const t = useT();
  const [rows, setRows] = useState<Override[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/transactions/overrides");
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || t("cust.overrides.loadFailed"));
        setRows(d.overrides);
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, [t]);

  // Optimistic: drop the row on click, then clear the override. Restore on failure.
  const clear = async (id: string) => {
    const snapshot = rows;
    setBusy(true);
    setError("");
    setRows((rs) => rs && rs.filter((r) => r.transactionId !== id));
    try {
      const res = await fetch(`/api/transactions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryName: null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || t("common.genericError"));
      }
    } catch (e: any) {
      setRows(snapshot);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!rows && !error) return <p className="muted">{t("common.loading")}</p>;

  return (
    <div className="mobile-cards">
      <p className="muted" style={{ marginTop: 0 }}>{t("cust.overrides.help")}</p>
      {error && <div className="error">{error}</div>}
      {rows && rows.length === 0 ? (
        <p className="muted">{t("cust.overrides.empty")}</p>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>{t("review.colItem")}</th>
                <th>{t("cust.overrides.colCategory")}</th>
                <th>{t("review.categoryReason")}</th>
                <th>{t("review.colAmount")}</th>
                <th>{t("review.colDate")}</th>
                <th>{t("review.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((r) => (
                <tr key={r.transactionId}>
                  <td>
                    <strong>{r.name}</strong>
                    {r.vendor && r.vendor !== r.name && (
                      <div className="muted" style={{ fontSize: 12 }}>{r.vendor}</div>
                    )}
                  </td>
                  <td>{r.category}</td>
                  <td>{r.reason || "—"}</td>
                  <td>{money(r.amount, r.currency)}</td>
                  <td>{day(r.date)}</td>
                  <td>
                    <button className="btn btn-sm" disabled={busy} onClick={() => clear(r.transactionId)}>
                      {t("cust.overrides.clear")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
