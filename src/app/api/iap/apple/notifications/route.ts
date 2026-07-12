import { NextResponse } from "next/server";
import { applyAppleNotification } from "@/lib/iap";

// App Store Server Notifications V2 — Apple POSTs { signedPayload } (a JWS) on every
// renewal / cancel / refund / expiry. We verify its signature against the pinned
// Apple root (lib/iap) and update the buyer's tier. No shared secret needed; the JWS
// IS the authentication. A 200 tells Apple to stop retrying.
export async function POST(req: Request) {
  const { signedPayload } = await req.json().catch(() => ({}));
  if (typeof signedPayload !== "string" || !signedPayload) {
    return NextResponse.json({ error: "signedPayload required" }, { status: 400 });
  }
  try {
    await applyAppleNotification(signedPayload);
    return NextResponse.json({ ok: true });
  } catch {
    // Bad signature / forged payload — refuse (don't 200 a forgery).
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
