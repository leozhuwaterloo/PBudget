// Instantiate a catalog entry into the user's own vendor list (F4, FR2). This is
// the DB side (Prisma + rematch); vendors.ts stays pure authored data so it can be
// imported by client components (F10's picker) without pulling in Prisma.
import { prisma } from "../db";
import { rematchUser } from "../analysis/match";
import { ensureDefaultCategories } from "../categories";
import { findCatalogEntry, type CatalogEntry } from "./vendors";

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

  // A concurrent instantiate could grab our priority first (unique constraint);
  // bump and retry a handful of times before giving up.
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.vendor.create({
        data: {
          userId,
          name,
          icon: entry.icon,
          categoryName: entry.categoryName,
          priority,
          conditions: {
            create: entry.conditions.map((c) => ({
              order: c.order,
              categoryName: c.categoryName,
              nameOp: c.nameOp ?? null,
              nameValue: c.nameValue ?? null,
              merchantOp: c.merchantOp ?? null,
              merchantValue: c.merchantValue ?? null,
              paymentChannel: c.paymentChannel ?? null,
              plaidPrimary: c.plaidPrimary ?? null,
              plaidDetailed: c.plaidDetailed ?? null,
              amountMin: c.amountMin ?? null,
              amountMax: c.amountMax ?? null,
            })),
          },
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
