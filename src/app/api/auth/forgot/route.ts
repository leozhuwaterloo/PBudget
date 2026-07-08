import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createPasswordResetToken } from "@/lib/auth";
import { normalizeEmail } from "@/lib/validate";
import { sendPasswordResetEmail } from "@/lib/email";
import { emailRateLimited, emailDims, clientIp } from "@/lib/rateLimit";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  // Always return ok — never reveal whether an email is registered. A rate-limited
  // send is silently skipped (same as a non-existent email) so it leaks nothing.
  if (email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !(await emailRateLimited(emailDims(email, clientIp(req))))) {
      const token = await createPasswordResetToken(user.id);
      await sendPasswordResetEmail(email, token);
    }
  }
  return NextResponse.json({ ok: true });
}
