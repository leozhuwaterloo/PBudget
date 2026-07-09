import type { PlaidTransaction, Vendor, VendorCondition } from "@prisma/client";
import { prisma } from "../db";
import { normalizeVendor } from "./vendor";
import { primaryLeg } from "./groups";
import { resolveCategory } from "../categories";
import { UNCATEGORIZED_CATEGORY } from "./constants";

export type EffectiveLeg = {
  id: string;
  name: string;
  merchantName: string | null;
  amount: number; // signed Plaid convention (+ = outflow)
  date: Date;
};

// The shared read contract for the V2 pages (F8/F12/F13). Every list/sum/page reads
// through effectiveTransactions so config changes move spend retroactively.
export type EffectiveTransaction = {
  isGroup: boolean;
  id: string; // txn transactionId, group id, or split-part id
  parentId: string | null; // split part → its parent txn id; else null
  title: string;
  vendorName: string; // matched vendor's display name, else normalized string
  vendorId: string | null; // materialized winning vendor (null = unmatched/queue)
  vendorLink: string | null; // matched vendor's link (Google Maps or website); null = unmatched/no link
  vendorIcon: string | null; // matched vendor's cached favicon (data URI); null = none
  categoryName: string | null;
  date: Date;
  amount: number; // signed Plaid convention; netAmount for groups (net-0 → 0)
  currency: string | null;
  legs: EffectiveLeg[]; // [] for ungrouped txns and split parts; members for groups
};

type LoadedVendor = Vendor & { conditions: VendorCondition[] };

// Merge-, split- and vendor-aware read model (FR3/FR5/FR6/FR7). A merge group
// collapses to ONE line at its net; a split PARENT is replaced by its parts (one
// line per part); ungrouped unsplit txns pass through. Vendor identity is the
// materialized vendorId — matched vendor's display name + icon, falling back to the
// normalized string when unmatched (groups key on the primary leg). Categories
// resolve at READ time through the full waterfall (resolveCategory) so any vendor
// rule / mapping / split-override change retroactively moves spend.
export async function effectiveTransactions(
  userId: string,
  range: { from?: Date; to?: Date } = {}
): Promise<EffectiveTransaction[]> {
  const [posted, groups, vendors, splits, cats] = await Promise.all([
    prisma.plaidTransaction.findMany({
      where: { pending: false, account: { item: { userId } } },
    }),
    prisma.mergeGroup.findMany({ where: { userId }, include: { legs: true } }),
    prisma.vendor.findMany({ where: { userId }, include: { conditions: true } }),
    prisma.transactionSplit.findMany({
      where: { userId },
      include: { parts: { orderBy: { id: "asc" } } },
    }),
    prisma.transactionCategory.findMany({ where: { userId }, select: { name: true } }),
  ]);

  // Fold any resolved category the user doesn't actually have (a raw humanized Plaid
  // primary like "Food And Drink" that no vendor rule / override claimed) into one
  // "Uncategorized" bucket, so no phantom Plaid name shows up as a user category.
  const userCats = new Set(cats.map((c) => c.name));
  const toUserCat = (name: string | null) =>
    name != null && !userCats.has(name) ? UNCATEGORIZED_CATEGORY : name;

  const postedById = new Map(posted.map((t) => [t.transactionId, t]));
  const legIds = new Set(groups.flatMap((g) => g.legs.map((l) => l.transactionId)));
  const vendorById = new Map<string, LoadedVendor>(vendors.map((v) => [v.id, v]));
  const splitByParent = new Map(splits.map((s) => [s.parentTransactionId, s]));
  const vendorOf = (id: string | null): LoadedVendor | null =>
    (id && vendorById.get(id)) || null;
  const inRange = (d: Date) =>
    (!range.from || d >= range.from) && (!range.to || d <= range.to);

  const out: EffectiveTransaction[] = [];

  for (const t of posted) {
    if (legIds.has(t.transactionId)) continue; // legs are represented by their group
    if (!inRange(t.datetime)) continue;
    const vendor = vendorOf(t.vendorId);
    const vendorName = vendor?.name ?? normalizeVendor(t.merchantName, t.name);
    const vendorLink = vendor?.link ?? null;
    const vendorIcon = vendor?.icon ?? null;
    const split = splitByParent.get(t.transactionId);

    if (split) {
      // Parent is REPLACED by its parts: part category = its override, else the
      // parent's live waterfall resolution (never snapshotted); parts inherit the
      // parent's vendor, date and currency.
      for (const part of split.parts) {
        out.push({
          isGroup: false,
          id: part.id,
          parentId: t.transactionId,
          title: part.label ? `${t.name} — ${part.label}` : t.name,
          vendorName,
          vendorId: t.vendorId,
          vendorLink,
          vendorIcon,
          categoryName: toUserCat(resolveCategory(vendor, t, part.categoryName)),
          date: t.datetime,
          amount: Number(part.amount),
          currency: t.isoCurrencyCode,
          legs: [],
        });
      }
      continue;
    }

    out.push({
      isGroup: false,
      id: t.transactionId,
      parentId: null,
      title: t.name,
      vendorName,
      vendorId: t.vendorId,
      vendorLink,
      vendorIcon,
      categoryName: toUserCat(resolveCategory(vendor, t, null)),
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
    const vendor = vendorOf(primary?.vendorId ?? null);
    out.push({
      isGroup: true,
      id: g.id,
      parentId: null,
      title: g.title,
      vendorName: vendor?.name ?? g.vendorName ?? "",
      vendorId: primary?.vendorId ?? null,
      vendorLink: vendor?.link ?? null,
      vendorIcon: vendor?.icon ?? null,
      categoryName: toUserCat(primary ? resolveCategory(vendor, primary, null) : g.categoryName),
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
