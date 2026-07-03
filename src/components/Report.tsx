"use client";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/context";

export type ReportEntry = {
  isGroup: boolean;
  title: string;
  category: string;
  date: string; // ISO (UTC)
  amount: number; // Plaid convention: + = outflow
  currency: string | null;
};
export type ReportFlag = { status: string; date: string };

// Pure month aggregation (exported for the acceptance check). Buckets by the UTC
// month prefix of each ISO date. Spend/cash-flow follow the display convention:
// DB stores + = outflow, so an outflow renders negative. Merge groups arrive here
// already collapsed to one entry at net (net-0 → amount 0, contributes nothing).
// Flags: dismissed and resolved both count as "resolved" (only "open" is open).
// ponytail: single-currency assumption (demo is one currency); sums ignore FX.
export function aggregateReport(entries: ReportEntry[], flags: ReportFlag[], month: string) {
  const inMonth = (iso: string) => iso.slice(0, 7) === month;
  const monthEntries = entries.filter((e) => inMonth(e.date));

  const byCat = new Map<string, { net: number; currency: string | null }>();
  let totalOut = 0;
  let totalIn = 0;
  for (const e of monthEntries) {
    const c = byCat.get(e.category) ?? { net: 0, currency: e.currency };
    c.net += e.amount;
    byCat.set(e.category, c);
    if (e.amount > 0) totalOut += e.amount;
    else if (e.amount < 0) totalIn += -e.amount;
  }

  const categories = [...byCat.entries()]
    .map(([name, v]) => ({ name, spend: -v.net, currency: v.currency }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

  const monthFlags = flags.filter((f) => inMonth(f.date));
  const open = monthFlags.filter((f) => f.status === "open").length;
  const resolved = monthFlags.length - open;

  const currency = monthEntries[0]?.currency ?? "";
  return { categories, totalIn, totalOut, open, resolved, currency, hasData: monthEntries.length + monthFlags.length > 0 };
}

const money = (n: number) => (n < 0 ? "−" : "") + Math.abs(n).toFixed(2); // U+2212 minus

export default function Report({
  entries,
  flags,
  defaultMonth,
}: {
  entries: ReportEntry[];
  flags: ReportFlag[];
  defaultMonth: string;
}) {
  const t = useT();
  const [month, setMonth] = useState(defaultMonth);
  const r = useMemo(() => aggregateReport(entries, flags, month), [entries, flags, month]);

  return (
    <div>
      <h1>{t("report.title")}</h1>
      <label className="muted" style={{ display: "block", marginBottom: 16 }}>
        {t("report.month")}{" "}
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value || defaultMonth)} />
      </label>

      {!r.hasData ? (
        <p className="muted">{t("report.noActivity")}</p>
      ) : (
        <>
          <div className="card">
            <div className="card-header">{t("report.cashFlow")}</div>
            <table>
              <tbody>
                <tr>
                  <td>{t("report.moneyIn")}</td>
                  <td style={{ textAlign: "right" }}>{r.currency} {money(r.totalIn)}</td>
                </tr>
                <tr>
                  <td>{t("report.moneyOut")}</td>
                  <td style={{ textAlign: "right" }}>{r.currency} {money(-r.totalOut)}</td>
                </tr>
                <tr>
                  <td><strong>{t("report.net")}</strong></td>
                  <td style={{ textAlign: "right" }}><strong>{r.currency} {money(r.totalIn - r.totalOut)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-header">{t("report.flagsThisMonth")}</div>
            <table>
              <tbody>
                <tr><td>{t("report.open")}</td><td style={{ textAlign: "right" }}>{r.open}</td></tr>
                <tr><td>{t("report.resolved")}</td><td style={{ textAlign: "right" }}>{r.resolved}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>{t("report.category")}</th>
                  <th style={{ textAlign: "right" }}>{t("report.spend")}</th>
                </tr>
              </thead>
              <tbody>
                {r.categories.length === 0 ? (
                  <tr><td colSpan={2} className="muted">{t("report.noSpend")}</td></tr>
                ) : (
                  r.categories.map((c) => (
                    <tr key={c.name}>
                      <td>{c.name}</td>
                      <td style={{ textAlign: "right" }}>{c.currency ?? ""} {money(c.spend)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
