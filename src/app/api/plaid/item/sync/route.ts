import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { refreshAndSync } from "@/lib/plaid";
import { canSyncItem, upgradeCTA } from "@/lib/stripe";
import { analyzeUser } from "@/lib/analysis/analyze";

export async function POST(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const { item_id } = await req.json().catch(() => ({}));
  if (!item_id) return NextResponse.json({ error: "Missing item_id" }, { status: 400 });

  const item = await prisma.plaidItem.findUnique({ where: { itemId: item_id } });
  if (!item || item.userId !== g.user!.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // FR10: after a downgrade the oldest `limit` connections keep syncing; excess
  // items are read-only until upgrade or disconnect.
  const sync = await canSyncItem(g.user!, item.itemId);
  if (!sync.ok) {
    return NextResponse.json(upgradeCTA(g.user!.plan, sync.used), { status: 402 });
  }
  try {
    const result = await refreshAndSync(
      g.user!.id,
      item.itemId,
      decrypt(item.accessToken),
      item.lastForceRefreshed
    );
    // FR1: analyze the user's history after the upserts. First run analyzes all
    // existing history — nothing is grandfathered.
    await analyzeUser(g.user!.id);
    return NextResponse.json({ result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Plaid error" }, { status: 500 });
  }
}
