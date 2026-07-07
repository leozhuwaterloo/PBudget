import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { analyzeUser } from "@/lib/analysis/analyze";

export const dynamic = "force-dynamic";

// POST /api/review/analyze — run the full analyzer (auto-match → vendor re-match →
// suspicion rules) on demand, without needing a Plaid sync. This is what sync runs
// after fetching; surfaced as the "Analysis" button on Review so config/data changes
// (e.g. a widened auto-merge rule) take effect immediately. Returns fresh counts.
export async function POST() {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  await analyzeUser(userId);

  const [pendingGroups, openFlags] = await Promise.all([
    prisma.mergeGroup.count({ where: { userId, status: "auto" } }),
    prisma.transactionFlag.count({ where: { userId, status: "open" } }),
  ]);
  return NextResponse.json({ pendingGroups, openFlags });
}
