import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { User } from "@prisma/client";
import { prisma } from "./db";

const COOKIE = "pb_session";
// Exported for the OAuth callbacks, which set the session cookie on their own
// NextResponse (a redirect) rather than via next/headers cookies().
export const SESSION_COOKIE = COOKIE;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const VERIFY_TTL_MS = 1000 * 60 * 30; // 30 minutes — email OTP codes are short-lived
const VERIFY_MAX_ATTEMPTS = 5; // wrong-code tries before a code is invalidated
const RESET_TTL_MS = 1000 * 60 * 60; // 1 hour — password reset links are short-lived

const hashCode = (code: string) => crypto.createHash("sha256").update(code).digest("hex");

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

// Cookie attributes for the session token — shared by createSession (next/headers)
// and the OAuth callbacks (which set it on a NextResponse redirect).
export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}

// Mint a DB-backed session row and return its token + expiry, WITHOUT touching
// cookies. For OAuth callbacks that must attach the cookie to a specific
// NextResponse (a redirect) — next/headers cookies() mutations don't reliably
// ride a returned redirect response. Same session scheme as createSession.
export async function createSessionToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { token, userId, expiresAt } });
  return { token, expiresAt };
}

// Sets the session cookie. Call only from Route Handlers / Server Actions.
export async function createSession(userId: string): Promise<void> {
  const { token, expiresAt } = await createSessionToken(userId);
  cookies().set(COOKIE, token, sessionCookieOptions(expiresAt));
}

// Find-or-create a user from an OAuth-verified email (Google/Apple). An existing
// account — password or prior OAuth — is simply logged in: linking by verified
// email is safe because the provider proved ownership. A new account gets a
// random, unusable passwordHash (bcrypt.compare can never match 64 hex chars, so
// password login is impossible) and is marked verified (the provider vouched for
// the address). Reuses the existing email/passwordHash/emailVerified columns —
// no schema migration.
export async function findOrCreateOAuthUser(email: string): Promise<User> {
  const e = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: e } });
  if (existing) {
    if (existing.emailVerified) return existing;
    // The account existed but was never email-verified, so its password was chosen by
    // whoever registered the address first -- NOT proven to be this provider-verified
    // owner. Discard that password (unusable random hash) as we mark it verified, so a
    // pre-registration attacker cannot retain access. The real owner can set a new
    // password via reset (they now control the verified inbox).
    return prisma.user.update({
      where: { id: existing.id },
      data: { emailVerified: new Date(), passwordHash: crypto.randomBytes(32).toString("hex") },
    });
  }
  return prisma.user.create({
    data: { email: e, passwordHash: crypto.randomBytes(32).toString("hex"), emailVerified: new Date() },
  });
}

export async function destroySession(): Promise<void> {
  const token = cookies().get(COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { token } });
  cookies().delete(COOKIE);
}

export async function getSessionUser(): Promise<User | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { token }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.deleteMany({ where: { token } });
    return null;
  }
  return session.user;
}

// For server components/pages: redirect unauthenticated users to /login.
export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

// Issue a fresh 6-digit email OTP for the user and return the PLAINTEXT code (the
// caller emails it). Only the hash is persisted. One active code per user: any
// prior code is deleted first.
export async function createVerificationToken(userId: string): Promise<string> {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.emailOtp.deleteMany({ where: { userId } });
  await prisma.emailOtp.create({
    data: { userId, codeHash: hashCode(code), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) },
  });
  return code;
}

export type VerifyResult = "ok" | "invalid" | "no_code";

// Verify a submitted OTP for the logged-in user.
//  - no active code (none / expired / 5 tries used up) → "no_code" (request a new one)
//  - wrong code → increment attempts, "invalid"
//  - correct code → mark emailVerified, consume the code, "ok"
export async function verifyEmailCode(userId: string, code: string): Promise<VerifyResult> {
  const now = new Date();
  const row = await prisma.emailOtp.findFirst({
    where: { userId, expiresAt: { gt: now }, attempts: { lt: VERIFY_MAX_ATTEMPTS } },
  });
  if (!row) return "no_code";
  if (hashCode(code) !== row.codeHash) {
    await prisma.emailOtp.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
    });
    return "invalid";
  }
  await prisma.user.update({ where: { id: userId }, data: { emailVerified: now } });
  await prisma.emailOtp.deleteMany({ where: { userId } });
  return "ok";
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: { token, userId, expiresAt: new Date(Date.now() + RESET_TTL_MS) },
  });
  return token;
}
