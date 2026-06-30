import { NextResponse } from "next/server";
import { getSessionUser, createVerificationToken } from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/email";

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.emailVerified) return NextResponse.json({ ok: true, alreadyVerified: true });
  const token = await createVerificationToken(user.id);
  await sendVerificationEmail(user.email, token);
  return NextResponse.json({ ok: true });
}
