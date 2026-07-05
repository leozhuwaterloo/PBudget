"use client";
import { useState } from "react";
import Link from "next/link";
import { useT, useLocale } from "@/lib/i18n/context";
import { getBrandIcon, letterAvatar } from "@/lib/catalog/icons";
import type { DashboardData } from "@/lib/dashboard";

// Graphs-only Dashboard (FR7): four hand-rolled inline-SVG widgets in the
// Statement theme — NO chart library. All numbers come from F2's effective read
// model via /lib/dashboard. "Spend" = net signed amount (Plaid convention,
// + = outflow). The month selector drives (b) budget-vs-actual and (d) top
// vendors only; (a) trend and (c) items-to-review are fixed windows (assumption 5).

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

  const changeMonth = async (m: string) => {
    if (!m) return;
    setMonth(m);
    setBusy(true);
    try {
      const res = await fetch(`/api/dashboard?month=${m}`);
      if (res.ok) setData(await res.json());
    } finally {
      setBusy(false);
    }
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
        <TrendChart data={data.trend} monthLabel={monthLabel} money={money} emptyText={t("dash.trend.empty")} />
      </section>

      {/* (c) items to review — stat tiles, fixed window */}
      <section className="card">
        <div className="card-header">{t("dash.review.title")}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <ReviewTile n={data.review.unmatched} label={t("dash.review.unmatched")} anchor="unmatched" tone="var(--warning)" />
          <ReviewTile n={data.review.conflicts} label={t("dash.review.conflicts")} anchor="conflicts" tone="var(--danger)" />
          <ReviewTile n={data.review.suspicion} label={t("dash.review.suspicion")} anchor="suspicion" tone="var(--warning)" />
          <ReviewTile n={data.review.pending} label={t("dash.review.pending")} anchor="pending" tone="var(--primary)" />
        </div>
      </section>

      {/* shared month selector for (b) and (d) */}
      <div className="row" style={{ alignItems: "center", gap: 8, margin: "18px 0 6px" }}>
        <label htmlFor="dash-month" style={{ margin: 0 }}>{t("dash.month")}</label>
        <input
          id="dash-month"
          type="month"
          value={month}
          disabled={busy}
          onChange={(e) => changeMonth(e.target.value)}
        />
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
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {(() => {
                const scale = Math.max(1, ...data.budget.map((r) => Math.max(r.actual, r.budget)));
                return data.budget.map((r) => {
                  const over = r.budget > 0 && r.actual > r.budget;
                  const color = r.budget === 0 || over ? "var(--warning)" : "var(--success)";
                  return (
                    <div key={r.name}>
                      <div className="row" style={{ justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
                        <span>{r.name}</span>
                        <span className="muted">
                          {money(r.actual)}
                          {r.budget > 0 ? ` / ${money(r.budget)}` : ""}
                        </span>
                      </div>
                      <BarRow frac={r.actual / scale} color={color} markerFrac={r.budget > 0 ? r.budget / scale : null} />
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
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(() => {
                const scale = Math.max(1, ...data.vendors.map((v) => v.spend));
                return data.vendors.map((v) => (
                  <div key={v.key} className="row" style={{ alignItems: "center", gap: 8 }}>
                    <VendorGlyph name={v.name} icon={v.icon} />
                    <span style={{ flex: "0 0 90px", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {v.name}
                    </span>
                    <div style={{ flex: 1 }}>
                      <BarRow frac={v.spend / scale} color="var(--primary)" markerFrac={null} />
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
// width 100%), Statement-green bars, month labels, per-bar <title> tooltip.
function TrendChart({
  data,
  monthLabel,
  money,
  emptyText,
}: {
  data: { month: string; spend: number }[];
  monthLabel: (k: string) => string;
  money: (n: number) => string;
  emptyText: string;
}) {
  const max = Math.max(...data.map((d) => d.spend));
  if (max <= 0) return <p className="muted">{emptyText}</p>;

  const W = 640, H = 200, padB = 26, padT = 12, padL = 4, padR = 4;
  const chartH = H - padB - padT;
  const step = (W - padL - padR) / data.length;
  const bw = step * 0.6;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Monthly spend trend" style={{ display: "block" }}>
      <line x1={padL} y1={padT + chartH} x2={W - padR} y2={padT + chartH} stroke="var(--border)" />
      {data.map((d, i) => {
        const h = (d.spend / max) * chartH;
        const x = padL + i * step + (step - bw) / 2;
        const y = padT + chartH - h;
        return (
          <g key={d.month}>
            <rect x={x} y={y} width={bw} height={h} fill="var(--primary)" rx={1.5}>
              <title>{`${monthLabel(d.month)}: ${money(d.spend)}`}</title>
            </rect>
            <text x={padL + i * step + step / 2} y={H - 9} textAnchor="middle" fontSize={10} fill="var(--muted)">
              {monthLabel(d.month)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// A single horizontal bar (svg <rect>) over a track, with an optional budget
// marker line. Percentage widths keep it responsive inside a flex cell.
function BarRow({ frac, color, markerFrac }: { frac: number; color: string; markerFrac: number | null }) {
  return (
    <svg width="100%" height={12} preserveAspectRatio="none" style={{ display: "block" }}>
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

// (c) One stat tile deep-linking into a /review section.
function ReviewTile({ n, label, anchor, tone }: { n: number; label: string; anchor: string; tone: string }) {
  return (
    <Link
      href={`/review#${anchor}`}
      className="card"
      style={{ flex: "1 1 130px", margin: 0, textDecoration: "none", color: "var(--fg)", borderLeft: `3px solid ${tone}` }}
    >
      <div style={{ fontFamily: "var(--serif)", fontSize: 30, fontWeight: 600, lineHeight: 1 }}>{n}</div>
      <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{label}</div>
    </Link>
  );
}

// (d) Vendor icon: bundled brand SVG (monochrome) or a deterministic letter avatar.
function VendorGlyph({ name, icon }: { name: string; icon: string | null }) {
  const brand = getBrandIcon(icon);
  if (brand) {
    return (
      <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden style={{ flex: "0 0 auto" }}>
        <path d={brand.path} fill="var(--primary)" />
      </svg>
    );
  }
  const { letter, hue } = letterAvatar(name);
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden style={{ flex: "0 0 auto" }}>
      <circle cx={12} cy={12} r={12} fill={`hsl(${hue} 42% 42%)`} />
      <text x={12} y={16} textAnchor="middle" fontSize={12} fontFamily="var(--serif)" fill="#fff">
        {letter}
      </text>
    </svg>
  );
}
