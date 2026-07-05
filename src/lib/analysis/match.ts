// Vendor matching engine (F1, FR1 + funnel steps 2/4). The ONLY implementation of
// condition/row/vendor evaluation — F2 (category resolution) and F3/F4 (vendor
// APIs) import from here, never fork the semantics.
//
// A condition ROW matches when ALL of its set fields hold (AND). A VENDOR matches
// when ANY of its ordered rows match (OR). rematchUser materializes the winning
// vendor onto PlaidTransaction.vendorId (first match in ascending-priority order)
// and maintains the two queue flags (unmatched_vendor / vendor_conflict) over the
// effective items. Deterministic + idempotent.
import type { Prisma, VendorCondition } from "@prisma/client";
import { prisma } from "../db";
import { normalizeStr, plaidPrimary, plaidDetailed } from "./vendor";
import { primaryLeg } from "./groups";
import { RULES } from "./constants";

// Amounts compared in integer cents so float dust never breaks a bound.
const cents = (x: Prisma.Decimal | number): number => Math.round(Number(x) * 100);

// --- Regex validator (exported for F3/F4 save-time validation) ---------------

export const REGEX_MAX_LEN = 200;

// null = valid; a string = the reason it was rejected. F3/F4 call this before
// persisting a regex nameOp/merchantOp and 400 on a non-null result.
export function validateRegex(pattern: string): string | null {
  if (pattern.length > REGEX_MAX_LEN)
    return `Regex too long (max ${REGEX_MAX_LEN} characters)`;
  try {
    new RegExp(pattern);
    return null;
  } catch (e) {
    return `Invalid regex: ${(e as Error).message}`;
  }
}

// --- Condition / row / vendor evaluation -------------------------------------

// The transaction shape matching needs. A full PlaidTransaction satisfies it.
export type MatchTxn = {
  name: string;
  merchantName: string | null;
  amount: Prisma.Decimal | number;
  accountId: string;
  paymentChannel: string;
  category: string | null; // Plaid pfc JSON text
};

// Case-insensitive text op against an already-normalized target. Returns null when
// the field is unset (so it contributes no predicate to the row's AND).
function textOp(
  op: string | null,
  value: string | null,
  target: string
): boolean | null {
  if (!op || value == null || value === "") return null;
  if (op === "regex") {
    try {
      return new RegExp(value, "i").test(target);
    } catch {
      return false; // an unsaveable pattern that slipped through never matches
    }
  }
  const v = normalizeStr(value);
  switch (op) {
    case "contains":
      return target.includes(v);
    case "equals":
      return target === v;
    case "starts_with":
      return target.startsWith(v);
    default:
      return false;
  }
}

// True when EVERY set field of the row holds. A row with no set fields never
// matches (the ≥1-field invariant is enforced at save; this is the safety net).
export function matchesCondition(c: VendorCondition, txn: MatchTxn): boolean {
  const preds: boolean[] = [];
  const push = (p: boolean | null) => {
    if (p !== null) preds.push(p);
  };

  push(textOp(c.nameOp, c.nameValue, normalizeStr(txn.name)));
  push(textOp(c.merchantOp, c.merchantValue, normalizeStr(txn.merchantName ?? "")));

  const amt = cents(txn.amount);
  if (c.amountMin != null) preds.push(amt >= cents(c.amountMin));
  if (c.amountMax != null) preds.push(amt <= cents(c.amountMax));

  if (c.accountId) preds.push(txn.accountId === c.accountId);
  if (c.paymentChannel)
    preds.push(normalizeStr(txn.paymentChannel) === normalizeStr(c.paymentChannel));
  if (c.plaidPrimary) preds.push(plaidPrimary(txn.category) === c.plaidPrimary);
  if (c.plaidDetailed) preds.push(plaidDetailed(txn.category) === c.plaidDetailed);

  return preds.length > 0 && preds.every(Boolean);
}

export type MatchVendor = { conditions: VendorCondition[] };

// First matching row by `order` — used by F2 for category resolution (the row's
// category, then the vendor default). null when the vendor doesn't match.
export function firstMatchingRow(
  vendor: MatchVendor,
  txn: MatchTxn
): VendorCondition | null {
  const rows = [...vendor.conditions].sort((a, b) => a.order - b.order);
  for (const c of rows) if (matchesCondition(c, txn)) return c;
  return null;
}

export function matchesVendor(vendor: MatchVendor, txn: MatchTxn): boolean {
  return firstMatchingRow(vendor, txn) !== null;
}

// --- Rematch: materialize vendorId + maintain queue flags --------------------

type FlagTarget = { transactionId: string } | { mergeGroupId: string };

// Drive one queue flag to open/closed. Auto-close resolves an OPEN flag; a
// DISMISSED flag is never touched (vendor_conflict dismissal is permanent, and
// unmatched_vendor is never dismissable) so a dismissed conflict never reopens.
async function setQueueFlag(
  userId: string,
  rule: string,
  target: FlagTarget,
  open: boolean
): Promise<void> {
  const where =
    "transactionId" in target
      ? { rule_transactionId: { rule, transactionId: target.transactionId } }
      : { rule_mergeGroupId: { rule, mergeGroupId: target.mergeGroupId } };
  const existing = await prisma.transactionFlag.findUnique({ where });
  if (open) {
    if (!existing)
      await prisma.transactionFlag.create({ data: { userId, rule, ...target, status: "open" } });
    else if (existing.status === "resolved")
      await prisma.transactionFlag.update({
        where: { id: existing.id },
        data: { status: "open", resolvedAt: null },
      });
    // open stays open; dismissed stays dismissed (permanent suppression).
  } else if (existing && existing.status === "open") {
    await prisma.transactionFlag.update({
      where: { id: existing.id },
      data: { status: "resolved", resolvedAt: new Date() },
    });
  }
}

// Re-evaluate every vendor over every posted transaction, materialize the winning
// vendorId (first match in ascending-priority order; null = no match), then
// maintain the queue flags over effective items. Called from analyzeUser (after
// auto-match) and by F3/F4 after any vendor create/edit/delete/reorder.
export async function rematchUser(userId: string): Promise<void> {
  // Eligible vendors: a real priority AND ≥1 condition. Legacy rows (NULL priority
  // or no conditions) never match. Ascending priority = match order.
  const vendors = (
    await prisma.vendor.findMany({
      where: { userId, priority: { not: null } },
      include: { conditions: true },
      orderBy: { priority: "asc" },
    })
  ).filter((v) => v.conditions.length > 0);

  const posted = await prisma.plaidTransaction.findMany({
    where: { pending: false, account: { item: { userId } } },
  });

  // 1. Materialize vendorId per posted txn; remember how many vendors matched (for
  //    the conflict flag). Split parents are matched like any txn (parts inherit).
  const matchCount = new Map<string, number>();
  for (const t of posted) {
    const matches = vendors.filter((v) => matchesVendor(v, t)); // priority-sorted
    const vendorId = matches[0]?.id ?? null;
    matchCount.set(t.transactionId, matches.length);
    if (t.vendorId !== vendorId) {
      await prisma.plaidTransaction.update({
        where: { transactionId: t.transactionId },
        data: { vendorId },
      });
      t.vendorId = vendorId; // keep local copy current for the group lookup below
    }
  }

  // 2. Queue flags over effective items: ungrouped posted txns + net-≠0 groups.
  //    Grouped legs and net-0 groups never queue. A group's vendor/conflict is its
  //    primary leg's. One queue row per split parent falls out for free (the parent
  //    is a single ungrouped txn).
  const groups = await prisma.mergeGroup.findMany({
    where: { userId },
    include: { legs: true },
  });
  const legIds = new Set(groups.flatMap((g) => g.legs.map((l) => l.transactionId)));
  const postedById = new Map(posted.map((t) => [t.transactionId, t]));

  for (const t of posted) {
    if (legIds.has(t.transactionId)) continue; // represented by its group
    const target = { transactionId: t.transactionId };
    await setQueueFlag(userId, RULES.unmatchedVendor, target, t.vendorId == null);
    await setQueueFlag(userId, RULES.vendorConflict, target, (matchCount.get(t.transactionId) ?? 0) >= 2);
  }
  for (const g of groups) {
    if (cents(g.netAmount) === 0) continue; // net-0 self-transfer never queues
    const legs = g.legs
      .map((l) => postedById.get(l.transactionId))
      .filter((t): t is (typeof posted)[number] => !!t);
    const primary = legs.length ? primaryLeg(legs) : null;
    const target = { mergeGroupId: g.id };
    await setQueueFlag(userId, RULES.unmatchedVendor, target, (primary?.vendorId ?? null) == null);
    await setQueueFlag(
      userId,
      RULES.vendorConflict,
      target,
      (primary ? matchCount.get(primary.transactionId) ?? 0 : 0) >= 2
    );
  }
}
