import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { rejectVendor } from "@/lib/analysis/vendors";

// POST /api/vendors/[id]/reject — mark rejected. Existing flags stay open
// (dismissed per-transaction per FR4); future txns keep getting flagged (FR2).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const g = await gate({ verified: true, subscribed: true });
  if (g.error) return g.error;

  const vendor = await rejectVendor(g.user!.id, params.id);
  if (!vendor) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ vendor });
}
