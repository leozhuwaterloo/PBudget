import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { appleConfigured } from "@/lib/apple";
import { SITE_URL } from "@/lib/site";

// OAuth config is Vault-injected at runtime; never prerender the build-time (dormant) state.
export const dynamic = "force-dynamic";

const APPLE_AUTH = "https://appleid.apple.com/auth/authorize";

// Start Sign in with Apple. Dormant until the APPLE_* env vars are set (the button
// is hidden too) — unconfigured, it just bounces back to /login. Web-only: the
// button is hidden in the native app (same gate as Google).
export async function GET() {
  if (!appleConfigured()) return NextResponse.redirect(`${SITE_URL}/login`);

  const state = randomBytes(16).toString("hex");
  const url = new URL(APPLE_AUTH);
  url.searchParams.set("client_id", process.env.APPLE_SERVICES_ID!);
  url.searchParams.set("redirect_uri", `${SITE_URL}/api/auth/apple/callback`);
  url.searchParams.set("response_type", "code");
  // Requesting the email scope makes Apple POST the result back (form_post).
  url.searchParams.set("response_mode", "form_post");
  url.searchParams.set("scope", "email");
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString());
  // form_post posts back cross-site, so the CSRF state cookie must be SameSite=None
  // (a Lax cookie is NOT sent on a cross-site POST navigation). None requires Secure.
  res.cookies.set("a_oauth_state", state, {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    path: "/",
    maxAge: 600,
  });
  return res;
}
