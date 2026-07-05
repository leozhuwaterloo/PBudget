// V2 vendor CRUD + reorder (F3, FR1). Auth lives in the route; this is the write
// side every mutation routes through so validation and the post-mutation rematch
// stay in one place. Matching semantics are NEVER forked here — the row/vendor
// evaluators and the regex validator all come from F1's match.ts.
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { validateRegex, rematchUser } from "./analysis/match";
import { normalizeStr } from "./analysis/vendor";

const TEXT_OPS = new Set(["contains", "equals", "starts_with", "regex"]);
const CHANNELS = new Set(["online", "in store", "other"]);

export class VendorError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const bad = (msg: string): never => {
  throw new VendorError(400, msg);
};

// --- Input shapes (untyped JSON from the route) ------------------------------

export type ConditionInput = {
  categoryName?: string | null;
  nameOp?: string | null;
  nameValue?: string | null;
  merchantOp?: string | null;
  merchantValue?: string | null;
  amountMin?: number | null;
  amountMax?: number | null;
  accountId?: string | null;
  paymentChannel?: string | null;
  plaidPrimary?: string | null;
  plaidDetailed?: string | null;
};
export type VendorInput = {
  name?: unknown;
  icon?: unknown;
  categoryName?: unknown;
  conditions?: unknown;
};

// Normalized row ready for Prisma create (order is assigned by array index).
type RowData = Omit<Prisma.VendorConditionCreateManyVendorInput, "vendorId">;

// --- Field readers -----------------------------------------------------------

// Trimmed non-empty string, or undefined when absent/blank. `field` names it in
// the 400 message. Rejects a present-but-wrong-type value.
function str(v: unknown, field: string): string | undefined {
  if (v == null) return undefined;
  if (typeof v !== "string") bad(`${field} must be a string`);
  const s = (v as string).trim();
  return s.length ? s : undefined;
}

function textPair(op: unknown, value: unknown, field: string): { op: string; value: string } | undefined {
  const o = str(op, `${field} operator`);
  const val = str(value, `${field} value`);
  if (o === undefined && val === undefined) return undefined;
  if (o === undefined || val === undefined)
    bad(`${field} needs both an operator and a value`);
  if (!TEXT_OPS.has(o!)) bad(`${field} operator must be one of contains, equals, starts_with, regex`);
  if (o === "regex") {
    const err = validateRegex(val!);
    if (err) bad(`${field}: ${err}`);
  }
  return { op: o!, value: val! };
}

function amount(v: unknown, field: string): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : NaN;
  if (!isFinite(n)) bad(`${field} must be a number`);
  return n;
}

// --- Validation --------------------------------------------------------------

// Validate a raw condition list into Prisma create-data. Enforces: ≥1 matching
// field per row (categoryName is an outcome, not a field), valid ops/regex,
// amountMin ≤ amountMax, channel enum. Category/account existence is checked
// separately (batched across the whole vendor). Returns [rows, referenced names].
function buildRows(raw: unknown): { rows: RowData[]; categoryNames: Set<string>; accountIds: Set<string> } {
  if (!Array.isArray(raw) || raw.length === 0)
    bad("A vendor needs at least one condition row");
  const rows: RowData[] = [];
  const categoryNames = new Set<string>();
  const accountIds = new Set<string>();

  (raw as ConditionInput[]).forEach((c, i) => {
    const where = `row ${i + 1}`;
    if (c == null || typeof c !== "object") bad(`${where} is not an object`);

    const name = textPair(c.nameOp, c.nameValue, `${where} transaction name`);
    const merchant = textPair(c.merchantOp, c.merchantValue, `${where} merchant name`);
    const amountMin = amount(c.amountMin, `${where} amountMin`);
    const amountMax = amount(c.amountMax, `${where} amountMax`);
    if (amountMin !== undefined && amountMax !== undefined && amountMin > amountMax)
      bad(`${where}: amountMin must be ≤ amountMax`);

    const accountId = str(c.accountId, `${where} account`);
    if (accountId) accountIds.add(accountId);

    let paymentChannel = str(c.paymentChannel, `${where} payment channel`);
    if (paymentChannel) {
      paymentChannel = normalizeStr(paymentChannel);
      if (!CHANNELS.has(paymentChannel))
        bad(`${where}: payment channel must be one of online, in store, other`);
    }
    const plaidPrimary = str(c.plaidPrimary, `${where} Plaid primary`);
    const plaidDetailed = str(c.plaidDetailed, `${where} Plaid detailed`);

    // ≥1 matching field. The row's category is an outcome, so it never counts.
    const fieldCount =
      (name ? 1 : 0) + (merchant ? 1 : 0) + (amountMin !== undefined ? 1 : 0) +
      (amountMax !== undefined ? 1 : 0) + (accountId ? 1 : 0) + (paymentChannel ? 1 : 0) +
      (plaidPrimary ? 1 : 0) + (plaidDetailed ? 1 : 0);
    if (fieldCount === 0) bad(`${where} needs at least one matching field`);

    const categoryName = str(c.categoryName, `${where} category`);
    if (categoryName) categoryNames.add(categoryName);

    rows.push({
      order: i,
      categoryName: categoryName ?? null,
      nameOp: name?.op ?? null,
      nameValue: name?.value ?? null,
      merchantOp: merchant?.op ?? null,
      merchantValue: merchant?.value ?? null,
      amountMin: amountMin ?? null,
      amountMax: amountMax ?? null,
      accountId: accountId ?? null,
      paymentChannel: paymentChannel ?? null,
      plaidPrimary: plaidPrimary ?? null,
      plaidDetailed: plaidDetailed ?? null,
    });
  });

  return { rows, categoryNames, accountIds };
}

// Every referenced category must exist for the user; every referenced account
// must be one of the user's PlaidAccounts. One query each, batched.
async function assertReferences(
  userId: string,
  categoryNames: Set<string>,
  accountIds: Set<string>
): Promise<void> {
  if (categoryNames.size) {
    const found = await prisma.transactionCategory.findMany({
      where: { userId, name: { in: [...categoryNames] } },
      select: { name: true },
    });
    const have = new Set(found.map((c) => c.name));
    const missing = [...categoryNames].filter((n) => !have.has(n));
    if (missing.length) bad(`Unknown categor${missing.length === 1 ? "y" : "ies"}: ${missing.join(", ")}`);
  }
  if (accountIds.size) {
    const found = await prisma.plaidAccount.findMany({
      where: { accountId: { in: [...accountIds] }, item: { userId } },
      select: { accountId: true },
    });
    const have = new Set(found.map((a) => a.accountId));
    const missing = [...accountIds].filter((id) => !have.has(id));
    if (missing.length) bad(`Unknown account${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);
  }
}

// Vendor display name: trimmed 1..100.
function readName(v: unknown): string {
  const s = str(v, "name");
  if (!s || s.length > 100) bad("Name must be 1–100 characters");
  return s!;
}

// --- Serialization -----------------------------------------------------------

type VendorWithConditions = Prisma.VendorGetPayload<{ include: { conditions: true } }>;

const numOrNull = (d: Prisma.Decimal | null): number | null => (d == null ? null : Number(d));

export function serializeVendor(v: VendorWithConditions) {
  return {
    id: v.id,
    name: v.name,
    icon: v.icon,
    categoryName: v.categoryName,
    priority: v.priority,
    conditions: [...v.conditions]
      .sort((a, b) => a.order - b.order)
      .map((c) => ({
        id: c.id,
        order: c.order,
        categoryName: c.categoryName,
        nameOp: c.nameOp,
        nameValue: c.nameValue,
        merchantOp: c.merchantOp,
        merchantValue: c.merchantValue,
        amountMin: numOrNull(c.amountMin),
        amountMax: numOrNull(c.amountMax),
        accountId: c.accountId,
        paymentChannel: c.paymentChannel,
        plaidPrimary: c.plaidPrimary,
        plaidDetailed: c.plaidDetailed,
      })),
  };
}

// --- Read --------------------------------------------------------------------

// All the user's vendors, priority-ascending (match order), legacy NULL-priority
// rows last. Conditions come ordered inside each vendor.
export async function listVendors(userId: string) {
  const vendors = await prisma.vendor.findMany({
    where: { userId },
    include: { conditions: true },
  });
  vendors.sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity));
  return vendors.map(serializeVendor);
}

// --- Mutations (each ends by rematching the user) ----------------------------

// Map a name-collision (@@unique userId,name) to a 400 as the task requires
// (duplicate name is a validation error, not a 409). Re-throws anything else.
function rethrow(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
    throw new VendorError(400, "A vendor with that name already exists");
  throw e;
}

// Create a vendor + its rows, appended at the END of the priority order (PRD
// assumption 1: lowest priority = highest int). Then rematch so its matches land.
export async function createVendor(userId: string, input: VendorInput) {
  const name = readName(input.name);
  const icon = str(input.icon, "icon") ?? null;
  const categoryName = str(input.categoryName, "default category") ?? null;
  const { rows, categoryNames, accountIds } = buildRows(input.conditions);
  if (categoryName) categoryNames.add(categoryName);
  await assertReferences(userId, categoryNames, accountIds);

  // ponytail: max+1 append. Single-user app, so the race between concurrent
  // creates is ignored; a collision surfaces as P2002. Add a retry if it matters.
  const max = await prisma.vendor.aggregate({ where: { userId }, _max: { priority: true } });
  const priority = (max._max.priority ?? -1) + 1;

  let vendor: VendorWithConditions;
  try {
    vendor = await prisma.vendor.create({
      data: { userId, name, icon, categoryName, priority, conditions: { create: rows } },
      include: { conditions: true },
    });
  } catch (e) {
    rethrow(e);
  }
  await rematchUser(userId);
  return serializeVendor(vendor!);
}

// Edit name/icon/default category and REPLACE the condition rows wholesale
// (replace-rows semantics — the row's identity isn't meaningful to the user).
export async function updateVendor(userId: string, id: string, input: VendorInput) {
  const existing = await prisma.vendor.findFirst({ where: { id, userId } });
  if (!existing) throw new VendorError(404, "Vendor not found");

  const name = readName(input.name);
  const icon = str(input.icon, "icon") ?? null;
  const categoryName = str(input.categoryName, "default category") ?? null;
  const { rows, categoryNames, accountIds } = buildRows(input.conditions);
  if (categoryName) categoryNames.add(categoryName);
  await assertReferences(userId, categoryNames, accountIds);

  let vendor: VendorWithConditions;
  try {
    vendor = await prisma.$transaction(async (tx) => {
      await tx.vendorCondition.deleteMany({ where: { vendorId: id } });
      return tx.vendor.update({
        where: { id },
        data: { name, icon, categoryName, conditions: { create: rows } },
        include: { conditions: true },
      });
    });
  } catch (e) {
    rethrow(e);
  }
  await rematchUser(userId);
  return serializeVendor(vendor!);
}

// Delete a vendor (rows cascade). Rematch reassigns any transactions it had
// claimed — they fall to another vendor or back into the unmatched queue.
export async function deleteVendor(userId: string, id: string): Promise<void> {
  const existing = await prisma.vendor.findFirst({ where: { id, userId } });
  if (!existing) throw new VendorError(404, "Vendor not found");
  await prisma.vendor.delete({ where: { id } });
  await rematchUser(userId);
}

// Reassign priorities from an ordered id list (index 0 = highest priority). The
// list must be exactly the user's priority-bearing vendors — a full reordering,
// not a partial one — so the resulting 0..n-1 assignment stays collision-free.
export async function reorderVendors(userId: string, orderedIds: unknown): Promise<void> {
  if (!Array.isArray(orderedIds) || orderedIds.some((x) => typeof x !== "string"))
    bad("order must be an array of vendor ids");
  const ids = orderedIds as string[];
  if (new Set(ids).size !== ids.length) bad("order contains duplicate ids");

  const active = await prisma.vendor.findMany({
    where: { userId, priority: { not: null } },
    select: { id: true },
  });
  const activeIds = new Set(active.map((v) => v.id));
  if (ids.length !== activeIds.size || ids.some((id) => !activeIds.has(id)))
    bad("order must list exactly the vendors that currently have a priority");

  // Two-phase so no intermediate write violates @@unique([userId, priority]):
  // park everyone at a guaranteed-free negative slot (all real priorities are ≥0),
  // then set the final ints. Sequential on the one tx connection.
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++)
      await tx.vendor.update({ where: { id: ids[i] }, data: { priority: -(i + 1) } });
    for (let i = 0; i < ids.length; i++)
      await tx.vendor.update({ where: { id: ids[i] }, data: { priority: i } });
  });
  await rematchUser(userId);
}
