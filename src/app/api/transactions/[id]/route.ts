import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { plaidPrimary, plaidDetailed, plaidConfidence } from "@/lib/analysis/vendor";
import { resolveCategory, TRANSFER_CATEGORY } from "@/lib/categories";
import { RULES } from "@/lib/analysis/constants";

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
    categoryOverride: t.categoryOverride,
    categoryOverrideReason: t.categoryOverrideReason,
  });
}

// PATCH /api/transactions/[id] — set (or clear) the per-transaction category
// override. Backs Review's "override category" on unmatched transfers. A non-null
// categoryName must reference one of the user's categories; "" / null clears it.
// When the resolved category is no longer Transfer, any open unmatched_transfer
// flag for this txn is resolved (mirrors the analyzer's applyFlags invariant, so a
// re-analyze keeps it resolved).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  const body = await req.json().catch(() => ({}));
  const raw = body?.categoryName;
  if (raw != null && typeof raw !== "string")
    return NextResponse.json({ error: "categoryName must be a string or null" }, { status: 400 });
  const override = raw == null || raw.trim() === "" ? null : raw.trim();

  // A manual category override must carry a reason (audit trail). Clearing an
  // override (override === null) needs none — the reason is cleared with it.
  const rawReason = body?.reason;
  if (rawReason != null && typeof rawReason !== "string")
    return NextResponse.json({ error: "reason must be a string or null" }, { status: 400 });
  const reason = rawReason == null ? "" : rawReason.trim();
  if (override && !reason)
    return NextResponse.json({ error: "A reason is required when setting a category" }, { status: 400 });

  const t = await prisma.plaidTransaction.findFirst({
    where: { transactionId: params.id, account: { item: { userId } } },
  });
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (override) {
    const cat = await prisma.transactionCategory.findFirst({ where: { userId, name: override } });
    if (!cat) return NextResponse.json({ error: `Unknown category: ${override}` }, { status: 400 });
  }

  await prisma.plaidTransaction.update({
    where: { transactionId: t.transactionId },
    data: { categoryOverride: override, categoryOverrideReason: override ? reason : null },
  });

  const vendor = t.vendorId
    ? await prisma.vendor.findUnique({ where: { id: t.vendorId }, include: { conditions: true } })
    : null;
  const resolved = resolveCategory(vendor, { ...t, categoryOverride: override });
  if (resolved !== TRANSFER_CATEGORY) {
    await prisma.transactionFlag.updateMany({
      where: { userId, rule: RULES.unmatchedTransfer, transactionId: t.transactionId, status: "open" },
      data: { status: "resolved", resolvedAt: new Date() },
    });
  }

  return NextResponse.json({ ok: true, category: resolved });
}
