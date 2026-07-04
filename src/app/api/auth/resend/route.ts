import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, createVerificationToken, emailThrottled } from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/email";

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.emailVerified) return NextResponse.json({ ok: true, alreadyVerified: true });
  const last = await prisma.emailVerificationToken.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  if (emailThrottled(last?.createdAt)) {
    return NextResponse.json({ error: "Please wait a minute before requesting another email" }, { status: 429 });
  }
  const token = await createVerificationToken(user.id);
  await sendVerificationEmail(user.email, token);
  return NextResponse.json({ ok: true });
}
