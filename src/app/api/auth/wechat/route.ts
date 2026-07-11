import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { wechatEnabled, authorizeUrl } from "@/lib/wechat";

// Initiate: 404 when dormant. Else mint a state nonce, stash it in a short-lived
// httpOnly cookie (CSRF check on the callback), and 302 to the qrconnect page.
export async function GET() {
  if (!wechatEnabled) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const state = crypto.randomBytes(16).toString("hex");
  cookies().set("wx_state", state, {
    httpOnly: true,
    sameSite: "lax", // Lax so the top-level redirect back from WeChat still sends it
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 minutes
  });
  return NextResponse.redirect(authorizeUrl(state), 302);
}
