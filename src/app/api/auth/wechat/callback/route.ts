import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { wechatEnabled, exchangeCode, findOrCreateWechatUser } from "@/lib/wechat";
import { createSession } from "@/lib/auth";

const APP = process.env.APP_URL || "http://localhost:5300";

// Callback: verify state == wx_state cookie (single-use, cleared either way),
// exchange the code, find-or-create the user by unionid/openid, open a session.
export async function GET(req: NextRequest) {
  if (!wechatEnabled) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = cookies().get("wx_state")?.value;
  cookies().delete("wx_state"); // single-use, regardless of outcome

  const fail = () => NextResponse.redirect(new URL("/login?error=wechat", APP), 302);

  if (!code || !state || !cookieState || state !== cookieState) return fail();

  const tok = await exchangeCode(code);
  if (tok.errcode || !tok.openid) return fail();

  const user = await findOrCreateWechatUser(tok.unionid, tok.openid);
  await createSession(user.id); // sets pb_session; merges into the redirect response
  return NextResponse.redirect(new URL("/dashboard", APP), 302);
}
