import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import { normalizeEmail } from "@/lib/validate";
import { loginAllowed, clientIp } from "@/lib/rateLimit";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 400 });
  }

  // Cap attempts so bcrypt can't be brute-forced: 10 per 15 min per email + IP,
  // DB-backed so it holds across pods. Checked before the bcrypt compare below.
  const ip = clientIp(req);
  const dims = [`login:email:${email}`, ...(ip ? [`login:ip:${ip}`] : [])];
  if (!(await loginAllowed(dims))) {
    return NextResponse.json(
      { error: "Too many attempts — please wait a few minutes and try again" },
      { status: 429 },
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
