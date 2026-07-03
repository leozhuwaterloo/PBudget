import { NextResponse } from "next/server";
import { gate, num } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { categoryFor } from "@/lib/categories";
import { normalizeVendor, plaidPrimary } from "@/lib/analysis/vendor";

// GET /api/merge/candidates?exclude=id1,id2 — the merge picker's pool: ALL of the
// user's POSTED, ungrouped transactions (flagged or not; FR3). Pending rows and
// existing group legs are never mergeable. `exclude` drops already-picked ids.
export async function GET(req: Request) {
  const g = await gate({ verified: true, subscribed: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  const exclude = new Set(
    (new URL(req.url).searchParams.get("exclude") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const legIds = new Set(
    (await prisma.mergeGroupLeg.findMany({ select: { transactionId: true } })).map(
      (l) => l.transactionId
    )
  );
  const [txns, mappings] = await Promise.all([
    prisma.plaidTransaction.findMany({
      where: { pending: false, account: { item: { userId } } },
      orderBy: { datetime: "desc" },
    }),
    prisma.categoryMapping.findMany({ where: { userId } }),
  ]);

  const candidates = txns
    .filter((t) => !legIds.has(t.transactionId) && !exclude.has(t.transactionId))
    .map((t) => {
      const pp = plaidPrimary(t.category);
      return {
        id: t.transactionId,
        name: t.name,
        merchantName: t.merchantName,
        vendorName: normalizeVendor(t.merchantName, t.name),
        amount: num(t.amount),
        currency: t.isoCurrencyCode,
        date: t.datetime,
        accountId: t.accountId,
        categoryName: pp ? categoryFor(mappings, pp) : null,
      };
    });

  return NextResponse.json({ candidates });
}
