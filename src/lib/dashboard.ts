import { prisma } from "./db";
import { effectiveTransactions } from "./analysis/effective";
import { reviewData } from "./review";

// Dashboard aggregate (FR7). Everything reads through F2's effective read model
// (merge-, split- and vendor-aware, category-resolved at read time) so config
// changes move spend retroactively. "Spend" = net signed amount (Plaid
// convention, + = outflow; refunds subtract). Called from the server page for
// first paint and from /api/dashboard on month change.

const TOP_VENDORS = 20;
const TOP_TXNS = 10;

const monthKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

// The 12 month keys ending at (and including) `now`, oldest → newest.
function last12Months(now: Date): string[] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const out: string[] = [];
  for (let i = 11; i >= 0; i--) out.push(monthKey(new Date(Date.UTC(y, m - i, 1))));
  return out;
}

// Default view = the PREVIOUS (complete) month, since early in a month the current
// one is mostly empty. Exception: on the last day of the month the current month is
// itself complete, so default to it.
function defaultMonth(now: Date): string {
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const lastDay = tomorrow.getUTCMonth() !== now.getUTCMonth();
  const d = lastDay ? now : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return monthKey(d);
}

export type DashboardData = {
  month: string; // selected "YYYY-MM" (drives budget + vendors widgets)
  currency: string | null; // modal currency, for display labels
  trend: { month: string; spend: number }[]; // (a) last 12 months, oldest → newest
  // (b) selected month; hierarchical — `parentName` set on a child row (indented
  // under its parent), `actual` is rolled-up for a parent, own for a leaf.
  budget: { id: string | null; name: string; parentName: string | null; budget: number; actual: number }[];
  review: number; // (c) open "needs review" items, windowed to match the Review page
  vendors: { key: string; name: string; link: string | null; icon: string | null; spend: number }[]; // (d) selected month
  // (e) biggest transactions of the selected month
  topTransactions: {
    id: string;
    txnId: string | null;
    title: string;
    categoryName: string | null;
    vendorName: string;
    vendorLink: string | null;
    vendorIcon: string | null;
    date: string;
    amount: number;
    currency: string | null;
  }[];
};

export type BudgetRow = DashboardData["budget"][number];
type CategoryLite = { id: string; name: string; budget: unknown; parentName: string | null; excludeFromTotals: boolean };

// Build the hierarchical budget-vs-actual rows from per-category OWN spend
// (actualByCat: each txn counted once, excluded categories already dropped). A
// parent category ROLLS UP its children's own spend (2-level cap: a parent has no
// parent), so its `actual` covers the whole subtree; a leaf's `actual` is its own.
// Rows are ordered parent-then-its-children and carry `parentName` for indenting.
// Reconciliation: Σ over roots of `actual` == Σ own spend == this month's trend bar
// (each txn once — never sum a parent AND its children). Exported for unit testing.
export function buildBudgetRows(actualByCat: Map<string, number>, categories: CategoryLite[]): BudgetRow[] {
  const excluded = new Set(categories.filter((c) => c.excludeFromTotals).map((c) => c.name));
  const budgetOf = new Map(categories.map((c) => [c.name, Number(c.budget)]));
  const idOf = new Map(categories.map((c) => [c.name, c.id]));
  const parentOf = new Map(categories.map((c) => [c.name, c.parentName]));
  const existsCat = new Set(categories.map((c) => c.name));
  // Resolved parent: null unless it points at a real category (a dangling ref reads
  // as top-level). The 2-level cap (validateParent) guarantees a parent has none.
  const realParent = (name: string) => {
    const p = parentOf.get(name);
    return p && existsCat.has(p) ? p : null;
  };

  const rollupActual = new Map<string, number>(actualByCat);
  for (const [name, amt] of actualByCat) {
    const p = realParent(name);
    if (p) rollupActual.set(p, (rollupActual.get(p) ?? 0) + amt);
  }
  // Show any category with rolled-up spend or its own budget, plus the parent of any
  // shown child (a budgeted child never appears orphaned).
  const shown = new Set<string>();
  for (const [name, amt] of rollupActual) if (amt !== 0 && !excluded.has(name)) shown.add(name);
  for (const c of categories) if (Number(c.budget) > 0 && !excluded.has(c.name)) shown.add(c.name);
  for (const name of [...shown]) { const p = realParent(name); if (p) shown.add(p); }

  const rowOf = (name: string): BudgetRow => ({
    id: idOf.get(name) ?? null,
    name,
    parentName: realParent(name),
    budget: budgetOf.get(name) ?? 0,
    actual: rollupActual.get(name) ?? 0,
  });
  const byActual = (a: BudgetRow, b: BudgetRow) => b.actual - a.actual || b.budget - a.budget;
  // Flatten to parent-then-its-children order; the client indents by parentName.
  return [...shown]
    .filter((n) => !realParent(n))
    .map(rowOf)
    .sort(byActual)
    .flatMap((root) => [
      root,
      ...[...shown].filter((n) => realParent(n) === root.name).map(rowOf).sort(byActual),
    ]);
}

export async function dashboardData(userId: string, month?: string): Promise<DashboardData> {
  const now = new Date();
  const selMonth = month && /^\d{4}-\d{2}$/.test(month) ? month : defaultMonth(now);

  // "Needs review" MUST match the Review page exactly, so reuse its assembly rather
  // than re-counting flags here: raw flag counts include items the Review page hides
  // (older than the analysis window, or on Ignore-category txns) → the tile said 383
  // while the page showed 0. reviewData is the single source of truth (windowed +
  // ignore-filtered). ponytail: it reloads txns/flags (the dashboard also loads txns
  // via effectiveTransactions); extract a shared light counter if dashboard latency
  // ever matters.
  const [effective, categories, reviewPayload] = await Promise.all([
    effectiveTransactions(userId),
    prisma.transactionCategory.findMany({ where: { userId } }),
    reviewData(userId),
  ]);
  const reviewOpen = reviewPayload.counters.totalOpen;

  const excluded = new Set(categories.filter((c) => c.excludeFromTotals).map((c) => c.name));
  const isExcluded = (cat: string | null) => cat != null && excluded.has(cat);
  const inSelMonth = (d: Date) => monthKey(d) === selMonth;

  // Modal currency across effective items for display labels.
  const currencyCount = new Map<string, number>();
  for (const e of effective) if (e.currency) currencyCount.set(e.currency, (currencyCount.get(e.currency) ?? 0) + 1);
  const currency = [...currencyCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // (a) 12-month trend — excludes excludeFromTotals categories (assumption 7).
  const months = last12Months(now);
  const spendByMonth = new Map<string, number>(months.map((m) => [m, 0]));
  for (const e of effective) {
    if (isExcluded(e.categoryName)) continue;
    const k = monthKey(e.date);
    if (spendByMonth.has(k)) spendByMonth.set(k, spendByMonth.get(k)! + e.amount);
  }
  const trend = months.map((m) => ({ month: m, spend: spendByMonth.get(m)! }));

  // (b) budget vs actual for the selected month — HIERARCHICAL (see buildBudgetRows).
  // Own spend per category, each txn counted once; the builder rolls children up into
  // their parent and orders parent-then-children so Σ root rollups == this month's bar.
  const actualByCat = new Map<string, number>();
  for (const e of effective) {
    if (!inSelMonth(e.date) || !e.categoryName || isExcluded(e.categoryName)) continue;
    actualByCat.set(e.categoryName, (actualByCat.get(e.categoryName) ?? 0) + e.amount);
  }
  const budget = buildBudgetRows(actualByCat, categories);

  // (d) top vendors for the selected month — same exclusion as (a) so bucket
  // vendors (Self / General Bank) don't dominate (assumption 7). Keyed by matched
  // vendorId, else the normalized-string vendor name.
  const vAgg = new Map<string, { name: string; link: string | null; icon: string | null; spend: number }>();
  for (const e of effective) {
    if (!inSelMonth(e.date) || isExcluded(e.categoryName)) continue;
    const key = e.vendorId ?? e.vendorName;
    const cur = vAgg.get(key) ?? { name: e.vendorName, link: e.vendorLink, icon: e.vendorIcon, spend: 0 };
    cur.spend += e.amount;
    vAgg.set(key, cur);
  }
  const vendors = [...vAgg.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .filter((v) => v.spend > 0 && v.name)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, TOP_VENDORS);

  // (e) biggest transactions of the month — largest outflows first, same
  // excludeFromTotals exclusion as (a). Each carries the whole-txn id so a row can
  // be re-categorised / merged inline (null for a merge group or split part).
  const topTransactions = effective
    .filter((e) => inSelMonth(e.date) && !isExcluded(e.categoryName))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, TOP_TXNS)
    .map((e) => ({
      id: e.id,
      txnId: !e.isGroup && e.parentId == null ? e.id : null,
      title: e.title,
      categoryName: e.categoryName,
      vendorName: e.vendorName,
      vendorLink: e.vendorLink,
      vendorIcon: e.vendorIcon,
      date: e.date.toISOString(),
      amount: e.amount,
      currency: e.currency,
    }));

  return {
    month: selMonth,
    currency,
    trend,
    budget,
    review: reviewOpen,
    vendors,
    topTransactions,
  };
}
