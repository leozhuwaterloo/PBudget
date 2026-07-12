// Acceptance gate for native-token JWT verification (lib/native_auth.verifyJwt) —
// the ONLY security check standing between a device-supplied id_token and a session.
// Proves it accepts a well-formed RS256 token AND rejects every tampering the auth
// depends on: bad signature, wrong aud, wrong iss, expiry, unknown kid, wrong alg.
// Deterministic, no network (we sign with a locally generated keypair and feed the
// public JWK straight in). Run: npm run check:native-auth
import { generateKeyPairSync, createSign, randomBytes } from "crypto";
import { verifyJwt } from "../src/lib/native_auth";

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

// One RSA keypair standing in for a provider's JWKS signing key.
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = "test-kid";
const jwk = { ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>), kid };
const keys = [jwk];

const ISS = "https://accounts.google.com";
const AUD = "my-client-id.apps.googleusercontent.com";
const NOW = 1_700_000_000;

function makeToken(opts: {
  alg?: string;
  kid?: string;
  payload?: Record<string, unknown>;
  tamper?: boolean;
}): string {
  const header = b64url(JSON.stringify({ alg: opts.alg ?? "RS256", kid: opts.kid ?? kid }));
  const payload = b64url(
    JSON.stringify(opts.payload ?? { iss: ISS, aud: AUD, exp: NOW + 3600, email: "a@b.com" }),
  );
  const signingInput = `${header}.${payload}`;
  const sig = createSign("RSA-SHA256").update(signingInput).end().sign(privateKey);
  const sigStr = opts.tamper ? b64url(randomBytes(sig.length)) : b64url(sig);
  return `${signingInput}.${sigStr}`;
}

const verify = (token: string, over: Partial<{ iss: string[]; aud: string[]; now: number }> = {}) =>
  verifyJwt(token, keys, { iss: [ISS], aud: [AUD], now: NOW, ...over });

function rejects(token: string, over?: Partial<{ iss: string[]; aud: string[]; now: number }>): boolean {
  try {
    verify(token, over);
    return false;
  } catch {
    return true;
  }
}

console.log("\nChecking native id_token JWT verification:");

// Happy path
try {
  const p = verify(makeToken({}));
  check(p.email === "a@b.com", "accepts a valid RS256 token and returns the payload");
} catch (e) {
  check(false, `accepts a valid RS256 token (threw: ${(e as Error).message})`);
}

check(rejects(makeToken({ tamper: true })), "rejects a tampered signature");
check(rejects(makeToken({}), { aud: ["someone-else"] }), "rejects an audience we don't own");
check(rejects(makeToken({}), { iss: ["https://evil.example"] }), "rejects an unexpected issuer");
check(
  rejects(makeToken({ payload: { iss: ISS, aud: AUD, exp: NOW - 1, email: "a@b.com" } })),
  "rejects an expired token",
);
check(rejects(makeToken({ kid: "unknown-kid" })), "rejects an unknown signing key (kid)");
check(rejects(makeToken({ alg: "none" })), "rejects a non-RS256 alg (no alg confusion)");
check(rejects("not.a.jwt.at.all"), "rejects a malformed token");

if (failures) {
  console.error(`\n${failures} check(s) failed\n`);
  process.exit(1);
}
console.log("\nAll native-auth checks passed\n");
