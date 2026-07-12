import { createPrivateKey, sign } from "crypto";

// Sign in with Apple's client_secret is NOT a static string like Google's: it's a
// short-lived ES256 JWT signed with the Sign in with Apple .p8 key. We mint it per
// request (cheap) with the max lifetime Apple allows. Config comes from env
// (Vault-injected), shared across every PPVNX app that reuses the one Services ID:
//   APPLE_TEAM_ID     — 10-char Apple Developer Team ID           (JWT iss)
//   APPLE_SERVICES_ID — the Services ID = the OAuth client_id     (JWT sub)
//   APPLE_KEY_ID      — the Sign in with Apple key's Key ID       (JWT header kid)
//   APPLE_PRIVATE_KEY — base64 of the .p8 PEM (base64 so the multi-line key
//                       survives a single-line env var without newline mangling)

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

const MAX_TTL_S = 60 * 60 * 24 * 180; // Apple caps client_secret lifetime at 6 months

/** True only when all four Apple env vars are set — the button + routes stay dormant otherwise. */
export function appleConfigured(): boolean {
  return !!(
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_SERVICES_ID &&
    process.env.APPLE_KEY_ID &&
    process.env.APPLE_PRIVATE_KEY
  );
}

export function appleClientSecret(now = Math.floor(Date.now() / 1000)): string {
  const pem = Buffer.from(process.env.APPLE_PRIVATE_KEY!, "base64").toString("utf8");
  const header = b64url(JSON.stringify({ alg: "ES256", kid: process.env.APPLE_KEY_ID! }));
  const payload = b64url(
    JSON.stringify({
      iss: process.env.APPLE_TEAM_ID!,
      iat: now,
      exp: now + MAX_TTL_S,
      aud: "https://appleid.apple.com",
      sub: process.env.APPLE_SERVICES_ID!,
    }),
  );
  const signingInput = `${header}.${payload}`;
  // dsaEncoding: "ieee-p1363" → raw r||s (the 64-byte JOSE signature), not DER.
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: createPrivateKey(pem),
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${b64url(signature)}`;
}
