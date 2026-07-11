import { NextResponse } from "next/server";
import { getSessionUser, verifyEmailCode } from "@/lib/auth";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.emailVerified) return NextResponse.json({ ok: true, alreadyVerified: true });

  const body = await req.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the 6-digit code" }, { status: 400 });
  }

  const result = await verifyEmailCode(user.id, code);
  if (result === "ok") return NextResponse.json({ ok: true });
  if (result === "no_code") {
    return NextResponse.json(
      { error: "That code expired or was tried too many times — request a new one" },
      { status: 400 },
    );
  }
  return NextResponse.json({ error: "Incorrect code" }, { status: 400 });
}
