"use client";
import { useEffect, useState } from "react";
import { useT, useLocale } from "@/lib/i18n/context";
import { VendorIcon } from "./VendorIcon";
import type { DashboardData } from "@/lib/dashboard";

// Graphs-only Dashboard (FR7): hand-rolled inline-SVG widgets in the Statement
// theme — NO chart library. All numbers come from F2's effective read model via
// /lib/dashboard. "Spend" = net signed amount (Plaid convention, + = outflow).
// The month is stepped with ‹/› buttons over the fixed 12-month trend window and
// drives (b) budget-vs-actual and (d) top vendors; (a) trend is the full window.

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export default function Dashboard({ initial }: { initial: DashboardData }) {
  const t = useT();
  const locale = useLocale();
  const numLocale = locale === "zh-Hans" ? "zh-CN" : "en-US";
  const [data, setData] = useState(initial);
  const [month, setMonth] = useState(initial.month);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<DashboardData["budget"][number] | null>(null);

  const money = (n: number) =>
    `${data.currency ? data.currency + " " : ""}${Math.round(n).toLocaleString(numLocale)}`;
  const monthLabel = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(numLocale, { month: "short", timeZone: "UTC" });
  };
  const monthYearLabel = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(numLocale, { month: "long", year: "numeric", timeZone: "UTC" });
  };

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

  return (
    <div>
      <h1>{t("dash.title")}</h1>

      {empty && <p className="muted">{t("dash.empty")}</p>}

      {/* (a) monthly spend trend — fixed 12-month window */}
      <section className="card">
        <div className="card-header">
          {t("dash.trend.title")} <span className="muted" style={{ fontWeight: 400 }}>· {t("dash.trend.sub")}</span>
        </div>
        <TrendChart data={data.trend} monthLabel={monthLabel} money={money} emptyText={t("dash.trend.empty")} ariaLabel={t("dash.trend.aria")} />
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 16,
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
                const scale = Math.max(1, ...data.budget.map((r) => Math.max(Math.abs(r.actual), r.budget)));
                return data.budget.map((r) => {
                  const inflow = r.actual < 0; // net money IN (refund/credit), not spend
                  const over = r.budget > 0 && r.actual > r.budget;
                  const color = inflow ? "var(--muted)" : r.budget === 0 || over ? "var(--warning)" : "var(--success)";
                  return (
                    <button key={r.name} className="budget-row" onClick={() => setDetail(r)}>
                      <div className="row" style={{ justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                        <span>{r.name}</span>
                        <span className="muted">
                          {money(r.actual)}
                          {r.budget > 0 ? ` / ${money(r.budget)}` : ""}
                        </span>
                      </div>
                      <BarRow frac={Math.abs(r.actual) / scale} color={color} markerFrac={r.budget > 0 ? r.budget / scale : null} title={money(r.actual)} />
                    </button>
                  );
                });
              })()}
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
                  <div key={v.key} className="row" style={{ alignItems: "center", gap: 8 }}>
                    <VendorIcon name={v.name} link={v.link} icon={v.icon} size={20} />
                    <span style={{ flex: "0 0 90px", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {v.name}
                    </span>
                    <div style={{ flex: 1 }}>
                      <BarRow frac={v.spend / scale} color="var(--primary)" markerFrac={null} title={money(v.spend)} />
                    </div>
                    <span className="muted" style={{ flex: "0 0 auto", fontSize: 13 }}>{money(v.spend)}</span>
                  </div>
                ));
              })()}
            </div>
          )}
        </section>
      </div>

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
    </div>
  );
}

// Modal for one Budget-vs-actual row: edit the monthly budget and list the
// effective transactions behind the month's "actual" (same read model, so they
// sum to it). Closes on overlay click / Escape / Close.
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
  const [txns, setTxns] = useState<
    { id: string; title: string; vendorName: string; vendorLink: string | null; vendorIcon: string | null; date: string; amount: number; currency: string | null }[] | null
  >(null);
  const [budget, setBudget] = useState(String(row.budget || ""));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    fetch(`/api/dashboard/category?month=${month}&name=${encodeURIComponent(row.name)}`)
      .then((r) => (r.ok ? r.json() : { transactions: [] }))
      .then((d) => setTxns(d.transactions))
      .catch(() => setTxns([]));
    return () => document.removeEventListener("keydown", onKey);
  }, [month, row.name, onClose]);

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
              <input id="budget-edit" className="budget" type="number" min={0} step="1" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
              {saving ? t("common.saving") : t("common.save")}
            </button>
            <span className="muted" style={{ fontSize: 13 }}>{money(row.actual)}{row.budget > 0 ? ` / ${money(row.budget)}` : ""}</span>
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
              <div key={x.id} className="row" style={{ gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <VendorIcon name={x.vendorName} link={x.vendorLink} icon={x.vendorIcon} size={18} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.title}</span>
                <span className="muted" style={{ flex: "0 0 auto", fontSize: 13 }}>{dateLabel(x.date)}</span>
                <span style={{ flex: "0 0 auto", minWidth: 72, textAlign: "right" }}>{money(x.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- widgets ---------------------------------------------------------------

// (a) Vertical bar chart of monthly spend. One responsive <svg> (viewBox +
// width 100%), Statement-green bars, month labels. Hovering a column highlights
// it and floats its amount above the bar; the rest dim to focus attention.
function TrendChart({
  data,
  monthLabel,
  money,
  emptyText,
  ariaLabel,
}: {
  data: { month: string; spend: number }[];
  monthLabel: (k: string) => string;
  money: (n: number) => string;
  emptyText: string;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const vals = data.map((d) => d.spend);
  if (vals.every((v) => v === 0)) return <p className="muted">{emptyText}</p>;

  // Signed scale around a zero baseline: net-inflow months (spend < 0) draw as
  // bars dipping BELOW the axis instead of rendering as invisible negative height.
  const hi = Math.max(0, ...vals);
  const lo = Math.min(0, ...vals);
  const span = hi - lo || 1;
  const W = 640, H = 210, padB = 26, padT = 26, padL = 4, padR = 4;
  const chartH = H - padB - padT;
  const y = (v: number) => padT + ((hi - v) / span) * chartH; // value → pixel Y
  const zeroY = y(0);
  const step = (W - padL - padR) / data.length;
  const bw = step * 0.6;
  const barX = (i: number) => padL + i * step + (step - bw) / 2;
  const colCx = (i: number) => padL + i * step + step / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel} style={{ display: "block", overflow: "visible" }}>
      {/* hovered column highlight */}
      {hover != null && (
        <rect x={padL + hover * step} y={padT} width={step} height={chartH} fill="var(--bg-3)" rx={3} />
      )}
      <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="var(--border)" />
      {data.map((d, i) => {
        const neg = d.spend < 0;
        const yv = y(d.spend);
        return (
          <g key={d.month}>
            <rect
              x={barX(i)}
              y={Math.min(yv, zeroY)}
              width={bw}
              height={Math.abs(yv - zeroY)}
              fill={neg ? "var(--muted)" : "var(--primary)"}
              opacity={hover == null || hover === i ? 1 : 0.4}
              rx={1.5}
              style={{ transition: "opacity 0.1s ease" }}
            />
            <text x={colCx(i)} y={H - 9} textAnchor="middle" fontSize={10} fontWeight={hover === i ? 600 : 400} fill={hover === i ? "var(--fg)" : "var(--muted)"}>
              {monthLabel(d.month)}
            </text>
          </g>
        );
      })}
      {/* floating amount for the hovered column — above an up bar, below a down bar */}
      {hover != null && (
        <text
          x={colCx(hover)}
          y={data[hover].spend < 0 ? y(data[hover].spend) + 15 : y(data[hover].spend) - 8}
          textAnchor="middle"
          fontSize={12}
          fontWeight={600}
          fill="var(--fg)"
          stroke="var(--bg-2)"
          strokeWidth={3}
          paintOrder="stroke"
          style={{ pointerEvents: "none" }}
        >
          {money(data[hover].spend)}
        </text>
      )}
      {/* full-height transparent hit targets so thin bars are easy to hover */}
      {data.map((d, i) => (
        <rect
          key={`hit-${d.month}`}
          x={padL + i * step}
          y={padT}
          width={step}
          height={chartH}
          fill="transparent"
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
        />
      ))}
    </svg>
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
