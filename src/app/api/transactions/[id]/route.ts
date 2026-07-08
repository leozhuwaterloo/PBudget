import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { plaidPrimary, plaidDetailed, plaidConfidence } from "@/lib/analysis/vendor";
import { resolveCategory } from "@/lib/categories";

export const dynamic = "force-dynamic";

// GET /api/transactions/[id] — the raw record for one transaction, scoped to the
// user's accounts. Backs the Review "View transaction" modal. PII (name/merchant/
// account name) is decrypted by the Prisma extension on read.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  const t = await prisma.plaidTransaction.findFirst({
    where: { transactionId: params.id, account: { item: { userId } } },
    include: { account: { select: { name: true } } },
  });
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Derived layer (mirrors the funnel): the materialized winning vendor + the live
  // category waterfall. Unmatched txns have vendorId=null → vendor null, category
  // falls back to the Plaid primary. Whole-txn view, so no split-part override.
  const vendor = t.vendorId
    ? await prisma.vendor.findUnique({ where: { id: t.vendorId }, include: { conditions: true } })
    : null;

  return NextResponse.json({
    transactionId: t.transactionId,
    name: t.name,
    merchantName: t.merchantName,
    amount: Number(t.amount),
    currency: t.isoCurrencyCode,
    date: t.datetime.toISOString(),
    account: t.account.name,
    paymentChannel: t.paymentChannel,
    pending: t.pending,
    website: t.website,
    vendor: vendor?.name ?? null,
    category: resolveCategory(vendor, t),
    plaidPrimary: plaidPrimary(t.category),
    plaidDetailed: plaidDetailed(t.category),
    plaidConfidence: plaidConfidence(t.category),
  });
}
