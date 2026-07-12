import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { billingSummary } from "@/lib/stripe";
import { iapBillingConfig } from "@/lib/iap";

export const dynamic = "force-dynamic";

// F11 billing summary the Customizations billing section reads: current tier,
// live connection usage (PlaidItem count vs limit), and the static tier table.
// `iap` carries the native store-purchase config (dormant/enabled + product ids +
// web-billing URL for the geo-gated "save on web" link); web ignores it.
export async function GET() {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  return NextResponse.json({ ...(await billingSummary(g.user!)), iap: iapBillingConfig() });
}
