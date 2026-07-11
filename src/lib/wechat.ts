import crypto from "crypto";
import type { User } from "@prisma/client";
import { prisma } from "./db";
import { seedNewUserVendors } from "./catalog/instantiate";

// WeChat Open Platform QR-scan web login (server-side OAuth2, scope snsapi_login).
// DORMANT until both secrets are set — routes 404 and the UI button is hidden.
// Secrets stay server-only; nothing here is imported by a client component.
const APPID = process.env.WECHAT_APPID;
const APPSECRET = process.env.WECHAT_APPSECRET;
export const wechatEnabled = !!(APPID && APPSECRET);

// Must match the redirect_uri registered in the WeChat console exactly. Built from
// APP_URL (same convention as stripe.ts / email.ts) → in prod = pbudget.ppvnx.com.
const CALLBACK = `${process.env.APP_URL || "http://localhost:5300"}/api/auth/wechat/callback`;

// qrconnect authorize URL. #wechat_redirect MUST be the final fragment.
export function authorizeUrl(state: string): string {
  const q = new URLSearchParams({
    appid: APPID!,
    redirect_uri: CALLBACK,
    response_type: "code",
    scope: "snsapi_login",
    state,
  });
  return `https://open.weixin.qq.com/connect/qrconnect?${q.toString()}#wechat_redirect`;
}

type TokenResp = {
  access_token?: string;
  openid?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
};

// Exchange the callback `code` for an access token + openid/unionid. WeChat's
// sns/oauth2/access_token takes no redirect_uri. Returns errcode on failure.
export async function exchangeCode(code: string): Promise<TokenResp> {
  const q = new URLSearchParams({
    appid: APPID!,
    secret: APPSECRET!,
    code,
    grant_type: "authorization_code",
  });
  const res = await fetch(`https://api.weixin.qq.com/sns/oauth2/access_token?${q.toString()}`);
  return res.json() as Promise<TokenResp>;
}

// Find-or-create by unionid (fallback openid). New accounts carry no real email:
// a placeholder wechat_<id>@wechat.local satisfies the NOT-NULL @unique column
// (never shown/emailed), an unusable passwordHash (random hex — bcrypt.compare can
// never match), and emailVerified set. Mirrors the signup route's vendor seed.
export async function findOrCreateWechatUser(
  unionid: string | undefined,
  openid: string,
): Promise<User> {
  // findFirst (not findUnique): wechatUnionId can't carry a DB unique constraint —
  // adding one would make deploy's `prisma db push` refuse (data-loss guard).
  // Uniqueness holds because this is the only path that writes these ids.
  const existing =
    (unionid ? await prisma.user.findFirst({ where: { wechatUnionId: unionid } }) : null) ??
    (await prisma.user.findFirst({ where: { wechatOpenId: openid } }));
  if (existing) return existing;

  const key = unionid ?? openid;
  const user = await prisma.user.create({
    data: {
      email: `wechat_${key}@wechat.local`,
      passwordHash: crypto.randomBytes(32).toString("hex"),
      emailVerified: new Date(),
      wechatUnionId: unionid ?? null,
      wechatOpenId: openid,
    },
  });
  await seedNewUserVendors(user.id); // default categories + catch-all vendors, as signup does
  return user;
}
