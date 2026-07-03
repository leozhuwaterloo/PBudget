import type { PlaidTransaction } from "@prisma/client";
import { prisma } from "../db";
import { normalizeVendor, plaidPrimary } from "./vendor";
import { primaryLeg } from "./groups";
import { categoryFor } from "../categories";

export type EffectiveLeg = {
  id: string;
  name: string;
  merchantName: string | null;
  amount: number; // signed Plaid convention (+ = outflow)
  date: Date;
};

export type EffectiveTransaction = {
  isGroup: boolean;
  id: string; // txn transactionId, or group id
  title: string;
  vendorName: string;
  categoryName: string | null;
  date: Date;
  amount: number; // signed Plaid convention; netAmount for groups (net-0 → 0)
  currency: string | null;
  legs: EffectiveLeg[]; // [] for ungrouped txns; the member txns for groups
};

// Merge-aware read model (FR6/FR7, SPEC "effectiveTransactions"). Every list,
// report and budget card reads through this so a group collapses to ONE line at
// its net and legs never appear individually. Ungrouped posted txns pass through
// as-is; each group (auto OR confirmed — exclusions apply from the moment of
// auto-match) becomes one synthetic entry at netAmount. Net-0 groups are included
// at amount 0 (lists show them; report/budget sums then contribute nothing).
// Categories resolve at READ time (via categoryFor) so a remap retroactively
// moves spend — for groups, from the primary leg, same as createMergeGroup.
export async function effectiveTransactions(
  userId: string,
  range: { from?: Date; to?: Date } = {}
): Promise<EffectiveTransaction[]> {
  const [posted, groups, mappings] = await Promise.all([
    prisma.plaidTransaction.findMany({
      where: { pending: false, account: { item: { userId } } },
    }),
    prisma.mergeGroup.findMany({ where: { userId }, include: { legs: true } }),
    prisma.categoryMapping.findMany({ where: { userId } }),
  ]);

  const postedById = new Map(posted.map((t) => [t.transactionId, t]));
  const legIds = new Set(groups.flatMap((g) => g.legs.map((l) => l.transactionId)));
  const inRange = (d: Date) =>
    (!range.from || d >= range.from) && (!range.to || d <= range.to);
  const category = (cat: string | null): string | null => {
    const pp = plaidPrimary(cat);
    return pp ? categoryFor(mappings, pp) : null;
  };

  const out: EffectiveTransaction[] = [];

  for (const t of posted) {
    if (legIds.has(t.transactionId)) continue; // legs are represented by their group
    if (!inRange(t.datetime)) continue;
    out.push({
      isGroup: false,
      id: t.transactionId,
      title: t.name,
      vendorName: normalizeVendor(t.merchantName, t.name),
      categoryName: category(t.category),
      date: t.datetime,
      amount: Number(t.amount),
      currency: t.isoCurrencyCode,
      legs: [],
    });
  }

  for (const g of groups) {
    if (!inRange(g.date)) continue;
    const legRows = g.legs
      .map((l) => postedById.get(l.transactionId))
      .filter((t): t is PlaidTransaction => !!t);
    const primary = legRows.length ? primaryLeg(legRows) : null;
    out.push({
      isGroup: true,
      id: g.id,
      title: g.title,
      vendorName: g.vendorName ?? "",
      categoryName: primary ? category(primary.category) : g.categoryName,
      date: g.date,
      amount: Number(g.netAmount),
      currency: g.currency,
      legs: legRows.map((t) => ({
        id: t.transactionId,
        name: t.name,
        merchantName: t.merchantName,
        amount: Number(t.amount),
        date: t.datetime,
      })),
    });
  }

  return out;
}
