"use client";
import { useState } from "react";
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

  const changeMonth = async (m: string) => {
    if (!m || m === month) return;
    setMonth(m);
    setBusy(true);
    try {
      const res = await fetch(`/api/dashboard?month=${m}`);
      if (res.ok) setData(await res.json());
    } finally {
      setBusy(false);
    }
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
                const scale = Math.max(1, ...data.budget.map((r) => Math.max(r.actual, r.budget)));
                return data.budget.map((r) => {
                  const over = r.budget > 0 && r.actual > r.budget;
                  const color = r.budget === 0 || over ? "var(--warning)" : "var(--success)";
                  return (
                    <div key={r.name}>
                      <div className="row" style={{ justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                        <span>{r.name}</span>
                        <span className="muted">
                          {money(r.actual)}
                          {r.budget > 0 ? ` / ${money(r.budget)}` : ""}
                        </span>
                      </div>
                      <BarRow frac={r.actual / scale} color={color} markerFrac={r.budget > 0 ? r.budget / scale : null} title={money(r.actual)} />
                    </div>
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
  const max = Math.max(...data.map((d) => d.spend));
  if (max <= 0) return <p className="muted">{emptyText}</p>;

  const W = 640, H = 210, padB = 26, padT = 26, padL = 4, padR = 4;
  const chartH = H - padB - padT;
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
      <line x1={padL} y1={padT + chartH} x2={W - padR} y2={padT + chartH} stroke="var(--border)" />
      {data.map((d, i) => {
        const h = (d.spend / max) * chartH;
        return (
          <g key={d.month}>
            <rect
              x={barX(i)}
              y={padT + chartH - h}
              width={bw}
              height={h}
              fill="var(--primary)"
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
      {/* floating amount for the hovered column */}
      {hover != null && (
        <text
          x={colCx(hover)}
          y={padT + chartH - (data[hover].spend / max) * chartH - 8}
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
