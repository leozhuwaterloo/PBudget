import { NextResponse } from "next/server";
import { gate, isDemo, demoBlocked } from "@/lib/guard";
import { createLinkToken } from "@/lib/plaid";
import { canAddConnection, upgradeCTA } from "@/lib/stripe";

export async function POST() {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  if (isDemo(g.user!)) return demoBlocked();
  const add = await canAddConnection(g.user!);
  if (!add.ok) {
    return NextResponse.json(upgradeCTA(g.user!.plan, add.used), { status: 402 });
  }
  try {
    const link_token = await createLinkToken(g.user!.id);
    return NextResponse.json({ link_token });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Plaid error" }, { status: 500 });
  }
}
