import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createUpdateLinkToken } from "@/lib/plaid";

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
    const link_token = await createUpdateLinkToken(g.user!.id, decrypt(item.accessToken));
    return NextResponse.json({ link_token });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Plaid error" }, { status: 500 });
  }
}
