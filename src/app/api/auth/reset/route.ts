import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { validatePassword } from "@/lib/validate";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : "";
  const password = validatePassword(body.password);
  if (!password) {
    return NextResponse.json({ error: "Password must be 8–200 characters" }, { status: 400 });
  }

  const row = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!row || row.expiresAt < new Date()) {
    return NextResponse.json({ error: "Reset link is invalid or expired" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: row.userId },
    data: { passwordHash: await hashPassword(password) },
  });
  // Single-use token + kill every existing session: a password change logs out
  // all devices, so a leaked/old session can't survive the reset.
  await prisma.passwordResetToken.deleteMany({ where: { userId: row.userId } });
  await prisma.session.deleteMany({ where: { userId: row.userId } });
  return NextResponse.json({ ok: true });
}
