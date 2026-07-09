import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { effectiveTransactions } from "@/lib/analysis/effective";

export const dynamic = "force-dynamic";

const monthKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

// GET /api/dashboard/vendor?month=YYYY-MM&key=<vendorId|vendorName> — the effective
// transactions behind one Top-vendors row. Same read model AND excludeFromTotals
// exclusion as the dashboard's vendor aggregate (keyed by matched vendorId, else
// the normalized vendor name), so the list sums to that vendor's spend. Largest
// outflow first.
export async function GET(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? "";
  const key = url.searchParams.get("key") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month) || !key) {
    return NextResponse.json({ error: "month and key required" }, { status: 400 });
  }

  const [effective, excludedCats] = await Promise.all([
    effectiveTransactions(userId),
    prisma.transactionCategory.findMany({ where: { userId, excludeFromTotals: true }, select: { name: true } }),
  ]);
  const excluded = new Set(excludedCats.map((c) => c.name));

  const transactions = effective
    .filter(
      (e) =>
        (e.vendorId ?? e.vendorName) === key &&
        monthKey(e.date) === month &&
        !(e.categoryName != null && excluded.has(e.categoryName))
    )
    .map((e) => ({
      id: e.id,
      // Whole-txn id to hang a category override on; null for a merge group or a
      // split part (not a single overridable PlaidTransaction).
      txnId: !e.isGroup && e.parentId == null ? e.id : null,
      title: e.title,
      categoryName: e.categoryName,
      vendorName: e.vendorName,
      vendorLink: e.vendorLink,
      vendorIcon: e.vendorIcon,
      date: e.date.toISOString(),
      amount: e.amount,
      currency: e.currency,
    }))
    .sort((a, b) => b.amount - a.amount);

  return NextResponse.json({ transactions });
}
