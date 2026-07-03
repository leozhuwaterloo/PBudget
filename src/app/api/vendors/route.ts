import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { normalizeVendor } from "@/lib/analysis/vendor";

// GET /api/vendors?status= — the user's Vendor rows (optionally filtered by
// status) with a posted-transaction count each (the FR2 review-queue data).
export async function GET(req: Request) {
  const g = await gate({ verified: true, subscribed: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  const status = new URL(req.url).searchParams.get("status");
  const vendors = await prisma.vendor.findMany({
    where: { userId, ...(status ? { status } : {}) },
    orderBy: { name: "asc" },
  });

  // Vendor identity has no FK on transactions, so tally posted txns by the same
  // normalized name the analyzer uses. Posted-only, matching analysis scope (FR3).
  const posted = await prisma.plaidTransaction.findMany({
    where: { pending: false, account: { item: { userId } } },
    select: { merchantName: true, name: true },
  });
  const counts = new Map<string, number>();
  for (const t of posted) {
    const v = normalizeVendor(t.merchantName, t.name);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  return NextResponse.json({
    vendors: vendors.map((v) => ({
      id: v.id, name: v.name, status: v.status, decidedAt: v.decidedAt,
      txnCount: counts.get(v.name) ?? 0,
    })),
  });
}
