"use client";
import { useEffect, useRef, useState } from "react";
import { useT, useLocale } from "@/lib/i18n/context";
import { VendorIcon } from "./VendorIcon";
import ReviewMergePicker from "./ReviewMergePicker";
import type { DashboardData } from "@/lib/dashboard";

// Graphs-only Dashboard (FR7): hand-rolled inline-SVG widgets in the Statement
// theme — NO chart library. All numbers come from F2's effective read model via
// /lib/dashboard. "Spend" = net signed amount (Plaid convention, + = outflow).
// The month is stepped with ‹/› buttons over the fixed 12-month trend window and
// drives (b) budget-vs-actual and (d) top vendors; (a) trend is the full window.

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// Bar geometry + colour for one budget line. Per-row scale: the track's 100% is
// this line's own max(|actual|, budget), so actual==budget fills full and $10
// against a $1 budget fills full with the marker at 1/10. Colour (rounded compare,
// matching the shown numbers): over budget → amber; at/under → green; no budget
// set → neutral primary; net money-in (refund/credit) → muted.
function budgetBar(actual: number, budget: number) {
  const mag = Math.abs(actual);
  const rowMax = Math.max(mag, budget) || 1;
  const over = budget > 0 && Math.round(actual * 100) > Math.round(budget * 100);
  const color = actual < 0 ? "var(--muted)" : budget === 0 ? "var(--primary)" : over ? "var(--warning)" : "var(--success)";
  return { frac: mag / rowMax, markerFrac: budget > 0 ? budget / rowMax : null, color };
}

export default function Dashboard({ initial }: { initial: DashboardData }) {
  const t = useT();
  const locale = useLocale();
  const numLocale = locale === "zh-Hans" ? "zh-CN" : "en-US";
  const [data, setData] = useState(initial);
  const [month, setMonth] = useState(initial.month);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<DashboardData["budget"][number] | null>(null);
  const [vendorDetail, setVendorDetail] = useState<DashboardData["vendors"][number] | null>(null);
  const [cats, setCats] = useState<string[]>([]);

  // Category list for inline re-categorise in the top-transactions section.
  useEffect(() => {
    fetch("/api/categories")
      .then((r) => (r.ok ? r.json() : { categories: [] }))
      .then((d) => setCats((d.categories ?? []).map((c: { name: string }) => c.name)))
      .catch(() => {});
  }, []);

  // Fixed 2 decimals (%.2f) with locale thousands grouping. Real amounts are in
  // cents, so a column and its total still agree (40.50 + 40.50 = 81.00).
  const money = (n: number) =>
    `${data.currency ? data.currency + " " : ""}${n.toLocaleString(numLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const monthLabel = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(numLocale, { month: "short", timeZone: "UTC" });
  };
  const monthYearLabel = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(numLocale, { month: "long", year: "numeric", timeZone: "UTC" });
  };
  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(numLocale, { month: "short", day: "numeric", timeZone: "UTC" });

  const load = async (m: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/dashboard?month=${m}`);
      if (res.ok) setData(await res.json());
    } finally {
      setBusy(false);
    }
  };
  const changeMonth = (m: string) => {
    if (!m || m === month) return;
    setMonth(m);
    load(m);
  };

  // Step within the 12-month trend window (oldest → newest); buttons disable at ends.
  const months = data.trend.map((d) => d.month);
  const idx = months.indexOf(month);
  const step = (delta: number) => {
    const ni = idx + delta;
    if (ni >= 0 && ni < months.length) changeMonth(months[ni]);
  };

  const empty = data.trend.every((d) => d.spend === 0) && data.vendors.length === 0;

  // KPI tiles — all derived from data already on hand (trend / budget / review).
  const totActual = data.budget.filter((r) => !r.parentName).reduce((s, r) => s + r.actual, 0);
  const totBudget = data.budget.reduce((s, r) => s + r.budget, 0);
  const spendThis = data.trend[idx]?.spend ?? totActual;
  const spendPrev = idx > 0 ? data.trend[idx - 1]?.spend ?? null : null;
  const momPct = spendPrev && spendPrev !== 0 ? ((spendThis - spendPrev) / Math.abs(spendPrev)) * 100 : null;
  const activeSpends = data.trend.map((d) => d.spend).filter((v) => v > 0);
  const avgSpend = activeSpends.length ? activeSpends.reduce((s, v) => s + v, 0) / activeSpends.length : 0;
  const budgetPct = totBudget > 0 ? (totActual / totBudget) * 100 : null;
  const reviewCount = data.review.unmatched + data.review.conflicts + data.review.suspicion + data.review.pending;

  return (
    <div>
      <h1>{t("dash.title")}</h1>

      {empty && <p className="muted">{t("dash.empty")}</p>}

      {/* KPI stat tiles — headline numbers for the selected month */}
      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">{t("dash.stat.spent")}</div>
          <div className="stat-value">{money(spendThis)}</div>
          <div className="stat-sub">
            {momPct == null ? (
              <span className="muted">{monthYearLabel(month)}</span>
            ) : (
              <>
                <span className={momPct > 0 ? "chip chip-up" : "chip chip-down"}>
                  {momPct > 0 ? "↑" : "↓"} {Math.abs(momPct).toFixed(0)}%
                </span>
                <span className="muted">{t("dash.stat.vsPrev")}</span>
              </>
            )}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">{t("dash.stat.avg")}</div>
          <div className="stat-value">{money(avgSpend)}</div>
          <div className="stat-sub muted">{t("dash.stat.avgSub")}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{t("dash.stat.budget")}</div>
          {budgetPct == null ? (
            <>
              <div className="stat-value">—</div>
              <div className="stat-sub muted">{t("dash.stat.noBudget")}</div>
            </>
          ) : (
            <>
              <div className="stat-value">{budgetPct.toFixed(0)}%</div>
              <div style={{ marginTop: 10 }}>
                <BarRow
                  frac={budgetPct / 100}
                  color={budgetPct > 100 ? "var(--warning)" : "var(--success)"}
                  markerFrac={budgetPct > 100 ? 100 / budgetPct : null}
                  title={`${money(totActual)} / ${money(totBudget)}`}
                />
              </div>
            </>
          )}
        </div>
        <a className="stat" href="/review" style={{ display: "block", color: "inherit" }}>
          <div className="stat-label">{t("dash.stat.review")}</div>
          <div className="stat-value" style={{ color: reviewCount > 0 ? "var(--warning)" : "var(--success)" }}>{reviewCount}</div>
          <div className="stat-sub muted">{reviewCount > 0 ? t("dash.stat.reviewSub") : t("dash.stat.reviewClear")}</div>
        </a>
      </div>

      {/* (a) monthly spend trend — area+line over the fixed 12-month window */}
      <section className="card">
        <div className="card-header">
          {t("dash.trend.title")} <span className="muted" style={{ fontWeight: 400 }}>· {t("dash.trend.sub")}</span>
        </div>
        <TrendChart
          data={data.trend}
          monthLabel={monthLabel}
          money={money}
          emptyText={t("dash.trend.empty")}
          ariaLabel={t("dash.trend.aria")}
          selectedIndex={idx}
          onPick={changeMonth}
        />
        <p className="muted" style={{ fontSize: 12, margin: "10px 0 0", textAlign: "center" }}>{t("dash.trend.click")}</p>
      </section>

      {/* shared month stepper for (b) and (d) */}
      <div className="row" style={{ justifyContent: "center", gap: 10, margin: "24px 0 16px" }}>
        <button
          className="btn month-step"
          onClick={() => step(-1)}
          disabled={busy || idx <= 0}
          aria-label={t("dash.prevMonth")}
        >
          ‹
        </button>
        <span
          aria-live="polite"
          style={{ minWidth: 168, textAlign: "center", fontFamily: "var(--serif)", fontSize: 17, fontWeight: 600 }}
        >
          {monthYearLabel(month)}
        </span>
        <button
          className="btn month-step"
          onClick={() => step(1)}
          disabled={busy || idx < 0 || idx >= months.length - 1}
          aria-label={t("dash.nextMonth")}
        >
          ›
        </button>
      </div>

      {/* (c) spending distribution by category — full-width, big donut + legend */}
      <section className="card" style={{ opacity: busy ? 0.6 : 1, transition: "opacity 0.12s ease" }}>
        <div className="card-header">{t("dash.categories.title")}</div>
        <CategoryDonut
          budget={data.budget}
          money={money}
          totalLabel={t("dash.categories.total")}
          otherLabel={t("dash.categories.other")}
          emptyText={t("dash.categories.empty")}
          ariaLabel={t("dash.categories.aria")}
        />
      </section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 16,
          marginTop: 16,
          opacity: busy ? 0.6 : 1,
          transition: "opacity 0.12s ease",
        }}
      >
        {/* (b) budget vs actual — selected month */}
        <section className="card">
          <div className="card-header">{t("dash.budget.title")}</div>
          {data.budget.length === 0 ? (
            <p className="muted">{t("dash.budget.empty")}</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {(() => {
                // Total budget vs total spend for the month. Rows are hierarchical:
                // a parent's `actual` already rolls up its children, so summing only
                // the roots (parentName == null) counts each txn once and still == the
                // month's trend bar. Budgets are independent envelopes → sum them all.
                const totActual = data.budget.filter((r) => !r.parentName).reduce((s, r) => s + r.actual, 0);
                const totBudget = data.budget.reduce((s, r) => s + r.budget, 0);
                const bar = budgetBar(totActual, totBudget);
                return (
                  <div style={{ paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
                    <div className="row" style={{ justifyContent: "space-between", fontSize: 13, marginBottom: 4, fontWeight: 600 }}>
                      <span>{t("dash.budget.total")}</span>
                      <span className="muted">
                        {money(totActual)}
                        {totBudget > 0 ? ` / ${money(totBudget)}` : ""}
                      </span>
                    </div>
                    <BarRow frac={bar.frac} color={bar.color} markerFrac={bar.markerFrac} title={money(totActual)} />
                  </div>
                );
              })()}
              {data.budget.map((r) => {
                // A top-level category with no budget is just a grouping/section header
                // (a parent of budgeted children, or an unmatched Plaid-fallback bucket
                // like "Food And Drink") — a bar with no target is meaningless, so show
                // "Name ———— amount" instead. Still clickable to drill in / set a budget.
                if (r.budget === 0 && !r.parentName) {
                  return (
                    <button key={r.name} className="budget-row" onClick={() => setDetail(r)}>
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 10, fontSize: 13, fontWeight: 600 }}>
                        <span>{r.name}</span>
                        <span aria-hidden style={{ flex: 1, borderBottom: "1px dashed var(--border)", transform: "translateY(-3px)" }} />
                        <span className="muted" style={{ fontWeight: 400 }}>{money(r.actual)}</span>
                      </div>
                    </button>
                  );
                }
                const bar = budgetBar(r.actual, r.budget);
                return (
                  <button key={r.name} className="budget-row" style={r.parentName ? { paddingLeft: 20 } : undefined} onClick={() => setDetail(r)}>
                    <div className="row" style={{ justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                      <span className={r.parentName ? "muted" : undefined}>{r.parentName ? `↳ ${r.name}` : r.name}</span>
                      <span className="muted">
                        {money(r.actual)}
                        {r.budget > 0 ? ` / ${money(r.budget)}` : ""}
                      </span>
                    </div>
                    <BarRow frac={bar.frac} color={bar.color} markerFrac={bar.markerFrac} title={money(r.actual)} />
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* (d) top vendors — selected month, excludeFromTotals applied */}
        <section className="card">
          <div className="card-header">{t("dash.vendors.title")}</div>
          {data.vendors.length === 0 ? (
            <p className="muted">{t("dash.vendors.empty")}</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {(() => {
                const scale = Math.max(1, ...data.vendors.map((v) => v.spend));
                return data.vendors.map((v) => (
                  <button key={v.key} className="budget-row row" style={{ alignItems: "center", gap: 8 }} onClick={() => setVendorDetail(v)}>
                    <VendorIcon name={v.name} link={v.link} icon={v.icon} size={20} />
                    <span style={{ flex: "0 0 90px", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>
                      {v.name}
                    </span>
                    <div style={{ flex: 1 }}>
                      <BarRow frac={v.spend / scale} color="var(--primary)" markerFrac={null} title={money(v.spend)} />
                    </div>
                    <span className="muted" style={{ flex: "0 0 auto", fontSize: 13 }}>{money(v.spend)}</span>
                  </button>
                ));
              })()}
            </div>
          )}
        </section>
      </div>

      {/* (e) biggest transactions of the selected month — each expands to
          re-categorise (with a reason) or merge, same as the drilldowns. */}
      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-header">{t("dash.topTxns.title")}</div>
        {data.topTransactions.length === 0 ? (
          <p className="muted">{t("dash.topTxns.empty")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {data.topTransactions.map((x) => (
              <TxnRow
                key={x.id}
                txn={x}
                current={x.categoryName ?? ""}
                cats={cats}
                money={money}
                dateLabel={dateLabel}
                onSaved={() => load(month)}
              />
            ))}
          </div>
        )}
      </section>

      {detail && (
        <BudgetDialog
          row={detail}
          month={month}
          monthYearLabel={monthYearLabel}
          money={money}
          numLocale={numLocale}
          onClose={() => setDetail(null)}
          onSaved={() => load(month)}
        />
      )}

      {vendorDetail && (
        <VendorDialog
          vendor={vendorDetail}
          month={month}
          monthYearLabel={monthYearLabel}
          money={money}
          numLocale={numLocale}
          onClose={() => setVendorDetail(null)}
          onSaved={() => load(month)}
        />
      )}
    </div>
  );
}

type DialogTxn = {
  id: string;
  txnId: string | null; // whole-txn id for category override; null for groups/split parts
  title: string;
  categoryName?: string | null; // the txn's own category (vendor dialog spans categories)
  vendorName: string;
  vendorLink: string | null;
  vendorIcon: string | null;
  date: string;
  amount: number;
  currency: string | null;
};

// Modal for one Budget-vs-actual row: edit the monthly budget and list the
// effective transactions behind the month's "actual" (same read model, so they
// sum to it). Each plain transaction expands to re-categorise it (with a reason).
// Closes on overlay click / Escape / Close.
function BudgetDialog({
  row,
  month,
  monthYearLabel,
  money,
  numLocale,
  onClose,
  onSaved,
}: {
  row: DashboardData["budget"][number];
  month: string;
  monthYearLabel: (k: string) => string;
  money: (n: number) => string;
  numLocale: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [txns, setTxns] = useState<DialogTxn[] | null>(null);
  const [cats, setCats] = useState<string[]>([]);
  const [budget, setBudget] = useState(String(row.budget || ""));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reloadTxns = () =>
    fetch(`/api/dashboard/category?month=${month}&name=${encodeURIComponent(row.name)}`)
      .then((r) => (r.ok ? r.json() : { transactions: [] }))
      .then((d) => setTxns(d.transactions))
      .catch(() => setTxns([]));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    reloadTxns();
    fetch("/api/categories")
      .then((r) => (r.ok ? r.json() : { categories: [] }))
      .then((d) => setCats((d.categories ?? []).map((c: { name: string }) => c.name)))
      .catch(() => {});
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, row.name, onClose]);

  // Live actual = sum of the shown rows, so the header follows category overrides
  // (a re-categorised txn leaves this list) without waiting on the parent reload.
  const shownActual = txns ? txns.reduce((s, x) => s + x.amount, 0) : row.actual;

  const save = async () => {
    if (!row.id) return;
    const n = Number(budget);
    if (!isFinite(n) || n < 0) {
      setErr(t("common.genericError"));
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/categories", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: row.id, budget: n }),
      });
      if (!res.ok) {
        setErr((await res.json().catch(() => null))?.error ?? t("common.genericError"));
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(numLocale, { month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflow: "auto", zIndex: 50 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="card" style={{ maxWidth: 560, width: "100%", margin: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div className="card-header" style={{ margin: 0 }}>{row.name}</div>
            <div className="muted" style={{ fontSize: 13 }}>{monthYearLabel(month)}</div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>{t("common.close")}</button>
        </div>

        {row.id && (
          <div className="row" style={{ alignItems: "flex-end", gap: 10, marginBottom: 16 }}>
            <div style={{ flex: "0 0 auto" }}>
              <label htmlFor="budget-edit" style={{ marginTop: 0 }}>{t("dash.budget.budgetLabel")}</label>
              <input id="budget-edit" className="budget" type="number" min={0} step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
              {saving ? t("common.saving") : t("common.save")}
            </button>
            <span className="muted" style={{ fontSize: 13 }}>{money(shownActual)}{row.budget > 0 ? ` / ${money(row.budget)}` : ""}</span>
          </div>
        )}
        {err && <p className="error">{err}</p>}

        <div className="card-header" style={{ fontSize: 14, marginBottom: 8 }}>{t("dash.budget.txns")}</div>
        {txns == null ? (
          <p className="muted">{t("common.loading")}</p>
        ) : txns.length === 0 ? (
          <p className="muted">{t("dash.budget.noTxns")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {txns.map((x) => (
              <TxnRow
                key={x.id}
                txn={x}
                current={x.categoryName ?? row.name}
                cats={cats}
                money={money}
                dateLabel={dateLabel}
                onSaved={() => {
                  reloadTxns();
                  onSaved();
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Modal for one Top-vendors row: lists the effective transactions behind the
// vendor's monthly spend (same read model + exclusion, so they sum to it). Like
// BudgetDialog but no budget to edit — reuses TxnRow, so each plain txn still
// expands to re-categorise (with a reason) or merge. Closes on overlay/Escape/Close.
function VendorDialog({
  vendor,
  month,
  monthYearLabel,
  money,
  numLocale,
  onClose,
  onSaved,
}: {
  vendor: DashboardData["vendors"][number];
  month: string;
  monthYearLabel: (k: string) => string;
  money: (n: number) => string;
  numLocale: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [txns, setTxns] = useState<DialogTxn[] | null>(null);
  const [cats, setCats] = useState<string[]>([]);

  const reloadTxns = () =>
    fetch(`/api/dashboard/vendor?month=${month}&key=${encodeURIComponent(vendor.key)}`)
      .then((r) => (r.ok ? r.json() : { transactions: [] }))
      .then((d) => setTxns(d.transactions))
      .catch(() => setTxns([]));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    reloadTxns();
    fetch("/api/categories")
      .then((r) => (r.ok ? r.json() : { categories: [] }))
      .then((d) => setCats((d.categories ?? []).map((c: { name: string }) => c.name)))
      .catch(() => {});
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, vendor.key, onClose]);

  // Live spend = sum of the shown rows, so the header follows overrides/merges
  // (a re-categorised-out or merged txn changes the total) without a full reload.
  const shownSpend = txns ? txns.reduce((s, x) => s + x.amount, 0) : vendor.spend;

  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(numLocale, { month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflow: "auto", zIndex: 50 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="card" style={{ maxWidth: 560, width: "100%", margin: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div className="row" style={{ gap: 10, minWidth: 0 }}>
            <VendorIcon name={vendor.name} link={vendor.link} icon={vendor.icon} size={20} />
            <div style={{ minWidth: 0 }}>
              <div className="card-header" style={{ margin: 0 }}>{vendor.name}</div>
              <div className="muted" style={{ fontSize: 13 }}>{monthYearLabel(month)} · {money(shownSpend)}</div>
            </div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>{t("common.close")}</button>
        </div>

        <div className="card-header" style={{ fontSize: 14, marginBottom: 8 }}>{t("dash.budget.txns")}</div>
        {txns == null ? (
          <p className="muted">{t("common.loading")}</p>
        ) : txns.length === 0 ? (
          <p className="muted">{t("dash.budget.noTxns")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {txns.map((x) => (
              <TxnRow
                key={x.id}
                txn={x}
                current={x.categoryName ?? ""}
                cats={cats}
                money={money}
                dateLabel={dateLabel}
                onSaved={() => {
                  reloadTxns();
                  onSaved();
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// One transaction line in the budget dialog. Plain transactions (txnId != null)
// expand to a category picker + required reason and PATCH /api/transactions/[id]
// — the same per-transaction override the Review page sets. Merge groups and
// split parts aren't single overridable transactions, so they don't expand.
function TxnRow({
  txn,
  current,
  cats,
  money,
  dateLabel,
  onSaved,
}: {
  txn: DialogTxn;
  current: string;
  cats: string[];
  money: (n: number) => string;
  dateLabel: (iso: string) => string;
  onSaved: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  const [cat, setCat] = useState(current);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canEdit = txn.txnId != null;

  const save = async () => {
    if (!txn.txnId || !reason.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/transactions/${txn.txnId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryName: cat, reason: reason.trim() }),
      });
      if (!res.ok) {
        setErr((await res.json().catch(() => null))?.error ?? t("common.genericError"));
        return;
      }
      setOpen(false);
      setReason("");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <button
        className="budget-row"
        style={{ margin: 0, padding: "8px 0", cursor: canEdit ? "pointer" : "default" }}
        onClick={() => canEdit && setOpen((o) => !o)}
        disabled={!canEdit}
      >
        <div className="row" style={{ gap: 10 }}>
          <VendorIcon name={txn.vendorName} link={txn.vendorLink} icon={txn.vendorIcon} size={18} />
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>{txn.title}</span>
          <span className="muted" style={{ flex: "0 0 auto", fontSize: 13 }}>{dateLabel(txn.date)}</span>
          <span style={{ flex: "0 0 auto", minWidth: 72, textAlign: "right" }}>{money(txn.amount)}</span>
        </div>
      </button>
      {open && (
        <div className="row wrap" style={{ gap: 8, padding: "0 0 10px", alignItems: "flex-end" }}>
          <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: "auto", flex: "0 0 auto" }} aria-label={t("review.setCategory")}>
            {cats.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("review.categoryReasonPlaceholder")}
            style={{ flex: 1, minWidth: 140 }}
          />
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !reason.trim()}>
            {saving ? t("common.saving") : t("common.save")}
          </button>
          <button className="btn btn-sm" onClick={() => setMerging(true)}>{t("review.merge")}</button>
          {err && <p className="error" style={{ width: "100%", margin: 0 }}>{err}</p>}
        </div>
      )}
      {merging && (
        <ReviewMergePicker
          seedId={txn.txnId!}
          onClose={() => setMerging(false)}
          onMerged={() => {
            setMerging(false);
            setOpen(false);
            onSaved();
          }}
        />
      )}
    </div>
  );
}

// ---- widgets ---------------------------------------------------------------

// Categorical palette for the donut — the dataviz skill's CVD-validated 8-hue
// order (fixed order IS the colorblind-safety mechanism; validated ok on the
// white surface). "Everything else" uses --muted (assigned separately), so we
// show at most 7 named categories + the fold — never a cycled/generated 9th hue.
const DONUT_COLORS = [
  "#2a78d6", "#1baf7a", "#eda100", "#008300",
  "#4a3aa7", "#e34948", "#e87ba4", "#eb6834",
];

// (c) Spending-by-category donut + legend, hand-rolled SVG in the same no-library
// style as the other widgets. Full-width: a big donut on the left, a multi-column
// legend on the right, the month's total in the hole. Data reuses the budget rows:
// ROOTS only (parentName == null) sum to the month's total without double-counting,
// and positive actual = outflow (Plaid convention) so refunds/income drop out. Top
// 11 slices; the rest fold into "Everything else". Hovering a slice floats a tooltip
// and highlights its legend row; hovering a legend row highlights the slice.
function CategoryDonut({
  budget,
  money,
  totalLabel,
  otherLabel,
  emptyText,
  ariaLabel,
}: {
  budget: DashboardData["budget"];
  money: (n: number) => string;
  totalLabel: string;
  otherLabel: string;
  emptyText: string;
  ariaLabel: string;
}) {
  const [hi, setHi] = useState<number | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const roots = budget.filter((r) => !r.parentName && r.actual > 0).sort((a, b) => b.actual - a.actual);
  const total = roots.reduce((s, r) => s + r.actual, 0);
  if (total <= 0) return <p className="muted">{emptyText}</p>;

  const TOP = 7;
  const slices = roots.slice(0, TOP).map((r, i) => ({ name: r.name, value: r.actual, color: DONUT_COLORS[i % DONUT_COLORS.length] }));
  const tail = roots.slice(TOP);
  if (tail.length) slices.push({ name: otherLabel, value: tail.reduce((s, r) => s + r.actual, 0), color: "var(--muted)" });

  const R = 42, SW = 15, C = 2 * Math.PI * R;
  const pct = (v: number) => ((v / total) * 100).toFixed(1);
  const active = hi != null ? slices[hi] : null;
  let acc = 0;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 32, alignItems: "center", justifyContent: "center" }}>
      {/* donut + cursor-following tooltip */}
      <div
        style={{ position: "relative", flex: "0 0 auto" }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
        }}
        onMouseLeave={() => { setHi(null); setPos(null); }}
      >
        <svg viewBox="0 0 120 120" role="img" aria-label={ariaLabel} style={{ display: "block", width: "min(260px, 68vw)", height: "auto", overflow: "visible" }}>
          <g transform="rotate(-90 60 60)">
            {slices.map((s, i) => {
              const frac = s.value / total;
              const seg = (
                <circle
                  key={s.name}
                  cx={60}
                  cy={60}
                  r={R}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={hi === i ? SW + 3 : SW}
                  strokeDasharray={`${frac * C} ${C}`}
                  strokeDashoffset={-acc * C}
                  opacity={hi == null || hi === i ? 1 : 0.4}
                  onMouseEnter={() => setHi(i)}
                  onMouseLeave={() => setHi(null)}
                  style={{ transition: "opacity 0.1s ease, stroke-width 0.1s ease" }}
                />
              );
              acc += frac;
              return seg;
            })}
          </g>
          <text x={60} y={57} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="var(--fg)">
            {money(total)}
          </text>
          <text x={60} y={68} textAnchor="middle" fontSize={6.5} fill="var(--muted)" letterSpacing="0.04em">
            {totalLabel.toUpperCase()}
          </text>
        </svg>
        {active && pos && (
          <div
            style={{
              position: "absolute", left: pos.x + 14, top: pos.y + 14, pointerEvents: "none",
              background: "var(--fg)", color: "var(--bg-2)", padding: "7px 10px", borderRadius: 8,
              fontSize: 12, whiteSpace: "nowrap", zIndex: 5, boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
            }}
          >
            <div className="row" style={{ gap: 7, alignItems: "center", fontWeight: 600 }}>
              <span aria-hidden style={{ width: 9, height: 9, borderRadius: "50%", background: active.color }} />
              {active.name}
            </div>
            <div style={{ opacity: 0.85, marginTop: 2 }}>{money(active.value)} ({pct(active.value)}%)</div>
          </div>
        )}
      </div>

      {/* legend — multi-column grid, mirrors the screenshot */}
      <div
        style={{
          flex: "1 1 340px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
          gap: "6px 12px",
          alignSelf: "center",
        }}
      >
        {slices.map((s, i) => (
          <div
            key={s.name}
            className="row"
            style={{
              gap: 10, alignItems: "flex-start", padding: "7px 10px", borderRadius: 8,
              border: `1px solid ${hi === i ? "var(--border)" : "transparent"}`,
              background: hi === i ? "var(--bg-3)" : "transparent",
              opacity: hi == null || hi === i ? 1 : 0.55,
              transition: "opacity 0.1s ease, background 0.1s ease",
            }}
            onMouseEnter={() => { setHi(i); setPos(null); }}
            onMouseLeave={() => setHi(null)}
          >
            <span aria-hidden style={{ flex: "0 0 auto", width: 10, height: 10, borderRadius: "50%", background: s.color, marginTop: 4 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13.5, fontWeight: 500 }}>{s.name}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{money(s.value)} <span style={{ opacity: 0.8 }}>({pct(s.value)}%)</span></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// (a) Monthly-spend trend as an area+line chart (dataviz "change over time" →
// line). One responsive <svg>, ledger-green line over a gradient fill, a dashed
// average reference line, the selected month marked, and a hover crosshair with
// the month + amount. Clicking a month jumps the rest of the dashboard to it.
function TrendChart({
  data,
  monthLabel,
  money,
  emptyText,
  ariaLabel,
  selectedIndex,
  onPick,
}: {
  data: { month: string; spend: number }[];
  monthLabel: (k: string) => string;
  money: (n: number) => string;
  emptyText: string;
  ariaLabel: string;
  selectedIndex: number;
  onPick: (month: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  // Measure the container so the chart fills width at a FIXED height (viewBox unit
  // == 1px) — otherwise the fixed aspect ratio makes it balloon on wide screens.
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => { const cw = es[0]?.contentRect.width; if (cw) setW(cw); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const vals = data.map((d) => d.spend);
  if (vals.every((v) => v === 0)) return <p className="muted">{emptyText}</p>;

  // Signed scale around a zero baseline so net-inflow months (spend < 0) dip below.
  const hi = Math.max(0, ...vals);
  const lo = Math.min(0, ...vals);
  const span = hi - lo || 1;
  const H = 232, padT = 22, padB = 26, padL = 14, padR = 16;
  const chartH = H - padT - padB;
  const y = (v: number) => padT + ((hi - v) / span) * chartH;
  const zeroY = y(0);
  const n = data.length;
  const x = (i: number) => (n === 1 ? padL : padL + (i / (n - 1)) * (W - padL - padR));
  const active = vals.filter((v) => v > 0);
  const avg = active.length ? active.reduce((s, v) => s + v, 0) / active.length : 0;

  const pts = data.map((d, i) => [x(i), y(d.spend)] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${zeroY.toFixed(1)} L${x(0).toFixed(1)},${zeroY.toFixed(1)} Z`;

  const cur = hover; // annotate the hovered point
  const showSel = selectedIndex >= 0 && selectedIndex < n;

  return (
    <div ref={wrap}>
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={ariaLabel} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.20} />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* average reference line */}
      {avg > 0 && (
        <>
          <line x1={padL} y1={y(avg)} x2={W - padR} y2={y(avg)} stroke="var(--muted)" strokeWidth={1} strokeDasharray="4 4" opacity={0.55} />
          <text x={W - padR} y={y(avg) - 4} textAnchor="end" fontSize={10} fill="var(--muted)">avg {money(avg)}</text>
        </>
      )}

      <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="var(--border)" />
      <path d={area} fill="url(#trendFill)" />
      <path d={line} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {/* selected-month marker: subtle guide + filled dot */}
      {showSel && (
        <>
          <line x1={x(selectedIndex)} y1={padT} x2={x(selectedIndex)} y2={zeroY} stroke="var(--primary)" strokeWidth={1} opacity={0.28} />
          <circle cx={x(selectedIndex)} cy={y(data[selectedIndex].spend)} r={4} fill="var(--primary)" stroke="var(--bg-2)" strokeWidth={2} />
        </>
      )}

      {/* month labels */}
      {data.map((d, i) => (
        <text
          key={`lbl-${d.month}`}
          x={x(i)} y={H - 9} textAnchor="middle" fontSize={10}
          fontWeight={cur === i || (cur == null && i === selectedIndex) ? 600 : 400}
          fill={cur === i ? "var(--fg)" : "var(--muted)"}
        >
          {monthLabel(d.month)}
        </text>
      ))}

      {/* hover crosshair + emphasized point + floating month · amount */}
      {cur != null && (
        <>
          <line x1={x(cur)} y1={padT} x2={x(cur)} y2={zeroY} stroke="var(--fg)" strokeWidth={1} opacity={0.18} />
          <circle cx={x(cur)} cy={y(data[cur].spend)} r={4.5} fill="var(--primary)" stroke="var(--bg-2)" strokeWidth={2} />
          <text
            x={Math.min(Math.max(x(cur), padL + 46), W - padR - 46)}
            y={Math.max(y(data[cur].spend) - 12, padT + 8)}
            textAnchor="middle" fontSize={12} fontWeight={600}
            fill="var(--fg)" stroke="var(--bg-2)" strokeWidth={3.5} paintOrder="stroke"
            style={{ pointerEvents: "none" }}
          >
            {monthLabel(data[cur].month)} · {money(data[cur].spend)}
          </text>
        </>
      )}

      {/* full-height transparent hit targets — hover to inspect, click to select */}
      {data.map((d, i) => {
        const w = (W - padL - padR) / n;
        return (
          <rect
            key={`hit-${d.month}`}
            x={x(i) - w / 2}
            y={padT}
            width={w}
            height={chartH + 8}
            fill="transparent"
            style={{ cursor: "pointer" }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onPick(d.month)}
          />
        );
      })}
    </svg>
    </div>
  );
}

// A single horizontal bar (svg <rect>) over a track, with an optional budget
// marker line. Percentage widths keep it responsive inside a flex cell. `title`
// gives a native hover tooltip of the value.
function BarRow({ frac, color, markerFrac, title }: { frac: number; color: string; markerFrac: number | null; title?: string }) {
  return (
    <svg width="100%" height={12} preserveAspectRatio="none" style={{ display: "block" }}>
      {title && <title>{title}</title>}
      <rect x={0} y={1} width="100%" height={10} rx={2} fill="var(--bg-3)" />
      <rect x={0} y={1} width={`${clamp01(frac) * 100}%`} height={10} rx={2} fill={color} />
      {markerFrac != null && (
        <line
          x1={`${clamp01(markerFrac) * 100}%`}
          y1={0}
          x2={`${clamp01(markerFrac) * 100}%`}
          y2={12}
          stroke="var(--fg)"
          strokeWidth={1.5}
        />
      )}
    </svg>
  );
}
