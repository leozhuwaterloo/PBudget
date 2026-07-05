// Manual transaction splits — the write side of FR5 (F2 already renders parts in
// the effective read model). A split replaces ONE posted, ungrouped, not-already-
// split parent txn with N ≥ 2 parts. No auto-split — always manual. Validation is
// exact in integer cents (never floats): each part is non-zero, same sign as the
// parent, and the parts sum EXACTLY to the parent. Parts inherit the parent's
// vendor; the only per-part fields are amount, an optional label, and an optional
// categoryName override that must reference an existing user category. No analyze/
// rematch is triggered: splitting never changes vendorId, and the analyzer keeps
// evaluating the parent whole (per F2), so the read model picks up the change live.
import type { PlaidTransaction, Prisma } from "@prisma/client";
import { prisma } from "./db";

export class SplitError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const bad = (msg: string): never => {
  throw new SplitError(400, msg);
};

// Integer cents so float dust never breaks sum/sign equality (SPEC: split
// validation is exact in cents).
const cents = (x: number): number => Math.round(x * 100);

export type PartInput = { amount?: unknown; label?: unknown; categoryName?: unknown };
type NormalizedPart = { amount: number; label: string | null; categoryName: string | null };

// Trimmed non-empty string, or null when absent/blank. An unset override stores
// NOTHING (null) — the part then resolves live through the parent's waterfall.
function optStr(v: unknown, field: string): string | null {
  if (v == null) return null;
  if (typeof v !== "string") bad(`${field} must be a string`);
  const s = (v as string).trim();
  return s.length ? s : null;
}

// The set of the user's split-parent transaction ids — merge candidates and
// auto-match exclude these (merge/split are mutually exclusive).
export async function splitParentIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.transactionSplit.findMany({
    where: { userId },
    select: { parentTransactionId: true },
  });
  return new Set(rows.map((r) => r.parentTransactionId));
}

// Validate the parent is splittable and the parts are well-formed + sum exactly.
// Shared by create (POST) and replace (PUT). Returns the parent + normalized parts.
async function validate(
  userId: string,
  parentTransactionId: unknown,
  partsInput: unknown
): Promise<{ parent: PlaidTransaction; parts: NormalizedPart[] }> {
  const id = typeof parentTransactionId === "string" ? parentTransactionId.trim() : "";
  if (!id) bad("parentTransactionId is required");

  const parent = await prisma.plaidTransaction.findFirst({
    where: { transactionId: id, account: { item: { userId } } },
  });
  if (!parent) throw new SplitError(404, "Transaction not found");
  if (parent.pending) bad("Cannot split a pending transaction");

  // Merge/split mutual exclusion: a merge-group leg can't be split — dissolve first.
  const leg = await prisma.mergeGroupLeg.findFirst({ where: { transactionId: id } });
  if (leg) bad("Transaction is in a merge group; dissolve the group before splitting");

  if (!Array.isArray(partsInput)) bad("parts must be an array");
  const rawParts = partsInput as PartInput[];
  if (rawParts.length < 2) bad("A split needs at least 2 parts");

  const parentCents = cents(Number(parent.amount));
  if (parentCents === 0) bad("Cannot split a zero-amount transaction");
  const parentSign = Math.sign(parentCents);

  const parts: NormalizedPart[] = [];
  let sum = 0;
  for (const p of rawParts) {
    const amt = Number(p?.amount);
    if (!Number.isFinite(amt)) bad("Each part needs a numeric amount");
    const c = cents(amt);
    if (c === 0) bad("Each part amount must be non-zero");
    if (Math.sign(c) !== parentSign) bad("Each part must have the same sign as the parent");
    sum += c;
    parts.push({ amount: amt, label: optStr(p?.label, "label"), categoryName: optStr(p?.categoryName, "categoryName") });
  }
  if (sum !== parentCents) {
    bad(`Parts must sum to the parent amount (expected ${(parentCents / 100).toFixed(2)}, got ${(sum / 100).toFixed(2)})`);
  }

  // categoryName overrides must reference an existing user category.
  const overrides = [...new Set(parts.map((p) => p.categoryName).filter((n): n is string => !!n))];
  if (overrides.length) {
    const found = await prisma.transactionCategory.findMany({
      where: { userId, name: { in: overrides } },
      select: { name: true },
    });
    const have = new Set(found.map((c) => c.name));
    const missing = overrides.filter((n) => !have.has(n));
    if (missing.length) bad(`Unknown categor${missing.length === 1 ? "y" : "ies"}: ${missing.join(", ")}`);
  }

  return { parent, parts };
}

type SplitWithParts = Prisma.TransactionSplitGetPayload<{ include: { parts: true } }>;

// JSON view: Decimal amounts → numbers.
export function serializeSplit(split: SplitWithParts) {
  return {
    id: split.id,
    parentTransactionId: split.parentTransactionId,
    parts: split.parts.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      label: p.label,
      categoryName: p.categoryName,
    })),
  };
}

// POST — create a split. Rejects a parent that is already split (one split per txn).
export async function createSplit(
  userId: string,
  parentTransactionId: unknown,
  partsInput: unknown
): Promise<SplitWithParts> {
  const { parent, parts } = await validate(userId, parentTransactionId, partsInput);
  const existing = await prisma.transactionSplit.findUnique({
    where: { parentTransactionId: parent.transactionId },
  });
  if (existing) throw new SplitError(409, "Transaction is already split; edit or delete the split instead");

  return prisma.transactionSplit.create({
    data: {
      userId,
      parentTransactionId: parent.transactionId,
      parts: { create: parts.map((p) => ({ amount: p.amount, label: p.label, categoryName: p.categoryName })) },
    },
    include: { parts: true },
  });
}

// PUT — replace an existing split's parts wholesale (same validation as create).
export async function replaceSplit(
  userId: string,
  parentTransactionId: unknown,
  partsInput: unknown
): Promise<SplitWithParts> {
  const { parent, parts } = await validate(userId, parentTransactionId, partsInput);
  const existing = await prisma.transactionSplit.findUnique({
    where: { parentTransactionId: parent.transactionId },
  });
  if (!existing) throw new SplitError(404, "Transaction is not split");

  return prisma.$transaction(async (tx) => {
    await tx.splitPart.deleteMany({ where: { splitId: existing.id } });
    await tx.splitPart.createMany({
      data: parts.map((p) => ({ splitId: existing.id, amount: p.amount, label: p.label, categoryName: p.categoryName })),
    });
    return tx.transactionSplit.findUniqueOrThrow({ where: { id: existing.id }, include: { parts: true } });
  });
}

// DELETE — unsplit: remove the split (parts cascade), restoring the parent to the
// effective lists. Allowed anytime.
export async function deleteSplit(userId: string, parentTransactionId: unknown): Promise<void> {
  const id = typeof parentTransactionId === "string" ? parentTransactionId.trim() : "";
  if (!id) bad("parentTransactionId is required");
  const existing = await prisma.transactionSplit.findFirst({ where: { parentTransactionId: id, userId } });
  if (!existing) throw new SplitError(404, "Transaction is not split");
  await prisma.transactionSplit.delete({ where: { id: existing.id } });
}
