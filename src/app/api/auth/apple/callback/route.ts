import { NextRequest, NextResponse } from "next/server";
import {
  findOrCreateOAuthUser,
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth";
import { appleClientSecret, appleConfigured } from "@/lib/apple";
import { normalizeEmail } from "@/lib/validate";
import { SITE_URL } from "@/lib/site";

const TOKEN_URL = "https://appleid.apple.com/auth/token";

// Apple uses response_mode=form_post (we request the email scope), so the callback
// is a POST with a form body — unlike Google's GET callback.
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const code = form.get("code")?.toString();
  const state = form.get("state")?.toString();
  const cookieState = request.cookies.get("a_oauth_state")?.value;

  // 303 so the browser follows with a GET (this handler was reached via POST).
  const fail = () => {
    const r = NextResponse.redirect(`${SITE_URL}/login?error=apple`, 303);
    r.cookies.set("a_oauth_state", "", { path: "/", maxAge: 0 });
    return r;
  };

  // CSRF: the state we set must round-trip back unchanged.
  if (!code || !state || !cookieState || state !== cookieState || !appleConfigured()) return fail();

  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.APPLE_SERVICES_ID!,
        client_secret: appleClientSecret(),
        code,
        grant_type: "authorization_code",
        redirect_uri: `${SITE_URL}/api/auth/apple/callback`,
      }),
    });
    if (!tokenRes.ok) return fail();
    const { id_token } = (await tokenRes.json()) as { id_token?: string };
    if (!id_token) return fail();

    // The id_token came straight from Apple's token endpoint over TLS, so its
    // payload is trustworthy without re-verifying the JWT signature.
    const payload = JSON.parse(Buffer.from(id_token.split(".")[1], "base64url").toString()) as {
      email?: string;
      email_verified?: boolean | string;
    };
    // Apple emails are always Apple-owned (real or @privaterelay.appleid.com) and
    // come back verified; require it, same as Google.
    const email = normalizeEmail(payload.email);
    if (!email || (payload.email_verified !== true && payload.email_verified !== "true")) {
      return fail();
    }

    const user = await findOrCreateOAuthUser(email);
    const { token, expiresAt } = await createSessionToken(user.id);
    const res = NextResponse.redirect(`${SITE_URL}/dashboard`, 303);
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    res.cookies.set("a_oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  } catch {
    return fail();
  }
}
