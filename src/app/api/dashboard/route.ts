import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { dashboardData } from "@/lib/dashboard";

// GET /api/dashboard?month=YYYY-MM — the graphs-only Dashboard aggregate (FR7).
// The trend and review widgets are fixed windows; `month` drives budget + vendors.
export async function GET(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const month = new URL(req.url).searchParams.get("month") ?? undefined;
  return NextResponse.json(await dashboardData(g.user!.id, month));
}
