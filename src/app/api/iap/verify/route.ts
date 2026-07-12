import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { iapEnabled, grantFromAppleJws, grantFromGooglePurchase } from "@/lib/iap";

// Self-hosted receipt validation for a native store purchase. The client hands us
// { platform, productId, token } where token is the StoreKit signed-transaction JWS
// (iOS) or the Play purchase token (Android). We verify it SERVER-SIDE (never trust
// the client's claimed plan) and set the tier through the same setUserTier() the
// Stripe webhook uses. Dormant (503) until product ids are configured.
export async function POST(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  if (!iapEnabled()) return NextResponse.json({ error: "IAP not configured" }, { status: 503 });

  const { platform, productId, token } = await req.json().catch(() => ({}));
  if ((platform !== "ios" && platform !== "android") || typeof token !== "string" || !token) {
    return NextResponse.json({ error: "platform and token are required" }, { status: 400 });
  }

  try {
    const plan =
      platform === "ios"
        ? await grantFromAppleJws(g.user!.id, token)
        : await grantFromGooglePurchase(g.user!.id, String(productId), token);
    return NextResponse.json({ ok: true, plan });
  } catch (e: any) {
    // Verification failure = untrusted receipt. Flat 402; don't leak which check failed.
    return NextResponse.json({ ok: false, error: e?.message ?? "verification failed" }, { status: 402 });
  }
}
