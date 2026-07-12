import crypto from "crypto";
import { prisma } from "./db";

// Email send rate limiting: 1 email per minute per dimension (client IP + recipient
// address). The window is tracked in the DB (one row per dimension) — NOT in memory —
// so the cap holds across all pods; an in-memory counter would let each pod send
// independently. Rolling 60s window.
const WINDOW_MS = 60 * 1000;

// Hash the dimension so no raw IP/email lands in the table (the value is only ever
// compared for equality, never read back). 160-bit → collisions are irrelevant.
const hash = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

// Real client IP. Cloudflare's CF-Connecting-IP is edge-set and NOT client-spoofable,
// so trust it first; the leftmost X-Forwarded-For hop is client-supplied behind an
// appending proxy and only used as a fallback (direct/dev). null when absent — the
// caller then rate-limits on recipient/email only.
export function clientIp(req: Request): string | null {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim() || null;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || null;
  return req.headers.get("x-real-ip");
}

// Build the dimension list for a send: always the recipient, plus the IP when known.
// Prefixes keep the two namespaces distinct before hashing.
export function emailDims(to: string, ip: string | null): string[] {
  return [`to:${to}`, ...(ip ? [`ip:${ip}`] : [])];
}

// True → the send is rate-limited and MUST be skipped (some dimension sent within the
// window). False → it records "now" on every dimension and lets the send proceed.
//
// Read-then-write, not a single atomic statement: sequential abuse (the real threat —
// a script hammering resend) always sees the prior committed row and is blocked; a
// rare simultaneous burst across pods might leak one extra email, which is fine for an
// email throttle and not worth a DB-specific upsert-with-condition.
//
// ponytail: rows are bounded by distinct IPs + recipients, so growth is naturally
// small; add a periodic `deleteMany({ lastSentAt < now-1d })` sweep if it ever isn't.
export async function emailRateLimited(dims: string[]): Promise<boolean> {
  const keys = dims.map(hash);
  if (keys.length === 0) return false;
  const cutoff = new Date(Date.now() - WINDOW_MS);
  const recent = await prisma.emailRateLimit.count({
    where: { key: { in: keys }, lastSentAt: { gt: cutoff } },
  });
  if (recent > 0) return true;
  const now = new Date();
  await Promise.all(
    keys.map((key) =>
      prisma.emailRateLimit.upsert({ where: { key }, create: { key, lastSentAt: now }, update: { lastSentAt: now } })
    )
  );
  return false;
}

// ---- login attempt limiting -------------------------------------------------

// Fixed-window attempted-login counter, DB-backed (one row per dimension: client
// IP + email) so the cap holds across all pods. 10 attempts per 15 min; beyond
// that the caller returns 429. Read-then-write, same accepted race as
// emailRateLimited above — a rare cross-pod overlap leaks a couple of extra tries,
// nothing against a brute-force cap. `count` resets in place when the window
// rolls, so the table stays one row per active IP/email.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 10;

export async function loginAllowed(dims: string[]): Promise<boolean> {
  if (dims.length === 0) return true;
  const now = new Date();
  const cutoff = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const counts = await Promise.all(
    dims.map(hash).map(async (key) => {
      const row = await prisma.loginThrottle.findUnique({ where: { key } });
      if (!row || row.windowStart < cutoff) {
        await prisma.loginThrottle.upsert({
          where: { key },
          create: { key, count: 1, windowStart: now },
          update: { count: 1, windowStart: now },
        });
        return 1;
      }
      const updated = await prisma.loginThrottle.update({
        where: { key },
        data: { count: { increment: 1 } },
      });
      return updated.count;
    }),
  );
  return counts.every((c) => c <= LOGIN_MAX);
}
