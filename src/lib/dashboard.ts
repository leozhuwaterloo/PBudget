import { prisma } from "./db";
import { effectiveTransactions } from "./analysis/effective";
import { RULES } from "./analysis/constants";

// Dashboard aggregate (FR7). Everything reads through F2's effective read model
// (merge-, split- and vendor-aware, category-resolved at read time) so config
// changes move spend retroactively. "Spend" = net signed amount (Plaid
// convention, + = outflow; refunds subtract). Called from the server page for
// first paint and from /api/dashboard on month change.

const TOP_VENDORS = 8;

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

export type DashboardData = {
  month: string; // selected "YYYY-MM" (drives budget + vendors widgets)
  currency: string | null; // modal currency, for display labels
  trend: { month: string; spend: number }[]; // (a) last 12 months, oldest → newest
  budget: { name: string; budget: number; actual: number }[]; // (b) selected month
  review: { unmatched: number; conflicts: number; suspicion: number; pending: number }; // (c)
  vendors: { key: string; name: string; link: string | null; spend: number }[]; // (d) selected month
};

export async function dashboardData(userId: string, month?: string): Promise<DashboardData> {
  const now = new Date();
  const selMonth = month && /^\d{4}-\d{2}$/.test(month) ? month : monthKey(now);

  const [effective, categories, unmatched, conflicts, suspicion, pending] = await Promise.all([
    effectiveTransactions(userId),
    prisma.transactionCategory.findMany({ where: { userId } }),
    prisma.transactionFlag.count({ where: { userId, status: "open", rule: RULES.unmatchedVendor } }),
    prisma.transactionFlag.count({ where: { userId, status: "open", rule: RULES.vendorConflict } }),
    prisma.transactionFlag.count({
      where: {
        userId,
        status: "open",
        rule: { in: [RULES.unmatchedTransfer, RULES.unusualAmount, RULES.duplicateCharge] },
      },
    }),
    prisma.mergeGroup.count({ where: { userId, status: "auto" } }),
  ]);

  const excluded = new Set(categories.filter((c) => c.excludeFromTotals).map((c) => c.name));
  const budgetOf = new Map(categories.map((c) => [c.name, Number(c.budget)]));
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

  // (b) budget vs actual for the selected month. No excludeFromTotals filter —
  // PRD scopes that exclusion to (a)/(d). Show a category with a budget or spend.
  const actualByCat = new Map<string, number>();
  for (const e of effective) {
    if (!inSelMonth(e.date) || !e.categoryName) continue;
    actualByCat.set(e.categoryName, (actualByCat.get(e.categoryName) ?? 0) + e.amount);
  }
  const budgetNames = new Set<string>([
    ...actualByCat.keys(),
    ...categories.filter((c) => Number(c.budget) > 0).map((c) => c.name),
  ]);
  const budget = [...budgetNames]
    .map((name) => ({ name, budget: budgetOf.get(name) ?? 0, actual: actualByCat.get(name) ?? 0 }))
    .filter((r) => r.budget > 0 || r.actual > 0)
    .sort((a, b) => b.actual - a.actual || b.budget - a.budget);

  // (d) top vendors for the selected month — same exclusion as (a) so bucket
  // vendors (Self / General Bank) don't dominate (assumption 7). Keyed by matched
  // vendorId, else the normalized-string vendor name.
  const vAgg = new Map<string, { name: string; link: string | null; spend: number }>();
  for (const e of effective) {
    if (!inSelMonth(e.date) || isExcluded(e.categoryName)) continue;
    const key = e.vendorId ?? e.vendorName;
    const cur = vAgg.get(key) ?? { name: e.vendorName, link: e.vendorLink, spend: 0 };
    cur.spend += e.amount;
    vAgg.set(key, cur);
  }
  const vendors = [...vAgg.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .filter((v) => v.spend > 0 && v.name)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, TOP_VENDORS);

  return {
    month: selMonth,
    currency,
    trend,
    budget,
    review: { unmatched, conflicts, suspicion, pending },
    vendors,
  };
}
