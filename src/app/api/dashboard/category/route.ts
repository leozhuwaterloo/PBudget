import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
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

  const effective = await effectiveTransactions(g.user!.id);
  const transactions = effective
    .filter((e) => e.categoryName === name && monthKey(e.date) === month)
    .map((e) => ({
      id: e.id,
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
