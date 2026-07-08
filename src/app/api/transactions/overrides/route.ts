import { NextResponse } from "next/server";
import { gate, num } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { normalizeVendor } from "@/lib/analysis/vendor";

export const dynamic = "force-dynamic";

// GET /api/transactions/overrides — every transaction whose category the user set
// manually, newest first, with the overridden category + the required reason.
// Backs Customizations → "Category overrides". categoryOverride/Reason are
// plaintext (not in the encrypted column set) so they're DB-filterable; name and
// merchantName decrypt on read via the Prisma extension.
export async function GET() {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  const txns = await prisma.plaidTransaction.findMany({
    where: { categoryOverride: { not: null }, account: { item: { userId } } },
    orderBy: { datetime: "desc" },
  });

  const overrides = txns.map((t) => ({
    transactionId: t.transactionId,
    name: t.name,
    vendor: normalizeVendor(t.merchantName, t.name),
    category: t.categoryOverride!,
    reason: t.categoryOverrideReason,
    amount: num(t.amount),
    currency: t.isoCurrencyCode,
    date: t.datetime,
  }));

  return NextResponse.json({ overrides });
}
