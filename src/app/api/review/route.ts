import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { reviewData } from "@/lib/review";

export const dynamic = "force-dynamic";

// GET /api/review — the whole Review hub payload (F12, FR6) in one shot, so the
// client can refetch after each action and watch the queues shrink live. The
// assembly lives in src/lib/review.ts (unit-tested by scripts/check-review.ts);
// this route is just the auth gate. Mutations reuse the existing routes (flags
// dismiss, merge confirm/dissolve/create, vendors, catalog, splits DELETE).
export async function GET() {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  return NextResponse.json(await reviewData(g.user!.id));
}
