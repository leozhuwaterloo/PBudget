// Gate for the email send rate limiter (lib/rateLimit.ts). Drives the real DB-backed
// limiter and asserts the 1/min cap holds on BOTH dimensions (IP + recipient), that
// the window expires, and that the no-IP path still caps on recipient. Run against
// the dev DB: npm run check:ratelimit
import assert from "assert";
import { prisma } from "../src/lib/db";
import { emailRateLimited, emailDims } from "../src/lib/rateLimit";

async function main() {
  await prisma.emailRateLimit.deleteMany({}); // clean slate

  // First send for a (recipient, ip) pair is allowed; an immediate repeat is blocked.
  assert((await emailRateLimited(emailDims("a@x.com", "1.1.1.1"))) === false, "first allowed");
  assert((await emailRateLimited(emailDims("a@x.com", "1.1.1.1"))) === true, "immediate repeat blocked");

  // Per-IP: a DIFFERENT recipient from the SAME ip is blocked by the ip dimension.
  assert((await emailRateLimited(emailDims("b@x.com", "1.1.1.1"))) === true, "same ip blocks a new recipient");

  // Per-recipient: the SAME recipient from a DIFFERENT ip is blocked by the recipient dimension.
  assert((await emailRateLimited(emailDims("a@x.com", "2.2.2.2"))) === true, "same recipient blocks a new ip");

  // Fully independent (new recipient AND new ip) is allowed.
  assert((await emailRateLimited(emailDims("c@x.com", "3.3.3.3"))) === false, "independent send allowed");

  // Window expiry: age every row past the 60s window → the pair is allowed again.
  await prisma.emailRateLimit.updateMany({ data: { lastSentAt: new Date(Date.now() - 61 * 1000) } });
  assert((await emailRateLimited(emailDims("a@x.com", "1.1.1.1"))) === false, "allowed after window elapses");

  // No-IP path (missing forwarded header) still caps on the recipient alone.
  await prisma.emailRateLimit.deleteMany({});
  assert((await emailRateLimited(emailDims("d@x.com", null))) === false, "no-ip first allowed");
  assert((await emailRateLimited(emailDims("d@x.com", null))) === true, "no-ip repeat blocked");

  await prisma.emailRateLimit.deleteMany({});
  console.log("check:ratelimit OK");
  process.exit(0);
}

main();
