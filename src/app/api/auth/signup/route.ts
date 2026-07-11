import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, createSession, createVerificationToken } from "@/lib/auth";
import { normalizeEmail, validatePassword } from "@/lib/validate";
import { sendVerificationEmail } from "@/lib/email";
import { emailRateLimited, emailDims, clientIp } from "@/lib/rateLimit";
import { seedNewUserVendors } from "@/lib/catalog/instantiate";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const password = validatePassword(body.password);
  if (!email) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  if (!password) {
    return NextResponse.json({ error: "Password must be 8–200 characters" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return NextResponse.json({ error: "That email is already registered" }, { status: 409 });

  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword(password) },
  });
  await seedNewUserVendors(user.id); // seeds default categories + the 3 catch-all vendors
  const code = await createVerificationToken(user.id);
  // Cap verification sends per IP + recipient; if limited, skip the send (the user
  // can request it later via /resend, which is capped the same way).
  if (!(await emailRateLimited(emailDims(email, clientIp(req)))))
    await sendVerificationEmail(email, code);
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
