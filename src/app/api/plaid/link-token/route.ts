import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { createLinkToken } from "@/lib/plaid";

export async function POST() {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  try {
    const link_token = await createLinkToken(g.user!.id);
    return NextResponse.json({ link_token });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Plaid error" }, { status: 500 });
  }
}
