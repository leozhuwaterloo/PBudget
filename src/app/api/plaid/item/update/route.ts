import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { exchangePublicToken, syncItem } from "@/lib/plaid";
import { reconcileQuantity } from "@/lib/stripe";

// Exchange a Plaid Link public_token for an access token, then sync the item.
export async function POST(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const { public_token } = await req.json().catch(() => ({}));
  if (!public_token) return NextResponse.json({ error: "Missing public_token" }, { status: 400 });

  try {
    const { accessToken } = await exchangePublicToken(public_token);
    const result = await syncItem(g.user!.id, accessToken);
    await reconcileQuantity(g.user!.id);
    return NextResponse.json({ result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Plaid error" }, { status: 500 });
  }
}
