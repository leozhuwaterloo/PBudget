import { NextRequest, NextResponse } from "next/server";
import {
  findOrCreateOAuthUser,
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth";
import { verifyNativeIdToken, type NativeProvider } from "@/lib/native_auth";

// Native (in-app) Google / Apple sign-in. The @capgo/capacitor-social-login plugin
// performs the OAuth on-device and hands the resulting id_token to the webview JS,
// which POSTs it here. We verify the token's signature + audience (see lib/native_auth
// — the token is client-supplied and untrusted), then mint the same session cookie
// the web callbacks use. Web keeps its redirect flow; this route is app-only.
export async function POST(request: NextRequest) {
  let body: { provider?: string; idToken?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const { provider, idToken } = body;
  if ((provider !== "google" && provider !== "apple") || !idToken) {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  try {
    const email = await verifyNativeIdToken(provider as NativeProvider, idToken);
    const user = await findOrCreateOAuthUser(email);
    const { token, expiresAt } = await createSessionToken(user.id);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return res;
  } catch {
    // Any signature/claim/email failure → a flat 401. Don't leak which check failed.
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 401 });
  }
}
