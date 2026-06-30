import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { createPortalSession } from "@/lib/stripe";

export async function POST() {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  try {
    const url = await createPortalSession(g.user!);
    return NextResponse.json({ url });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Stripe error" }, { status: 500 });
  }
}
