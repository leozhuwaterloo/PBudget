"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";

// Customizations → "Merged groups" tab: lists all CONFIRMED merge groups (GET
// /api/merge) with a Dissolve action. Pending/auto groups live in Review's
// confirmation queue; this is the management view for the ones already confirmed.
// Amounts render user-convention (spend negative) via -amount, matching Review.

type Leg = { transactionId: string; name: string | null; amount: number | null };
type Group = { id: string; title: string; vendor: string | null; amount: number | null; currency: string | null; date: string; legs: Leg[] };

const money = (amount: number | null, currency: string | null) =>
  amount == null ? "—" : `${currency ? currency + " " : ""}${(-amount).toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString();

export default function MergesManager() {
  const t = useT();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/merge");
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || t("cust.merges.loadFailed"));
        setGroups(d.groups);
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, [t]);

  // Optimistic: drop the row on click, then dissolve. Restore on failure.
  const dissolve = async (id: string) => {
    const snapshot = groups;
    setBusy(true);
    setError("");
    setGroups((gs) => gs && gs.filter((g) => g.id !== id));
    try {
      const res = await fetch(`/api/merge/${id}/dissolve`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || t("common.genericError"));
      }
    } catch (e: any) {
      setGroups(snapshot);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!groups && !error) return <p className="muted">{t("common.loading")}</p>;

  return (
    <div className="mobile-cards">
      <p className="muted" style={{ marginTop: 0 }}>{t("cust.merges.help")}</p>
      {error && <div className="error">{error}</div>}
      {groups && groups.length === 0 ? (
        <p className="muted">{t("cust.merges.empty")}</p>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>{t("review.colGroup")}</th>
                <th>{t("review.colNet")}</th>
                <th>{t("review.colDate")}</th>
                <th>{t("review.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {groups?.map((g) => (
                <tr key={g.id}>
                  <td>
                    <strong>{g.title}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {g.legs.map((l) => `${l.name ?? l.transactionId} (${money(l.amount, g.currency)})`).join("  +  ")}
                    </div>
                  </td>
                  <td>{money(g.amount, g.currency)}</td>
                  <td>{day(g.date)}</td>
                  <td>
                    <button className="btn btn-sm" disabled={busy} onClick={() => dissolve(g.id)}>
                      {t("review.dissolve")}
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
