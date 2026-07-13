import { NextResponse } from "next/server";
import { gate, isDemo, demoBlocked } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { exchangePublicToken, syncItem } from "@/lib/plaid";
import { entitledConnections, countConnections, upgradeCTA } from "@/lib/stripe";

// Exchange a Plaid Link public_token for an access token, then sync the item.
export async function POST(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  if (isDemo(g.user!)) return demoBlocked();
  const { public_token } = await req.json().catch(() => ({}));
  if (!public_token) return NextResponse.json({ error: "Missing public_token" }, { status: 400 });

  try {
    const { accessToken, itemId } = await exchangePublicToken(public_token);
    // Gate only NEW connections: re-linking an existing item (update mode) upserts
    // the same itemId and is always allowed. A new item at/over the limit is 402'd
    // before syncItem creates it.
    const existing = await prisma.plaidItem.findUnique({ where: { itemId } });
    if (!existing) {
      const used = await countConnections(g.user!.id);
      if (used >= entitledConnections(g.user!)) {
        return NextResponse.json(upgradeCTA(g.user!.plan, used), { status: 402 });
      }
    }
    const result = await syncItem(g.user!.id, accessToken);
    return NextResponse.json({ result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Plaid error" }, { status: 500 });
  }
}
