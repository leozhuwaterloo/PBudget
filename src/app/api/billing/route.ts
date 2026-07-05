import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { billingSummary } from "@/lib/stripe";

export const dynamic = "force-dynamic";

// F11 billing summary the Customizations billing section reads: current tier,
// live connection usage (PlaidItem count vs limit), and the static tier table.
export async function GET() {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  return NextResponse.json(await billingSummary(g.user!));
}
