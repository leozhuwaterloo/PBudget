import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { effectiveTransactions } from "@/lib/analysis/effective";

export const dynamic = "force-dynamic";

const monthKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

// GET /api/dashboard/category?month=YYYY-MM&name=<category> — the effective
// transactions behind one Budget-vs-actual row (same read model as the dashboard
// "actual", so the list sums to that number). Largest outflow first.
export async function GET(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;

  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? "";
  const name = url.searchParams.get("name") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month) || !name) {
    return NextResponse.json({ error: "month and name required" }, { status: 400 });
  }

  const [effective, cats] = await Promise.all([
    effectiveTransactions(g.user!.id),
    prisma.transactionCategory.findMany({ where: { userId: g.user!.id }, select: { name: true, parentName: true } }),
  ]);
  // A parent row rolls up its children on the dashboard, so its drill-in must too —
  // list own + children txns so they sum to the rolled-up "actual".
  const children = new Set(cats.filter((c) => c.parentName === name).map((c) => c.name));
  const inRow = (c: string | null) => c === name || (c != null && children.has(c));
  const transactions = effective
    .filter((e) => inRow(e.categoryName) && monthKey(e.date) === month)
    .map((e) => ({
      id: e.id,
      categoryName: e.categoryName, // own category (a parent's list spans its children)
      // The whole-transaction id to hang a category override on (PATCH
      // /api/transactions/[id]). Only plain txns qualify — a merge group or a
      // split part isn't a single overridable PlaidTransaction, so null there.
      txnId: !e.isGroup && e.parentId == null ? e.id : null,
      title: e.title,
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
