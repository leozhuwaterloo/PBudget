import { NextRequest, NextResponse } from "next/server";
import {
  findOrCreateOAuthUser,
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth";
import { normalizeEmail } from "@/lib/validate";
import { SITE_URL } from "@/lib/site";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const cookieState = request.cookies.get("g_oauth_state")?.value;

  const fail = () => {
    const r = NextResponse.redirect(`${SITE_URL}/login?error=google`);
    r.cookies.set("g_oauth_state", "", { path: "/", maxAge: 0 });
    return r;
  };

  // CSRF: the state we set must round-trip back unchanged.
  if (!code || !state || !cookieState || state !== cookieState) return fail();

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail();

  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${SITE_URL}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return fail();
    const { id_token } = (await tokenRes.json()) as { id_token?: string };
    if (!id_token) return fail();

    // The id_token came straight from Google's token endpoint over TLS, so its
    // payload is trustworthy without re-verifying the JWT signature.
    const payload = JSON.parse(Buffer.from(id_token.split(".")[1], "base64url").toString()) as {
      email?: string;
      email_verified?: boolean | string;
    };
    const email = normalizeEmail(payload.email);
    if (!email || (payload.email_verified !== true && payload.email_verified !== "true")) {
      return fail();
    }

    const user = await findOrCreateOAuthUser(email);
    const { token, expiresAt } = await createSessionToken(user.id);
    const res = NextResponse.redirect(`${SITE_URL}/dashboard`);
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    res.cookies.set("g_oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  } catch {
    return fail();
  }
}
