"use client";
import { useEffect, useState } from "react";
import ReviewMergePicker from "./ReviewMergePicker";
import { useT } from "@/lib/i18n/context";

// The auditor loop (FR4/FR5). All state comes from the F2/F3 JSON APIs; every
// flag is drivable to resolution here. Amounts are stored Plaid-convention
// (positive = outflow) and rendered user-convention (spend negative) via -amount.

type FlagEntry = {
  id: string;
  rule: string;
  level: "transaction" | "group";
  transactionId?: string;
  mergeGroupId?: string;
  vendor: string | null;
  name?: string;
  title?: string;
  amount: number | null;
  currency: string | null;
  date: string;
};

type Leg = { transactionId: string; name: string | null; amount: number | null };
type PendingGroup = {
  id: string;
  title: string;
  vendor: string | null;
  amount: number | null;
  currency: string | null;
  date: string;
  legs: Leg[];
};
type FlagsData = {
  counters: { today: number; thisMonth: number; totalOpen: number };
  flagsByRule: Record<string, FlagEntry[]>;
  pendingGroups: PendingGroup[];
};

// Rule labels are translated at render via t(`rule.${id}`). The V2 funnel retired
// unknown_vendor; the unmatched/conflict queue UI arrives in F12.
const RULES = ["unmatched_transfer", "unusual_amount", "duplicate_charge"];

const money = (amount: number | null, currency: string | null) =>
  amount == null ? "—" : `${currency ? currency + " " : ""}${(-amount).toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString();

async function getJson(url: string) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
async function postJson(url: string) {
  const res = await fetch(url, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function Review() {
  const t = useT();
  const [data, setData] = useState<FlagsData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [mode, setMode] = useState<"all" | "day" | "month">("all");
  const [dayVal, setDayVal] = useState(() => new Date().toISOString().slice(0, 10));
  const [monthVal, setMonthVal] = useState(() => new Date().toISOString().slice(0, 7));
  const [picker, setPicker] = useState<{ seedId?: string } | null>(null);

  const query =
    mode === "day" && dayVal ? `?day=${dayVal}` : mode === "month" && monthVal ? `?month=${monthVal}` : "";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const flags = await getJson(`/api/flags${query}`);
        if (!cancelled) setData(flags);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, reloadKey]);

  // Every action refetches (reloadKey bump) so new group-level flags surface
  // and resolved ones disappear (criterion 19).
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      setReloadKey((k) => k + 1);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  const hasVisible =
    !!data &&
    (data.pendingGroups.length > 0 || RULES.some((id) => (data.flagsByRule[id] ?? []).length > 0));

  return (
    <div>
      <h1>{t("review.title")}</h1>

      {data && (
        <div className="row wrap" style={{ gap: 12, marginBottom: 16 }}>
          <Counter label={t("review.suspiciousToday")} value={data.counters.today} />
          <Counter label={t("review.thisMonth")} value={data.counters.thisMonth} />
          <Counter label={t("review.totalOpen")} value={data.counters.totalOpen} />
        </div>
      )}

      <div className="row wrap" style={{ marginBottom: 16 }}>
        <span className="muted">{t("review.filter")}</span>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as any)}
          style={{ width: "auto" }}
        >
          <option value="all">{t("review.allDates")}</option>
          <option value="day">{t("review.byDay")}</option>
          <option value="month">{t("review.byMonth")}</option>
        </select>
        {mode === "day" && (
          <input type="date" value={dayVal} onChange={(e) => setDayVal(e.target.value)} style={{ width: "auto" }} />
        )}
        {mode === "month" && (
          <input
            type="month"
            value={monthVal}
            onChange={(e) => setMonthVal(e.target.value)}
            style={{ width: "auto" }}
          />
        )}
        <div className="spacer" style={{ flex: 1 }} />
        <button className="btn" disabled={busy} onClick={() => setPicker({})}>
          {t("review.mergeTransactions")}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {!data ? (
        <p className="muted">{t("common.loading")}</p>
      ) : data.counters.totalOpen === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 32, color: "var(--success)" }}>✓</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginTop: 8 }}>{t("review.allClear")}</div>
          <p className="muted" style={{ marginBottom: 0 }}>
            {t("review.allClearBody")}
          </p>
        </div>
      ) : !hasVisible ? (
        <p className="muted">{t("review.noMatch")}</p>
      ) : (
        <>
          {data.pendingGroups.length > 0 && (
            <section>
              <h2 style={{ fontSize: 16, margin: "20px 0 8px" }}>
                {t("review.pendingGroups", { n: data.pendingGroups.length })}
              </h2>
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
                    {data.pendingGroups.map((g) => (
                      <tr key={g.id}>
                        <td>
                          <strong>{g.title}</strong>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {g.legs
                              .map((l) => `${l.name ?? l.transactionId} (${money(l.amount, g.currency)})`)
                              .join("  +  ")}
                          </div>
                        </td>
                        <td>{money(g.amount, g.currency)}</td>
                        <td>{day(g.date)}</td>
                        <td>
                          <div className="row wrap">
                            <button
                              className="btn btn-sm btn-primary"
                              disabled={busy}
                              onClick={() => act(() => postJson(`/api/merge/${g.id}/confirm`))}
                            >
                              {t("review.confirm")}
                            </button>
                            <button
                              className="btn btn-sm"
                              disabled={busy}
                              onClick={() => act(() => postJson(`/api/merge/${g.id}/dissolve`))}
                            >
                              {t("review.dissolve")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {RULES.map((id) => {
            const entries = data.flagsByRule[id] ?? [];
            if (!entries.length) return null;
            return (
              <section key={id}>
                <h2 style={{ fontSize: 16, margin: "20px 0 8px" }}>
                  {t(`rule.${id}`)} ({entries.length})
                </h2>
                <div className="card" style={{ padding: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>{t("review.colItem")}</th>
                        <th>{t("review.colAmount")}</th>
                        <th>{t("review.colDate")}</th>
                        <th>{t("review.colActions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <strong>{e.level === "group" ? e.title : e.vendor}</strong>
                            <div className="muted" style={{ fontSize: 12 }}>
                              {e.level === "group"
                                ? `${t("review.mergedGroup")} · ${e.vendor ?? "—"}`
                                : e.name}
                            </div>
                          </td>
                          <td>{money(e.amount, e.currency)}</td>
                          <td>{day(e.date)}</td>
                          <td>
                            <div className="row wrap">
                              {e.level === "transaction" && (
                                <button
                                  className="btn btn-sm"
                                  disabled={busy}
                                  onClick={() => setPicker({ seedId: e.transactionId })}
                                >
                                  {t("review.merge")}
                                </button>
                              )}
                              <button
                                className="btn btn-sm btn-ghost"
                                disabled={busy}
                                onClick={() => act(() => postJson(`/api/flags/${e.id}/dismiss`))}
                              >
                                {t("review.dismiss")}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </>
      )}

      {picker && (
        <ReviewMergePicker
          seedId={picker.seedId}
          onClose={() => setPicker(null)}
          onMerged={() => {
            setPicker(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="card" style={{ margin: 0, minWidth: 130 }}>
      <div style={{ fontSize: 26, fontWeight: 700 }}>{value}</div>
      <div className="muted">{label}</div>
    </div>
  );
}
