import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { refreshAndSync } from "@/lib/plaid";
import { reconcileQuantity } from "@/lib/stripe";
import { analyzeUser } from "@/lib/analysis/analyze";

export async function POST(req: Request) {
  const g = await gate({ verified: true, subscribed: true });
  if (g.error) return g.error;
  const { item_id } = await req.json().catch(() => ({}));
  if (!item_id) return NextResponse.json({ error: "Missing item_id" }, { status: 400 });

  const item = await prisma.plaidItem.findUnique({ where: { itemId: item_id } });
  if (!item || item.userId !== g.user!.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const result = await refreshAndSync(
      g.user!.id,
      item.itemId,
      decrypt(item.accessToken),
      item.lastForceRefreshed
    );
    await reconcileQuantity(g.user!.id);
    // FR1: analyze the user's history after the upserts. First run analyzes all
    // existing history — nothing is grandfathered.
    await analyzeUser(g.user!.id);
    return NextResponse.json({ result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Plaid error" }, { status: 500 });
  }
}
