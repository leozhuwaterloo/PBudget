import type { TransactionCategory } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { matchingCategoryRow, type MatchTxn, type MatchVendor } from "./analysis/match";
import { plaidPrimary } from "./analysis/vendor";

// "FOOD_AND_DRINK" -> "Food And Drink"
export function humanize(pfcPrimary: string): string {
  return pfcPrimary
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// The app category NAME a Plaid primary maps to (last-resort fallback + the auto
// -created budget row). TRANSFER_IN/TRANSFER_OUT collapse to a single "Transfer" —
// we don't surface Plaid's in/out split as two categories — so transfer txns
// resolve to the one renameable "Transfer" category, not raw "Transfer In/Out".
export function plaidCategoryName(pfcPrimary: string): string {
  if (pfcPrimary === "TRANSFER_IN" || pfcPrimary === "TRANSFER_OUT") return "Transfer";
  return humanize(pfcPrimary);
}

// The materialized winning vendor with the fields the waterfall reads: its ordered
// condition rows (delegated to F1's matcher) plus its default category.
export type WaterfallVendor = MatchVendor & { categoryName: string | null };

// The full read-time category waterfall (SPEC funnel step 3 / FR3). In order:
//   split-part override → winning vendor's first matching CATEGORY row →
//   vendor default category → humanized Plaid primary (raw last-resort fallback).
// The old CategoryMapping override layer was removed — vendors solely determine
// category (a seeded catch-all vendor covers the Plaid-category cases). Runs live
// on every read so any config change retroactively moves spend (never snapshotted).
// `vendor` is the txn's materialized winning vendor (null = unmatched); `partOverride`
// is a split part's own categoryName (null for a whole txn).
export function resolveCategory(
  vendor: WaterfallVendor | null,
  txn: MatchTxn,
  partOverride: string | null = null
): string | null {
  if (partOverride) return partOverride;
  if (vendor) {
    const row = matchingCategoryRow(vendor, txn);
    if (row?.categoryName) return row.categoryName;
    if (vendor.categoryName) return vendor.categoryName; // vendor default
  }
  const pp = plaidPrimary(txn.category);
  return pp ? plaidCategoryName(pp) : null;
}

// ---- Custom categories & budgets (FR4) ------------------------------------

// The old funnel's category set. BigPayment/Unknown were funnel outcomes, not
// categories, so they are NOT carried over (SPEC / PRD FR4). "Ignore" IS a real
// category now (excluded from totals) so vendor rules can route noise into it.
export const DEFAULT_CATEGORIES = [
  "Transfer", "Grocery", "Restaurant", "Food Delivery", "Online Shopping",
  "In-Store Shopping", "Game", "Entertainment", "Income", "Other Income",
  "Fee", "Recurring", "Utility", "Pet", "Travel", "Cash", "Gas", "Baby",
  "Mortgage", "Insurance", "Telecom", "Ignore",
] as const;

// "Recurring" is the top-level home for fixed monthly bills — payments that don't
// change month to month. These seed nested under it (parentName is by-name, not an
// FK, so it's fine that the parent is created in the same batch).
const DEFAULT_PARENT: Record<string, string> = {
  "Mortgage": "Recurring",
  "Insurance": "Recurring",
  "Telecom": "Recurring",
};

// Seeded with excludeFromTotals=true. Plaid's TRANSFER_IN/OUT collapse to
// "Transfer" (see plaidCategoryName), so those two are no longer separate rows.
const EXCLUDE_FROM_TOTALS = new Set<string>([
  "Income", "Transfer", "Other Income", "Ignore",
]);

// Idempotent seed of the default categories. Called at signup and lazily (from
// GET /api/categories) for existing users. Never overwrites user edits: only the
// MISSING rows are created (with their seeded excludeFromTotals); existing rows,
// budgets and flags are left exactly as the user set them. Re-running is a no-op.
export async function ensureDefaultCategories(userId: string): Promise<void> {
  const names = [...DEFAULT_CATEGORIES];
  const existing = await prisma.transactionCategory.findMany({
    where: { userId, name: { in: names } },
    select: { name: true },
  });
  const have = new Set(existing.map((c) => c.name));
  const missing = names.filter((n) => !have.has(n));
  if (missing.length === 0) return;
  await prisma.transactionCategory.createMany({
    data: missing.map((name) => ({
      userId,
      name,
      excludeFromTotals: EXCLUDE_FROM_TOTALS.has(name),
      parentName: DEFAULT_PARENT[name] ?? null,
    })),
  });
}

export class CategoryError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Cascade a category rename to every row that references the name by string
// (there is no FK): Vendor default category, VendorCondition row category,
// SplitPart override, MergeGroup snapshot. updateMany can't filter across
// relations, so the user's vendor/split ids are gathered and matched by scalar
// `in` (MergeGroup carries userId directly).
async function cascadeRename(
  tx: Tx,
  userId: string,
  oldName: string,
  newName: string
): Promise<void> {
  const [vendors, splits] = await Promise.all([
    tx.vendor.findMany({ where: { userId }, select: { id: true } }),
    tx.transactionSplit.findMany({ where: { userId }, select: { id: true } }),
  ]);
  const vendorIds = vendors.map((v) => v.id);
  const splitIds = splits.map((s) => s.id);
  await Promise.all([
    tx.vendor.updateMany({ where: { userId, categoryName: oldName }, data: { categoryName: newName } }),
    tx.vendorCondition.updateMany({ where: { vendorId: { in: vendorIds }, categoryName: oldName }, data: { categoryName: newName } }),
    tx.splitPart.updateMany({ where: { splitId: { in: splitIds }, categoryName: oldName }, data: { categoryName: newName } }),
    tx.mergeGroup.updateMany({ where: { userId, categoryName: oldName }, data: { categoryName: newName } }),
    // Children point at their parent by name too — keep the tree intact on rename.
    tx.transactionCategory.updateMany({ where: { userId, parentName: oldName }, data: { parentName: newName } }),
  ]);
}

// Validate a requested parent for a category. `null` clears the parent (top-level).
// A parent must be one of the user's OTHER categories, itself top-level (2-level cap),
// and the child must not already have children (which would push depth to 3).
// Throws CategoryError(400) on any violation; returns the parentName to store.
export async function validateParent(
  userId: string,
  self: { name: string; parentName?: string | null } | null,
  parentName: string | null
): Promise<string | null> {
  if (parentName == null) return null;
  if (self && parentName === self.name) throw new CategoryError(400, "A category can't be its own parent");
  const parent = await prisma.transactionCategory.findFirst({ where: { userId, name: parentName } });
  if (!parent) throw new CategoryError(400, `No category named "${parentName}" to nest under`);
  if (parent.parentName) throw new CategoryError(400, `"${parentName}" is already a subcategory — nesting is only two levels deep`);
  if (self) {
    const kids = await prisma.transactionCategory.count({ where: { userId, parentName: self.name } });
    if (kids > 0) throw new CategoryError(400, `"${self.name}" has subcategories, so it can't become one`);
  }
  return parentName;
}

// Apply a create/rename/budget/flag edit. A rename (name changes) cascades the
// string to all referencing rows in ONE transaction. A name collision with the
// user's own another category surfaces as Prisma P2002 (→ 409 at the route).
export async function updateCategory(
  userId: string,
  id: string,
  patch: { name?: string; budget?: number; excludeFromTotals?: boolean; parentName?: string | null }
): Promise<TransactionCategory> {
  const cat = await prisma.transactionCategory.findFirst({ where: { id, userId } });
  if (!cat) throw new CategoryError(404, "Category not found");
  const rename = patch.name !== undefined && patch.name !== cat.name;
  // Validate against the POST-rename name so "rename + reparent" in one call is coherent.
  const selfName = rename ? patch.name! : cat.name;
  const parentName =
    patch.parentName !== undefined
      ? await validateParent(userId, { name: selfName }, patch.parentName)
      : undefined;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.transactionCategory.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.budget !== undefined ? { budget: patch.budget } : {}),
        ...(patch.excludeFromTotals !== undefined ? { excludeFromTotals: patch.excludeFromTotals } : {}),
        ...(parentName !== undefined ? { parentName } : {}),
      },
    });
    if (rename) await cascadeRename(tx, userId, cat.name, patch.name!);
    return updated;
  });
}

// How many rows reference a category name across the cascade sites. Used to
// reject deletes while the category is still in use.
export async function categoryRefCount(userId: string, name: string): Promise<number> {
  const [vendor, cond, part, group] = await Promise.all([
    prisma.vendor.count({ where: { userId, categoryName: name } }),
    prisma.vendorCondition.count({ where: { categoryName: name, vendor: { userId } } }),
    prisma.splitPart.count({ where: { categoryName: name, split: { userId } } }),
    prisma.mergeGroup.count({ where: { userId, categoryName: name } }),
  ]);
  return vendor + cond + part + group;
}

// Delete a category, rejected (409) while any row still references its name.
// TransactionCategory rows and budgets are otherwise never destroyed by V2.
export async function deleteCategory(userId: string, id: string): Promise<void> {
  const cat = await prisma.transactionCategory.findFirst({ where: { id, userId } });
  if (!cat) throw new CategoryError(404, "Category not found");
  const refs = await categoryRefCount(userId, cat.name);
  if (refs > 0) {
    throw new CategoryError(
      409,
      `Category "${cat.name}" is still used by ${refs} rule${refs === 1 ? "" : "s"}; reassign or remove them first.`
    );
  }
  await prisma.$transaction(async (tx) => {
    // Reparent any children to top-level so no row points at a deleted parent.
    await tx.transactionCategory.updateMany({ where: { userId, parentName: cat.name }, data: { parentName: null } });
    await tx.transactionCategory.delete({ where: { id } });
  });
}
