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
import { normalizeStr, plaidPrimary, plaidDetailed, meetsConfidence } from "./vendor";
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
  datetime: Date; // for the day-of-month filter (read in UTC, the app's display TZ)
};

// Concrete day a dayOfMonth filter targets within `d`'s month, in UTC (the app
// displays dates in UTC). >0 → that calendar day; 0 → the month's last day; -n →
// n days before the last. An out-of-range positive (day 31 in a 30-day month) just
// won't equal any real getUTCDate(), so it silently matches nothing — no clamping.
function targetDayOfMonth(dayOfMonth: number, d: Date): number {
  if (dayOfMonth > 0) return dayOfMonth;
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return lastDay + dayOfMonth; // 0 → last, -1 → last-1
}

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
    // equals / starts_with are retired from the editor (contains + regex only) but
    // still evaluated so legacy rows created before the change keep matching.
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

  // Amount filter reads in the DISPLAYED sign convention: the UI renders -amount
  // (income positive, spending negative), so a user's min/max match what they see
  // on screen — e.g. `min 0` catches income. Stored amount is raw Plaid (+ = outflow),
  // so negate it here before comparing against the entered bounds.
  const amt = -cents(txn.amount);
  if (c.amountMin != null) preds.push(amt >= cents(c.amountMin));
  if (c.amountMax != null) preds.push(amt <= cents(c.amountMax));

  if (c.accountId) preds.push(txn.accountId === c.accountId);
  if (c.dayOfMonth != null)
    preds.push(txn.datetime.getUTCDate() === targetDayOfMonth(c.dayOfMonth, txn.datetime));
  if (c.paymentChannel)
    preds.push(normalizeStr(txn.paymentChannel) === normalizeStr(c.paymentChannel));
  if (c.plaidPrimary) preds.push(plaidPrimary(txn.category) === c.plaidPrimary);
  if (c.plaidDetailed) preds.push(plaidDetailed(txn.category) === c.plaidDetailed);
  if (c.plaidConfidence) preds.push(meetsConfidence(txn.category, c.plaidConfidence));

  return preds.length > 0 && preds.every(Boolean);
}

export type MatchVendor = { conditions: VendorCondition[] };

// Rows that decide vendor IDENTITY: the "match" rows, or — for a catch-all vendor
// with no match rows — its "category" rows (whose predicates then double as
// identity). A vendor claims a txn when ANY identity row matches (OR).
function identityRows(vendor: MatchVendor): VendorCondition[] {
  const match = vendor.conditions.filter((c) => c.role === "match");
  return match.length ? match : vendor.conditions.filter((c) => c.role === "category");
}

export function matchesVendor(vendor: MatchVendor, txn: MatchTxn): boolean {
  return identityRows(vendor).some((c) => matchesCondition(c, txn));
}

// True only when the vendor EXPLICITLY claims identity — it has "match" rows and
// one matches. A catch-all vendor (no match rows, claimed via its category rules)
// is excluded: it's a designed fallback, so it must not raise a vendor_conflict, or
// every specific merchant would conflict with the seeded General Spending bucket.
export function explicitlyMatchesVendor(vendor: MatchVendor, txn: MatchTxn): boolean {
  const match = vendor.conditions.filter((c) => c.role === "match");
  return match.length > 0 && match.some((c) => matchesCondition(c, txn));
}

// First matching CATEGORY row (by `order`) for a txn this vendor claims — F2 uses
// it, then the vendor default. null when no category row matches.
export function matchingCategoryRow(
  vendor: MatchVendor,
  txn: MatchTxn
): VendorCondition | null {
  const rows = vendor.conditions
    .filter((c) => c.role === "category")
    .sort((a, b) => a.order - b.order);
  for (const c of rows) if (matchesCondition(c, txn)) return c;
  return null;
}

// --- Rematch: materialize vendorId + maintain queue flags --------------------

// Batch-drive a whole set of queue flags to their desired open/closed state,
// preserving setQueueFlag's exact semantics: create a missing open flag, reopen a
// resolved one, resolve an open one that should close — and NEVER touch a dismissed
// flag (its suppression is permanent), leaving already-correct flags alone. One
// findMany + up to three bulk writes replaces the old per-flag findUnique+write,
// which was thousands of sequential round-trips on a multi-thousand-txn account.
export type FlagWant = { rule: string; transactionId?: string; mergeGroupId?: string; open: boolean };

const flagKey = (rule: string, txnId: string | null, grpId: string | null) =>
  txnId ? `${rule}|t|${txnId}` : `${rule}|g|${grpId}`;

export async function applyFlags(userId: string, wants: FlagWant[]): Promise<void> {
  if (wants.length === 0) return;
  const rules = [...new Set(wants.map((w) => w.rule))];
  const existing = await prisma.transactionFlag.findMany({ where: { userId, rule: { in: rules } } });
  const byKey = new Map(existing.map((f) => [flagKey(f.rule, f.transactionId, f.mergeGroupId), f]));

  const toCreate: Prisma.TransactionFlagCreateManyInput[] = [];
  const toReopen: string[] = [];
  const toResolve: string[] = [];
  for (const w of wants) {
    const cur = byKey.get(flagKey(w.rule, w.transactionId ?? null, w.mergeGroupId ?? null));
    if (w.open) {
      if (!cur)
        toCreate.push({ userId, rule: w.rule, transactionId: w.transactionId ?? null, mergeGroupId: w.mergeGroupId ?? null, status: "open" });
      else if (cur.status === "resolved") toReopen.push(cur.id);
      // open stays open; dismissed stays dismissed (permanent suppression).
    } else if (cur && cur.status === "open") {
      toResolve.push(cur.id);
    }
  }

  const now = new Date();
  await Promise.all([
    toCreate.length ? prisma.transactionFlag.createMany({ data: toCreate }) : Promise.resolve(),
    toReopen.length ? prisma.transactionFlag.updateMany({ where: { id: { in: toReopen } }, data: { status: "open", resolvedAt: null } }) : Promise.resolve(),
    toResolve.length ? prisma.transactionFlag.updateMany({ where: { id: { in: toResolve } }, data: { status: "resolved", resolvedAt: now } }) : Promise.resolve(),
  ]);
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

  // 1. Materialize the winning vendorId per posted txn IN MEMORY; collect the
  //    changes grouped by target vendorId so each becomes one bulk updateMany.
  const matchCount = new Map<string, number>();
  const changedByVendor = new Map<string | null, string[]>();
  for (const t of posted) {
    const matches = vendors.filter((v) => matchesVendor(v, t)); // priority-sorted
    const vendorId = matches[0]?.id ?? null;
    // Conflict counts only vendors that EXPLICITLY claim identity — catch-all
    // buckets overlap everything by design and must not flood the conflict queue.
    matchCount.set(t.transactionId, matches.filter((v) => explicitlyMatchesVendor(v, t)).length);
    if (t.vendorId !== vendorId) {
      const arr = changedByVendor.get(vendorId);
      if (arr) arr.push(t.transactionId);
      else changedByVendor.set(vendorId, [t.transactionId]);
      t.vendorId = vendorId; // keep local copy current for the group lookup below
    }
  }
  await Promise.all(
    [...changedByVendor.entries()].map(([vendorId, ids]) =>
      prisma.plaidTransaction.updateMany({ where: { transactionId: { in: ids } }, data: { vendorId } })
    )
  );

  // 2. Recompute queue flags over effective items (ungrouped posted txns + net-≠0
  //    groups) and apply them in bulk. Grouped legs and net-0 groups never queue; a
  //    group's vendor/conflict is its primary leg's. One queue row per split parent
  //    falls out for free (the parent is a single ungrouped txn).
  const groups = await prisma.mergeGroup.findMany({
    where: { userId },
    include: { legs: true },
  });
  const legIds = new Set(groups.flatMap((g) => g.legs.map((l) => l.transactionId)));
  const postedById = new Map(posted.map((t) => [t.transactionId, t]));

  const wants: FlagWant[] = [];
  for (const t of posted) {
    if (legIds.has(t.transactionId)) continue; // represented by its group
    wants.push({ rule: RULES.unmatchedVendor, transactionId: t.transactionId, open: t.vendorId == null });
    wants.push({ rule: RULES.vendorConflict, transactionId: t.transactionId, open: (matchCount.get(t.transactionId) ?? 0) >= 2 });
  }
  for (const g of groups) {
    if (cents(g.netAmount) === 0) continue; // net-0 self-transfer never queues
    const legs = g.legs
      .map((l) => postedById.get(l.transactionId))
      .filter((t): t is (typeof posted)[number] => !!t);
    const primary = legs.length ? primaryLeg(legs) : null;
    wants.push({ rule: RULES.unmatchedVendor, mergeGroupId: g.id, open: (primary?.vendorId ?? null) == null });
    wants.push({ rule: RULES.vendorConflict, mergeGroupId: g.id, open: (primary ? matchCount.get(primary.transactionId) ?? 0 : 0) >= 2 });
  }

  await applyFlags(userId, wants);
}

// Incremental rematch after a SINGLE vendor create/edit/delete — the fast path the
// vendor Save button uses. Only re-evaluates transactions that could flip: those
// currently materialized to this vendor (incl. a just-deleted vendor's dangling ids)
// plus the currently-UNMATCHED ones a broadened rule might now claim. Transactions
// owned by ANOTHER vendor (including catch-all buckets) are deliberately left alone —
// a full rematchUser (Accounts → "Re-match all") re-resolves everything. Match/flag
// semantics are identical to rematchUser, just restricted to the candidate set plus
// any merge group that owns one of those candidates. O(candidates), not O(all txns).
export async function rematchAfterVendorChange(userId: string, vendorId: string): Promise<void> {
  const vendors = (
    await prisma.vendor.findMany({
      where: { userId, priority: { not: null } },
      include: { conditions: true },
      orderBy: { priority: "asc" },
    })
  ).filter((v) => v.conditions.length > 0);

  const candidates = await prisma.plaidTransaction.findMany({
    where: { pending: false, account: { item: { userId } }, OR: [{ vendorId }, { vendorId: null }] },
  });
  if (candidates.length === 0) return;

  // Materialize the winning vendor over the candidates (one bulk write per target).
  const matchCount = new Map<string, number>();
  const changedByVendor = new Map<string | null, string[]>();
  for (const t of candidates) {
    const matches = vendors.filter((v) => matchesVendor(v, t)); // priority-sorted
    const winner = matches[0]?.id ?? null;
    matchCount.set(t.transactionId, matches.filter((v) => explicitlyMatchesVendor(v, t)).length);
    if (t.vendorId !== winner) {
      const arr = changedByVendor.get(winner);
      if (arr) arr.push(t.transactionId);
      else changedByVendor.set(winner, [t.transactionId]);
      t.vendorId = winner; // keep local copy current for the group lookup below
    }
  }
  await Promise.all(
    [...changedByVendor.entries()].map(([v, ids]) =>
      prisma.plaidTransaction.updateMany({ where: { transactionId: { in: ids } }, data: { vendorId: v } })
    )
  );

  // Merge groups that own a candidate leg may see their primary vendor (hence flag) move.
  const candidateIds = candidates.map((t) => t.transactionId);
  const groups = await prisma.mergeGroup.findMany({
    where: { userId, legs: { some: { transactionId: { in: candidateIds } } } },
    include: { legs: true },
  });
  const legIds = new Set(groups.flatMap((g) => g.legs.map((l) => l.transactionId)));
  // A leg of an affected group can sit outside the candidate set — load those so
  // primaryLeg sees the whole group (they keep their existing, unchanged vendorId).
  const byId = new Map(candidates.map((t) => [t.transactionId, t]));
  const missing = [...legIds].filter((id) => !byId.has(id));
  if (missing.length) {
    for (const t of await prisma.plaidTransaction.findMany({ where: { transactionId: { in: missing } } }))
      byId.set(t.transactionId, t);
  }

  const wants: FlagWant[] = [];
  for (const t of candidates) {
    if (legIds.has(t.transactionId)) continue; // represented by its group
    wants.push({ rule: RULES.unmatchedVendor, transactionId: t.transactionId, open: t.vendorId == null });
    wants.push({ rule: RULES.vendorConflict, transactionId: t.transactionId, open: (matchCount.get(t.transactionId) ?? 0) >= 2 });
  }
  for (const g of groups) {
    if (cents(g.netAmount) === 0) continue; // net-0 self-transfer never queues
    const legs = g.legs
      .map((l) => byId.get(l.transactionId))
      .filter((t): t is (typeof candidates)[number] => !!t);
    const primary = legs.length ? primaryLeg(legs) : null;
    const pc = primary
      ? matchCount.get(primary.transactionId) ?? vendors.filter((v) => explicitlyMatchesVendor(v, primary)).length
      : 0;
    wants.push({ rule: RULES.unmatchedVendor, mergeGroupId: g.id, open: (primary?.vendorId ?? null) == null });
    wants.push({ rule: RULES.vendorConflict, mergeGroupId: g.id, open: pc >= 2 });
  }

  await applyFlags(userId, wants);
}
