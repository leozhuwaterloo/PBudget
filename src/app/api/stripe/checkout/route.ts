import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { createCheckoutSession, type Tier } from "@/lib/stripe";

export async function POST(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const { tier } = await req.json().catch(() => ({}));
  if (tier !== "pro" && tier !== "max") {
    return NextResponse.json({ error: "tier must be 'pro' or 'max'" }, { status: 400 });
  }
  try {
    const url = await createCheckoutSession(g.user!, tier as Tier);
    return NextResponse.json({ url });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Stripe error" }, { status: 500 });
  }
}
