import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { plaidPrimary, plaidDetailed, normalizeVendor } from "@/lib/analysis/vendor";
import { resolveCategory } from "@/lib/categories";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

// GET /api/accounts/transactions?account_id=X&page=N — the RAW transaction browser
// feed for one account (FR8). Returns PlaidTransaction rows AS FETCHED (name,
// merchant, amount, date, pending, Plaid primary/detailed) paged newest-first,
// each annotated with the currently-resolved vendor + category (F2's waterfall,
// read live — never snapshotted) and its split state. `eligibleForSplit` is the
// FR5 gate the Split action reads (posted, ungrouped, unsplit).
export async function GET(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  const url = new URL(req.url);
  const accountId = url.searchParams.get("account_id");
  if (!accountId) return NextResponse.json({ error: "Missing account_id" }, { status: 400 });
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) | 0);

  // Ownership: the account must belong to one of this user's items.
  const account = await prisma.plaidAccount.findFirst({
    where: { accountId, item: { userId } },
    select: { accountId: true },
  });
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const total = await prisma.plaidTransaction.count({ where: { accountId } });
  const rows = await prisma.plaidTransaction.findMany({
    where: { accountId },
    orderBy: [{ datetime: "desc" }, { transactionId: "asc" }],
    skip: page * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  // The read-model inputs, loaded once (mirrors effectiveTransactions): the user's
  // vendors (for name/link + waterfall) and — scoped to this page's rows — their
  // split parts and merge-leg membership.
  const ids = rows.map((r) => r.transactionId);
  const [vendors, splits, legs] = await Promise.all([
    prisma.vendor.findMany({ where: { userId }, include: { conditions: true } }),
    prisma.transactionSplit.findMany({
      where: { userId, parentTransactionId: { in: ids } },
      include: { parts: { orderBy: { id: "asc" } } },
    }),
    prisma.mergeGroupLeg.findMany({ where: { transactionId: { in: ids } }, select: { transactionId: true } }),
  ]);

  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const splitByParent = new Map(splits.map((s) => [s.parentTransactionId, s]));
  const legIds = new Set(legs.map((l) => l.transactionId));

  const transactions = rows.map((t) => {
    const vendor = (t.vendorId && vendorById.get(t.vendorId)) || null;
    const split = splitByParent.get(t.transactionId);
    return {
      transactionId: t.transactionId,
      name: t.name,
      merchantName: t.merchantName,
      amount: Number(t.amount),
      currency: t.isoCurrencyCode,
      date: t.datetime.toISOString(),
      pending: t.pending,
      plaidPrimary: plaidPrimary(t.category),
      plaidDetailed: plaidDetailed(t.category),
      vendorName: vendor?.name ?? normalizeVendor(t.merchantName, t.name),
      vendorLink: vendor?.link ?? null,
      category: resolveCategory(vendor, t, null),
      isMergeLeg: legIds.has(t.transactionId),
      split: split ? { parts: split.parts.map((p) => ({ id: p.id, amount: Number(p.amount), label: p.label, categoryName: p.categoryName })) } : null,
      // FR5 eligibility: posted, ungrouped, and not already split.
      eligibleForSplit: !t.pending && !legIds.has(t.transactionId) && !split,
    };
  });

  return NextResponse.json({ transactions, page, pageSize: PAGE_SIZE, total });
}
