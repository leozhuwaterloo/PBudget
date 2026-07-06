// Instantiate a catalog entry into the user's own vendor list (F4, FR2). This is
// the DB side (Prisma + rematch); vendors.ts stays pure authored data so it can be
// imported by client components (F10's picker) without pulling in Prisma.
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { rematchUser } from "../analysis/match";
import { ensureDefaultCategories } from "../categories";
import { faviconDataUri } from "../favicon";
import {
  CATALOG,
  CATALOG_BUCKET_SLUGS,
  findCatalogEntry,
  type CatalogCondition,
  type CatalogEntry,
} from "./vendors";

export class CatalogError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// One-time COPY of a catalog entry into a new user-owned, editable vendor —
// appended at the END of the priority order (lowest precedence) — followed by F1's
// rematch (materializes vendorId, closes unmatched_vendor flags). No live link
// back to the catalog: later catalog edits never touch the user's copy.
export async function instantiateCatalogEntry(
  userId: string,
  slug: string
): Promise<{ id: string; name: string; claimed: number }> {
  const entry = findCatalogEntry(slug);
  if (!entry) throw new CatalogError(404, `No catalog entry "${slug}"`);

  // Row categories reference the seeded category names; make sure they have homes.
  await ensureDefaultCategories(userId);

  const vendor = await createVendorFromEntry(userId, entry);
  await rematchUser(userId);
  // How many posted txns the new vendor now claims — F10 surfaces this as feedback.
  const claimed = await prisma.plaidTransaction.count({ where: { vendorId: vendor.id } });
  return { ...vendor, claimed };
}

async function createVendorFromEntry(
  userId: string,
  entry: CatalogEntry
): Promise<{ id: string; name: string }> {
  // Append at END: max existing priority + 1 (unique per user; NULL legacy rows
  // are ignored by _max, so the first real vendor gets priority 0).
  const { _max } = await prisma.vendor.aggregate({ where: { userId }, _max: { priority: true } });
  let priority = (_max.priority ?? -1) + 1;

  // name is unique per user; a re-instantiate of the same entry gets a suffix.
  let name = entry.name;
  for (let sfx = 2; await nameTaken(userId, name); sfx++) name = `${entry.name} (${sfx})`;

  const conditions = [
    ...entry.matchConditions.map((c) => rowFromCatalog(c, "match")),
    ...entry.categoryRules.map((c) => rowFromCatalog(c, "category")),
  ];

  const icon = await faviconDataUri(entry.link); // cache the favicon once at copy time

  // A concurrent instantiate could grab our priority first (unique constraint);
  // bump and retry a handful of times before giving up.
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.vendor.create({
        data: {
          userId,
          name,
          link: entry.link,
          icon,
          categoryName: entry.categoryName,
          priority,
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

async function nameTaken(userId: string, name: string): Promise<boolean> {
  return !!(await prisma.vendor.findUnique({ where: { userId_name: { userId, name } } }));
}

// One catalog condition → a VendorCondition create input tagged with its role.
// Match rows drop the category (identity only); category rules keep it.
function rowFromCatalog(
  c: CatalogCondition,
  role: "match" | "category"
): Omit<Prisma.VendorConditionCreateManyVendorInput, "vendorId"> {
  return {
    role,
    order: c.order,
    categoryName: role === "category" ? c.categoryName ?? null : null,
    nameOp: c.nameOp ?? null,
    nameValue: c.nameValue ?? null,
    merchantOp: c.merchantOp ?? null,
    merchantValue: c.merchantValue ?? null,
    paymentChannel: c.paymentChannel ?? null,
    plaidPrimary: c.plaidPrimary ?? null,
    plaidDetailed: c.plaidDetailed ?? null,
    amountMin: c.amountMin ?? null,
    amountMax: c.amountMax ?? null,
  };
}

// --- Seeding (A) -------------------------------------------------------------

// Seed a set of catalog entries into a user's vendor list, idempotently (skips a
// name already present), with ONE rematch at the end. Returns how many were newly
// created. Entries are created in array order → catalog order → merchants (higher
// precedence) before catch-all buckets (lowest).
export async function seedCatalogVendors(userId: string, entries: CatalogEntry[]): Promise<number> {
  await ensureDefaultCategories(userId);
  let created = 0;
  for (const entry of entries) {
    if (await nameTaken(userId, entry.name)) continue;
    await createVendorFromEntry(userId, entry);
    created++;
  }
  await rematchUser(userId);
  return created;
}

// New signups get only the 3 generic catch-all buckets (Self / General Bank /
// General Spending) — they categorize everything by Plaid category without seeding
// 200 owner-specific merchants. Users add merchants themselves via the catalog.
export function seedNewUserVendors(userId: string): Promise<number> {
  return seedCatalogVendors(userId, CATALOG.filter((e) => CATALOG_BUCKET_SLUGS.has(e.slug)));
}

// The full catalog (all merchants + buckets) — used to backfill the owner account,
// reconstructing the entire Portfolio funnel so its unmatched queue reaches zero.
export function seedFullCatalog(userId: string): Promise<number> {
  return seedCatalogVendors(userId, CATALOG);
}
