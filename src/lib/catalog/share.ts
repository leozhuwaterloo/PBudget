// Community vendor-rule sharing (replaces static-catalog browsing). A user can
// share their own vendor rules; everyone browses shared rules + ALL of Admin's
// (implicitly shared), then ADOPTS one either as a `clone` (independent, editable)
// or a `link` (a snapshot that remembers its source and can be re-synced). Every
// adopt is a COPY the adopter owns — the match engine only ever runs a user's own
// vendors, so no cross-user rule ever touches another account's transactions live.
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { rematchUser } from "../analysis/match";
import { ensureDefaultCategories } from "../categories";
import { serializeVendor } from "../vendors";
import { CatalogError } from "./instantiate";

// The canonical Admin account — everything it owns is shared by default, and its id
// is public so anyone can filter the catalog to it. Also isAdmin-flagged in the DB.
export const ADMIN_EMAIL = "yuner25699@gmail.com";

type VendorWithConditions = Prisma.VendorGetPayload<{ include: { conditions: true } }>;

// Browsable/adoptable iff the owner shared it OR the owner is Admin, AND it is an
// original (not itself an adopted link — no re-share chains).
const SHAREABLE = {
  linkedFromId: null,
  OR: [{ shared: true }, { user: { isAdmin: true } }],
} satisfies Prisma.VendorWhereInput;

// ponytail: browse loads the shared set and filters name in JS (case-insensitive,
// portable SQLite↔Postgres like listVendors) then caps it. Add real search +
// pagination if the shared catalog ever outgrows a few hundred rows.
const BROWSE_CAP = 300;

// The community catalog: shared + Admin rules, minus the requester's own, filtered
// by a name substring and/or an owner user id. Returns the Admin id so the UI can
// offer a one-click "Admin's rules" filter.
export async function browseCommunity(
  requesterId: string,
  opts: { q?: string; userId?: string } = {}
) {
  const admin = await prisma.user.findFirst({ where: { email: ADMIN_EMAIL }, select: { id: true } });
  const vendors = await prisma.vendor.findMany({
    where: { ...SHAREABLE, userId: opts.userId ? opts.userId : { not: requesterId } },
    include: { conditions: true },
  });
  const needle = (opts.q ?? "").trim().toLowerCase();
  const list = vendors
    .filter((v) => !needle || v.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, BROWSE_CAP);
  // Own rows CAN appear (e.g. filter to your own id to confirm what you shared) but
  // are flagged isOwn so the UI shows them without adopt actions — you can't adopt
  // into the account that already owns them (adoptVendor enforces this server-side).
  const entries = list.map((v) => {
    const s = serializeVendor(v);
    return {
      id: v.id,
      ownerId: v.userId,
      isOwn: v.userId === requesterId,
      name: s.name,
      link: s.link,
      icon: s.icon,
      categoryName: s.categoryName,
      matchConditions: s.matchConditions,
      categoryRules: s.categoryRules,
    };
  });
  return { entries, adminUserId: admin?.id ?? null };
}

// Adopt a shared rule into the user's own vendor list, then rematch. clone → an
// independent editable copy; link → a re-syncable snapshot (linkedFromId set).
export async function adoptVendor(
  userId: string,
  sourceVendorId: string,
  mode: "clone" | "link"
): Promise<{ id: string; name: string; claimed: number }> {
  const source = await prisma.vendor.findFirst({
    where: { id: sourceVendorId, ...SHAREABLE, userId: { not: userId } },
    include: { conditions: true },
  });
  if (!source) throw new CatalogError(404, "That shared rule isn’t available.");
  await ensureDefaultCategories(userId);
  const vendor = await createVendorCopy(userId, source, mode === "link" ? source.id : null);
  await rematchUser(userId);
  const claimed = await prisma.plaidTransaction.count({ where: { vendorId: vendor.id } });
  return { ...vendor, claimed };
}

// Toggle whether others can adopt this (owned) vendor.
export async function setShared(userId: string, vendorId: string, shared: boolean): Promise<void> {
  const r = await prisma.vendor.updateMany({ where: { id: vendorId, userId }, data: { shared } });
  if (r.count === 0) throw new CatalogError(404, "Vendor not found");
}

// Detach a snapshot-link: it becomes an independent editable clone (no source).
export async function detachLinked(userId: string, vendorId: string): Promise<void> {
  const r = await prisma.vendor.updateMany({ where: { id: vendorId, userId }, data: { linkedFromId: null } });
  if (r.count === 0) throw new CatalogError(404, "Vendor not found");
}

// Re-pull the current source rule into a linked snapshot: replace rows + link + icon
// + default category from the source (the adopter's name/priority/link identity is
// kept). Fails if the vendor isn't linked, or the source is gone / no longer shared.
export async function resyncLinked(userId: string, vendorId: string): Promise<{ claimed: number }> {
  const mine = await prisma.vendor.findFirst({ where: { id: vendorId, userId } });
  if (!mine) throw new CatalogError(404, "Vendor not found");
  if (!mine.linkedFromId) throw new CatalogError(400, "This vendor isn’t linked to a shared rule.");
  const source = await prisma.vendor.findFirst({
    where: { id: mine.linkedFromId, ...SHAREABLE },
    include: { conditions: true },
  });
  if (!source) throw new CatalogError(400, "The shared rule is no longer available.");
  await ensureCategories(userId, source);
  await prisma.$transaction(async (tx) => {
    await tx.vendorCondition.deleteMany({ where: { vendorId } });
    await tx.vendor.update({
      where: { id: vendorId },
      data: {
        link: source.link,
        icon: source.icon,
        categoryName: source.categoryName,
        conditions: { create: source.conditions.map(copyRow) },
      },
    });
  });
  await rematchUser(userId);
  const claimed = await prisma.plaidTransaction.count({ where: { vendorId } });
  return { claimed };
}

// --- internals ---------------------------------------------------------------

// The source references the owner's category names; ensure the adopter has homes for
// them so the copied rule resolves to a real category (not Uncategorized).
async function ensureCategories(userId: string, source: VendorWithConditions): Promise<void> {
  const names = new Set(
    [source.categoryName, ...source.conditions.map((c) => c.categoryName)].filter((x): x is string => !!x)
  );
  for (const name of names) {
    await prisma.transactionCategory.upsert({
      where: { userId_name: { userId, name } },
      create: { userId, name },
      update: {},
    });
  }
}

async function nameTaken(userId: string, name: string): Promise<boolean> {
  return !!(await prisma.vendor.findUnique({ where: { userId_name: { userId, name } } }));
}

// Copy a source vendor (+ rows) into a new user-owned vendor at lowest priority.
async function createVendorCopy(
  userId: string,
  source: VendorWithConditions,
  linkedFromId: string | null
): Promise<{ id: string; name: string }> {
  await ensureCategories(userId, source);

  const { _max } = await prisma.vendor.aggregate({ where: { userId }, _max: { priority: true } });
  let priority = (_max.priority ?? -1) + 1;

  let name = source.name;
  for (let sfx = 2; await nameTaken(userId, name); sfx++) name = `${source.name} (${sfx})`;

  const conditions = source.conditions.map(copyRow);

  // A concurrent adopt could grab our priority slot first (@@unique userId,priority);
  // bump and retry a few times before giving up.
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.vendor.create({
        data: {
          userId,
          name,
          link: source.link,
          icon: source.icon,
          categoryName: source.categoryName,
          priority,
          linkedFromId,
          conditions: { create: conditions },
        },
        select: { id: true, name: true },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002" && attempt < 5) {
        priority++;
        continue;
      }
      throw e;
    }
  }
}

// One source condition → a create row for the copy. accountId is DROPPED (it points
// at the source owner's account, not the adopter's); every other field carries over.
function copyRow(
  c: VendorWithConditions["conditions"][number]
): Omit<Prisma.VendorConditionCreateManyVendorInput, "vendorId"> {
  return {
    role: c.role,
    order: c.order,
    categoryName: c.categoryName,
    nameOp: c.nameOp,
    nameValue: c.nameValue,
    merchantOp: c.merchantOp,
    merchantValue: c.merchantValue,
    amountMin: c.amountMin,
    amountMax: c.amountMax,
    accountId: null,
    dayOfMonth: c.dayOfMonth,
    daysOfMonth: c.daysOfMonth,
    paymentChannel: c.paymentChannel,
    plaidPrimary: c.plaidPrimary,
    plaidDetailed: c.plaidDetailed,
    plaidConfidence: c.plaidConfidence,
  };
}
