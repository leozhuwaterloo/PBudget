import { NextResponse } from "next/server";
import { getSessionUser, createVerificationToken } from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/email";
import { emailRateLimited, emailDims, clientIp } from "@/lib/rateLimit";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.emailVerified) return NextResponse.json({ ok: true, alreadyVerified: true });
  if (await emailRateLimited(emailDims(user.email, clientIp(req)))) {
    return NextResponse.json({ error: "Please wait a minute before requesting another email" }, { status: 429 });
  }
  const token = await createVerificationToken(user.id);
  await sendVerificationEmail(user.email, token);
  return NextResponse.json({ ok: true });
}
