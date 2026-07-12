import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { SITE_URL } from "@/lib/site";

// OAuth config is Vault-injected at runtime; never prerender the build-time (dormant) state.
export const dynamic = "force-dynamic";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";

// Start Google OAuth. Dormant until GOOGLE_CLIENT_ID is set (the button is hidden
// too) — unconfigured, it just bounces back to /login. Web-only: the button is
// hidden in the native app because Google blocks OAuth in embedded webviews.
export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(`${SITE_URL}/login`);

  const state = randomBytes(16).toString("hex");
  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${SITE_URL}/api/auth/google/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(url.toString());
  res.cookies.set("g_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
