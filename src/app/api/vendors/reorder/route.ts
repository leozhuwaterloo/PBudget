import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { VendorError, reorderVendors } from "@/lib/vendors";

export const dynamic = "force-dynamic";

// POST /api/vendors/reorder — body { order: [vendorId, ...] } (index 0 = highest
// priority). Reassigns the unique per-user priorities, then rematches so the new
// match order flips any conflict winners live (F3, FR1).
export async function POST(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const body = await req.json().catch(() => null);
  try {
    await reorderVendors(g.user!.id, (body as { order?: unknown })?.order);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof VendorError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
