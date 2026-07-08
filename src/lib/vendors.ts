// V2 vendor CRUD + reorder (F3, FR1). Auth lives in the route; this is the write
// side every mutation routes through so validation and the post-mutation rematch
// stay in one place. Matching semantics are NEVER forked here — the row/vendor
// evaluators and the regex validator all come from F1's match.ts.
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { validateRegex, rematchUser, rematchAfterVendorChange } from "./analysis/match";
import { iconForLink, iconForImageUrl } from "./favicon";
import { normalizeStr } from "./analysis/vendor";
import { serializeDays, effectiveDays } from "./dayofmonth";

// Accepted on save: contains + regex only (equals/starts_with retired). The
// matcher still evaluates legacy equals/starts_with rows; they just can't be created.
const TEXT_OPS = new Set(["contains", "regex"]);
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
  daysOfMonth?: number[] | null;
  paymentChannel?: string | null;
  plaidPrimary?: string | null;
  plaidDetailed?: string | null;
  plaidConfidence?: string | null;
};
export type VendorInput = {
  name?: unknown;
  link?: unknown;
  iconLink?: unknown; // optional direct image URL for the icon
  categoryName?: unknown; // default category (fallback)
  matchConditions?: unknown; // identity rows (role "match")
  categoryRules?: unknown; // category-refinement rows (role "category")
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
  if (!TEXT_OPS.has(o!)) bad(`${field} operator must be one of contains, regex`);
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

// Day-of-month filter: a list of integer day codes, each in [-30, 31]. >0 is that
// calendar day; 0 = last day; -n = n days before last. Stored deduped as CSV (see
// dayofmonth.ts). Empty/absent → undefined (no filter).
function daysOfMonthField(v: unknown, field: string): string | undefined {
  if (v == null) return undefined;
  if (!Array.isArray(v)) bad(`${field} must be a list`);
  const days = (v as unknown[]).map((x) => {
    if (typeof x !== "number" || !Number.isInteger(x)) bad(`${field} must be integers`);
    if ((x as number) > 31 || (x as number) < -30) bad(`${field} values must be between -30 and 31`);
    return x as number;
  });
  return serializeDays(days) ?? undefined;
}

// --- Validation --------------------------------------------------------------

// Validate a raw condition list into Prisma create-data for one ROLE. Enforces:
// ≥1 matching field per row, valid ops/regex, amountMin ≤ amountMax, channel enum;
// a "category" row additionally needs a categoryName (its outcome), a "match" row
// ignores any category. An empty/absent list yields []. Category/account existence
// is checked separately (batched across the whole vendor). `label` names rows in
// 400 messages ("match condition 1" / "category rule 2").
function buildRows(
  raw: unknown,
  role: "match" | "category",
  label: string
): { rows: RowData[]; categoryNames: Set<string>; accountIds: Set<string> } {
  const rows: RowData[] = [];
  const categoryNames = new Set<string>();
  const accountIds = new Set<string>();
  if (raw == null) return { rows, categoryNames, accountIds };
  if (!Array.isArray(raw)) bad(`${label} must be a list`);

  (raw as ConditionInput[]).forEach((c, i) => {
    const where = `${label} ${i + 1}`;
    if (c == null || typeof c !== "object") bad(`${where} is not an object`);

    const name = textPair(c.nameOp, c.nameValue, `${where} transaction name`);
    const merchant = textPair(c.merchantOp, c.merchantValue, `${where} merchant name`);
    const amountMin = amount(c.amountMin, `${where} amountMin`);
    const amountMax = amount(c.amountMax, `${where} amountMax`);
    if (amountMin !== undefined && amountMax !== undefined && amountMin > amountMax)
      bad(`${where}: amountMin must be ≤ amountMax`);

    const accountId = str(c.accountId, `${where} account`);
    if (accountId) accountIds.add(accountId);

    const domCsv = daysOfMonthField(c.daysOfMonth, `${where} day of month`);

    let paymentChannel = str(c.paymentChannel, `${where} payment channel`);
    if (paymentChannel) {
      paymentChannel = normalizeStr(paymentChannel);
      if (!CHANNELS.has(paymentChannel))
        bad(`${where}: payment channel must be one of online, in store, other`);
    }
    const plaidPrimary = str(c.plaidPrimary, `${where} Plaid primary`);
    const plaidDetailed = str(c.plaidDetailed, `${where} Plaid detailed`);
    const plaidConfidence = str(c.plaidConfidence, `${where} Plaid confidence`);

    // ≥1 matching field. The row's category is an outcome, so it never counts.
    const fieldCount =
      (name ? 1 : 0) + (merchant ? 1 : 0) + (amountMin !== undefined ? 1 : 0) +
      (amountMax !== undefined ? 1 : 0) + (accountId ? 1 : 0) + (domCsv !== undefined ? 1 : 0) +
      (paymentChannel ? 1 : 0) + (plaidPrimary ? 1 : 0) + (plaidDetailed ? 1 : 0) + (plaidConfidence ? 1 : 0);
    if (fieldCount === 0) bad(`${where} needs at least one matching field`);

    const categoryName = str(c.categoryName, `${where} category`);
    if (role === "category" && !categoryName) bad(`${where} needs a category`);
    if (role === "category" && categoryName) categoryNames.add(categoryName);

    rows.push({
      role,
      order: i,
      categoryName: role === "category" ? categoryName ?? null : null,
      nameOp: name?.op ?? null,
      nameValue: name?.value ?? null,
      merchantOp: merchant?.op ?? null,
      merchantValue: merchant?.value ?? null,
      amountMin: amountMin ?? null,
      amountMax: amountMax ?? null,
      accountId: accountId ?? null,
      dayOfMonth: null, // legacy column; new writes use daysOfMonth only
      daysOfMonth: domCsv ?? null,
      paymentChannel: paymentChannel ?? null,
      plaidPrimary: plaidPrimary ?? null,
      plaidDetailed: plaidDetailed ?? null,
      plaidConfidence: plaidConfidence ?? null,
    });
  });

  return { rows, categoryNames, accountIds };
}

// Combine a vendor's match + category rows from raw input, enforcing "not both
// empty" (a vendor must be able to claim SOME txn). Returns the merged create-data.
function buildVendorRows(input: VendorInput): {
  rows: RowData[];
  categoryNames: Set<string>;
  accountIds: Set<string>;
} {
  const match = buildRows(input.matchConditions, "match", "match condition");
  const cat = buildRows(input.categoryRules, "category", "category rule");
  if (match.rows.length === 0 && cat.rows.length === 0)
    bad("A vendor needs at least one match condition or category rule");
  return {
    rows: [...match.rows, ...cat.rows],
    categoryNames: new Set([...match.categoryNames, ...cat.categoryNames]),
    accountIds: new Set([...match.accountIds, ...cat.accountIds]),
  };
}

// A vendor link: a Google Maps entry (local) or website (online) URL. Must be
// http(s) so it's safe as an href (rejects javascript:/data: at the boundary).
// Reused for the icon-image URL, which has the same http(s) requirement.
function readLink(v: unknown, field = "link", label = "Link"): string | null {
  const s = str(v, field);
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) bad(`${label} must start with http:// or https://`);
  return s;
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

// Vendor default category: REQUIRED. Every vendor must carry a fallback category
// so a matched transaction always resolves to one. Existence checked separately.
function readCategory(v: unknown): string {
  const s = str(v, "default category");
  if (!s) bad("A vendor needs a default category");
  return s!;
}

// --- Serialization -----------------------------------------------------------

type VendorWithConditions = Prisma.VendorGetPayload<{ include: { conditions: true } }>;

const numOrNull = (d: Prisma.Decimal | null): number | null => (d == null ? null : Number(d));

type SerializedRow = ReturnType<typeof serializeRow>;
function serializeRow(c: VendorWithConditions["conditions"][number]) {
  return {
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
    daysOfMonth: effectiveDays(c.daysOfMonth, c.dayOfMonth),
    paymentChannel: c.paymentChannel,
    plaidPrimary: c.plaidPrimary,
    plaidDetailed: c.plaidDetailed,
    plaidConfidence: c.plaidConfidence,
  };
}

export function serializeVendor(v: VendorWithConditions) {
  const rows = [...v.conditions].sort((a, b) => a.order - b.order);
  const byRole = (role: string): SerializedRow[] =>
    rows.filter((c) => c.role === role).map(serializeRow);
  return {
    id: v.id,
    name: v.name,
    link: v.link,
    iconLink: v.iconLink,
    icon: v.icon,
    categoryName: v.categoryName,
    priority: v.priority,
    matchConditions: byRole("match"),
    categoryRules: byRole("category"),
  };
}

// --- Read --------------------------------------------------------------------

const VENDOR_PAGE_SIZE = 25;

// The user's vendors, priority-ascending (match order), legacy NULL-priority rows
// last, conditions ordered inside each. Search + pagination are OPT-IN: with no
// `page` arg the full list comes back (the Review "add to a vendor" picker needs
// all of them). Vendor.name isn't encrypted, but we filter/paginate in JS to keep
// case-insensitive search portable across SQLite (dev) and Postgres (prod) — the
// set is bounded so this stays a cheap indexed read. `orderedIds` is the FULL
// priority order (all pages) so the client can still reorder across page bounds.
export async function listVendors(
  userId: string,
  opts: { page?: number; q?: string; category?: string } = {}
) {
  const vendors = await prisma.vendor.findMany({
    where: { userId },
    include: { conditions: true },
  });
  vendors.sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity));
  const all = vendors.map(serializeVendor);
  const orderedIds = all.filter((v) => v.priority != null).map((v) => v.id);
  const q = (opts.q ?? "").toLowerCase().trim();
  const category = (opts.category ?? "").trim(); // exact default-category filter
  const filtered = all.filter(
    (v) =>
      (!q || v.name.toLowerCase().includes(q)) &&
      (!category || v.categoryName === category)
  );
  const total = filtered.length;
  const lastPage = Math.max(0, Math.ceil(total / VENDOR_PAGE_SIZE) - 1);
  const page = opts.page === undefined ? 0 : Math.max(0, Math.min(opts.page, lastPage));
  const view =
    opts.page === undefined
      ? filtered
      : filtered.slice(page * VENDOR_PAGE_SIZE, page * VENDOR_PAGE_SIZE + VENDOR_PAGE_SIZE);
  return { vendors: view, total, page, pageSize: VENDOR_PAGE_SIZE, orderedIds };
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
  const link = readLink(input.link);
  const iconLink = readLink(input.iconLink, "iconLink", "Icon link");
  const categoryName = readCategory(input.categoryName);
  const { rows, categoryNames, accountIds } = buildVendorRows(input);
  categoryNames.add(categoryName);
  await assertReferences(userId, categoryNames, accountIds);

  // ponytail: max+1 append. Single-user app, so the race between concurrent
  // creates is ignored; a collision surfaces as P2002. Add a retry if it matters.
  const max = await prisma.vendor.aggregate({ where: { userId }, _max: { priority: true } });
  const priority = (max._max.priority ?? -1) + 1;
  // Explicit iconLink wins; else derive the favicon/Maps photo from `link`. Cached once.
  // If the override URL won't fetch (transient CDN failure), fall back to the website
  // favicon rather than leaving the vendor icon-less.
  const icon = (iconLink ? await iconForImageUrl(iconLink) : null) ?? (await iconForLink(link));

  let vendor: VendorWithConditions;
  try {
    vendor = await prisma.vendor.create({
      data: { userId, name, link, iconLink, icon, categoryName, priority, conditions: { create: rows } },
      include: { conditions: true },
    });
  } catch (e) {
    rethrow(e);
  }
  await rematchAfterVendorChange(userId, vendor!.id); // incremental: only unmatched txns can newly match
  return serializeVendor(vendor!);
}

// Edit name/link/default category and REPLACE the condition rows wholesale
// (replace-rows semantics — the row's identity isn't meaningful to the user).
export async function updateVendor(userId: string, id: string, input: VendorInput) {
  const existing = await prisma.vendor.findFirst({ where: { id, userId } });
  if (!existing) throw new VendorError(404, "Vendor not found");

  const name = readName(input.name);
  const link = readLink(input.link);
  const iconLink = readLink(input.iconLink, "iconLink", "Icon link");
  const categoryName = readCategory(input.categoryName);
  const { rows, categoryNames, accountIds } = buildVendorRows(input);
  categoryNames.add(categoryName);
  await assertReferences(userId, categoryNames, accountIds);

  // Re-fetch only when the icon SOURCE changed (iconLink if set, else link) — keeps
  // ordinary edits (renames, rule tweaks) a pure DB write with no outbound request.
  const source = iconLink ?? link;
  const prevSource = existing.iconLink ?? existing.link;
  const icon =
    source === prevSource
      ? existing.icon
      : (iconLink ? await iconForImageUrl(iconLink) : null) ?? (await iconForLink(link));

  let vendor: VendorWithConditions;
  try {
    vendor = await prisma.$transaction(async (tx) => {
      await tx.vendorCondition.deleteMany({ where: { vendorId: id } });
      return tx.vendor.update({
        where: { id },
        data: { name, link, iconLink, icon, categoryName, conditions: { create: rows } },
        include: { conditions: true },
      });
    });
  } catch (e) {
    rethrow(e);
  }
  // Incremental: re-evaluate only this vendor's own txns + the currently-unmatched.
  await rematchAfterVendorChange(userId, id);
  return serializeVendor(vendor!);
}

// Delete a vendor (rows cascade). Rematch reassigns any transactions it had
// claimed — they fall to another vendor or back into the unmatched queue.
export async function deleteVendor(userId: string, id: string): Promise<void> {
  const existing = await prisma.vendor.findFirst({ where: { id, userId } });
  if (!existing) throw new VendorError(404, "Vendor not found");
  await prisma.vendor.delete({ where: { id } });
  // The deleted vendor's txns still carry its id (vendorId is a bare scalar) — the
  // incremental pass re-homes exactly them + the unmatched, nothing else.
  await rematchAfterVendorChange(userId, id);
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
