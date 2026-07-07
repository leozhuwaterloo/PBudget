"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";

// Customizations → "Marked valid" tab: suspicion flags the user dismissed (GET
// /api/flags/dismissed) with a Restore action to re-open them. The inverse view
// of Review's suspicion queue. Amounts render user-convention (spend negative).

type Flag = {
  id: string;
  rule: string;
  level: "transaction" | "group";
  vendor: string | null;
  name: string;
  amount: number | null;
  currency: string | null;
  date: string;
};

const money = (amount: number | null, currency: string | null) =>
  amount == null ? "—" : `${currency ? currency + " " : ""}${(-amount).toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString();

export default function MarkedValidManager() {
  const t = useT();
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/flags/dismissed");
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || t("cust.markedValid.loadFailed"));
        setFlags(d.flags);
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, [t]);

  // Optimistic: drop the row on click, then restore. Put it back on failure.
  const restore = async (id: string) => {
    const snapshot = flags;
    setBusy(true);
    setError("");
    setFlags((fs) => fs && fs.filter((f) => f.id !== id));
    try {
      const res = await fetch(`/api/flags/${id}/restore`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || t("common.genericError"));
      }
    } catch (e: any) {
      setFlags(snapshot);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!flags && !error) return <p className="muted">{t("common.loading")}</p>;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>{t("cust.markedValid.help")}</p>
      {error && <div className="error">{error}</div>}
      {flags && flags.length === 0 ? (
        <p className="muted">{t("cust.markedValid.empty")}</p>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>{t("review.colItem")}</th>
                <th>{t("review.colReason")}</th>
                <th>{t("review.colAmount")}</th>
                <th>{t("review.colDate")}</th>
                <th>{t("review.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {flags?.map((f) => (
                <tr key={f.id}>
                  <td>
                    <strong>{f.name}</strong>
                    {f.vendor && f.vendor !== f.name && (
                      <div className="muted" style={{ fontSize: 12 }}>{f.vendor}</div>
                    )}
                  </td>
                  <td>{t(`rule.${f.rule}`)}</td>
                  <td>{money(f.amount, f.currency)}</td>
                  <td>{day(f.date)}</td>
                  <td>
                    <button className="btn btn-sm" disabled={busy} onClick={() => restore(f.id)}>
                      {t("cust.markedValid.restore")}
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
