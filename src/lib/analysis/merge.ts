import type { MergeGroup } from "@prisma/client";
import { prisma } from "../db";
import { categoryFor } from "../categories";
import { normalizeVendor, plaidPrimary } from "./vendor";
import { primaryLeg, netAmount } from "./groups";

// Create a merge group over legIds (auto-match `auto` or manual merge `confirmed`,
// FR3). Derives title/vendor/category/date from the primary leg (largest outflow),
// netAmount = signed sum of legs, and RESOLVES the legs' open flags. This is the
// shared primitive: F1 auto-match and F3 manual merge both call it.
//
// ponytail: assumes the caller validated the legs (N>=2, posted-only, single
// currency, none already grouped) — auto-match and F3's /api/merge both do. Kept
// a thin primitive so neither side reimplements the group-shape derivation.
export async function createMergeGroup(
  userId: string,
  legIds: string[],
  opts: { status: "auto" | "confirmed" }
): Promise<MergeGroup> {
  const legs = await prisma.plaidTransaction.findMany({
    where: { transactionId: { in: legIds } },
  });
  if (legs.length < 2) throw new Error("createMergeGroup: need >= 2 legs");

  const primary = primaryLeg(legs);
  const pp = plaidPrimary(primary.category);
  const mappings = await prisma.categoryMapping.findMany({ where: { userId } });

  const group = await prisma.mergeGroup.create({
    data: {
      userId,
      status: opts.status,
      title: primary.name,
      vendorName: normalizeVendor(primary.merchantName, primary.name),
      categoryName: pp ? categoryFor(mappings, pp) : null,
      date: primary.datetime,
      netAmount: netAmount(legs),
      currency: primary.isoCurrencyCode,
      legs: { create: legs.map((l) => ({ transactionId: l.transactionId })) },
    },
  });

  // Merging clears the legs' OPEN flags (FR3). Dismissed stays dismissed
  // (permanence, FR4); resolved stays resolved. The analyzer never re-flags legs
  // because they are excluded from effective items.
  await prisma.transactionFlag.updateMany({
    where: { transactionId: { in: legIds }, status: "open" },
    data: { status: "resolved", resolvedAt: new Date() },
  });

  return group;
}
