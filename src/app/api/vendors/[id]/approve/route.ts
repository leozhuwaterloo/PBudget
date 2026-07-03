import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { approveVendor } from "@/lib/analysis/vendors";

// POST /api/vendors/[id]/approve — approve, clear its open unknown_vendor flags,
// re-run the unusual-amount rule over its charges (FR2, FR1.3, criterion 19).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const g = await gate({ verified: true, subscribed: true });
  if (g.error) return g.error;

  const vendor = await approveVendor(g.user!.id, params.id);
  if (!vendor) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ vendor });
}
