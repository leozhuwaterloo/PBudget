"use client";
import { useEffect, useState } from "react";
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
        {/* (c) spending distribution by category — selected month */}
        <section className="card">
          <div className="card-header">{t("dash.categories.title")}</div>
          <CategoryDonut
            budget={data.budget}
            money={money}
            otherLabel={t("dash.categories.other")}
            spentLabel={t("dash.categories.spent")}
            emptyText={t("dash.categories.empty")}
            ariaLabel={t("dash.categories.aria")}
          />
        </section>

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

// Categorical palette for the donut — distinguishable on the light paper bg,
// leading with the ledger green. "Other" uses --muted (assigned separately).
const DONUT_COLORS = [
  "#15684a", "#4b6bfb", "#b45309", "#8b5cf6", "#0ea5e9",
  "#2f8f6a", "#d98b3a", "#e11d48", "#5bb98b", "#6366f1",
];

// (c) Spending-by-category donut + legend, hand-rolled SVG in the same no-library
// style as the other widgets. Data reuses the budget rows: ROOTS only (parentName
// == null) sum to the month's total without double-counting, and positive actual =
// outflow (Plaid convention) so refunds/income drop out. Top 8 slices; the rest
// fold into "Other". Hovering a slice or legend row focuses it and swaps the
// center label to that slice's amount + share.
function CategoryDonut({
  budget,
  money,
  otherLabel,
  spentLabel,
  emptyText,
  ariaLabel,
}: {
  budget: DashboardData["budget"];
  money: (n: number) => string;
  otherLabel: string;
  spentLabel: string;
  emptyText: string;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const roots = budget.filter((r) => !r.parentName && r.actual > 0).sort((a, b) => b.actual - a.actual);
  const total = roots.reduce((s, r) => s + r.actual, 0);
  if (total <= 0) return <p className="muted">{emptyText}</p>;

  const TOP = 8;
  const slices = roots.slice(0, TOP).map((r, i) => ({ name: r.name, value: r.actual, color: DONUT_COLORS[i % DONUT_COLORS.length] }));
  const tail = roots.slice(TOP);
  if (tail.length) slices.push({ name: otherLabel, value: tail.reduce((s, r) => s + r.actual, 0), color: "var(--muted)" });

  const R = 45, SW = 18, C = 2 * Math.PI * R;
  const pct = (v: number) => Math.round((v / total) * 100);
  const active = hover != null ? slices[hover] : null;
  let acc = 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <svg viewBox="0 0 120 120" width={176} height={176} role="img" aria-label={ariaLabel} style={{ overflow: "visible" }}>
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
                  strokeWidth={hover === i ? SW + 4 : SW}
                  strokeDasharray={`${frac * C} ${C}`}
                  strokeDashoffset={-acc * C}
                  opacity={hover == null || hover === i ? 1 : 0.35}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  style={{ transition: "opacity 0.1s ease, stroke-width 0.1s ease" }}
                >
                  <title>{`${s.name} · ${money(s.value)}`}</title>
                </circle>
              );
              acc += frac;
              return seg;
            })}
          </g>
          <text x={60} y={58} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--fg)">
            {money(active ? active.value : total)}
          </text>
          <text x={60} y={71} textAnchor="middle" fontSize={7.5} fill="var(--muted)">
            {active ? `${active.name} · ${pct(active.value)}%` : spentLabel}
          </text>
        </svg>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {slices.map((s, i) => (
          <div
            key={s.name}
            className="row"
            style={{ gap: 8, alignItems: "center", opacity: hover == null || hover === i ? 1 : 0.5, transition: "opacity 0.1s ease" }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span aria-hidden style={{ flex: "0 0 auto", width: 10, height: 10, borderRadius: 2, background: s.color }} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>{s.name}</span>
            <span className="muted" style={{ flex: "0 0 auto", fontSize: 12 }}>{pct(s.value)}%</span>
            <span style={{ flex: "0 0 auto", fontSize: 13, minWidth: 72, textAlign: "right" }}>{money(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
