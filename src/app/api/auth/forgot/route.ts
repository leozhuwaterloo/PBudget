import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createPasswordResetToken, emailThrottled } from "@/lib/auth";
import { normalizeEmail } from "@/lib/validate";
import { sendPasswordResetEmail } from "@/lib/email";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  // Always return ok — never reveal whether an email is registered.
  if (email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const last = await prisma.passwordResetToken.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
      if (!emailThrottled(last?.createdAt)) {
        const token = await createPasswordResetToken(user.id);
        await sendPasswordResetEmail(email, token);
      }
    }
  }
  return NextResponse.json({ ok: true });
}
