import { createPublicKey, verify as cryptoVerify, type JsonWebKey } from "crypto";

// Verify a native Sign-in ID token (from @capgo/capacitor-social-login on iOS).
//
// SECURITY: unlike the WEB callback — which trusts the id_token because it fetched
// it straight from Google/Apple over TLS — a native token arrives from the DEVICE
// (an untrusted client). So we MUST verify the JWT's RS256 signature against the
// provider's published JWKS AND pin the audience to a client id we own, or anyone
// could POST a self-made token for any email and take over that account.

export type NativeProvider = "google" | "apple";

// The iOS/Android app bundle id — the audience Apple stamps on a native
// Sign in with Apple id_token. Public (ships in the app binary); matches
// capacitor.config.ts appId.
const APP_BUNDLE_ID = "com.ppvnx.pbudget";

const PROVIDER: Record<NativeProvider, { jwksUrl: string; iss: string[] }> = {
  google: {
    jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
    iss: ["https://accounts.google.com", "accounts.google.com"],
  },
  apple: {
    jwksUrl: "https://appleid.apple.com/auth/keys",
    iss: ["https://appleid.apple.com"],
  },
};

// Audiences we own for each provider. A valid token must have been minted for one
// of these. Google native tokens carry aud = the iOS client id (some SDK configs
// use the web/server client id). Apple native tokens carry aud = the app bundle id;
// the Services-ID token-exchange path carries aud = the Services ID. Read from env
// so the whole feature stays dormant/unconfigured — never a wildcard.
function allowedAudiences(provider: NativeProvider): string[] {
  if (provider === "google") {
    return [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_IOS_CLIENT_ID].filter(Boolean) as string[];
  }
  return [APP_BUNDLE_ID, process.env.APPLE_SERVICES_ID].filter(Boolean) as string[];
}

// JWKS keys rotate rarely; cache per-URL for an hour. A token signed with a brand
// new key (unknown kid) forces one fresh fetch via getKeys()'s miss path.
const jwksCache = new Map<string, { keys: JsonWebKey[]; at: number }>();
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getKeys(url: string, now = Date.now()): Promise<JsonWebKey[]> {
  const hit = jwksCache.get(url);
  if (hit && now - hit.at < JWKS_TTL_MS) return hit.keys;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`);
  const { keys } = (await res.json()) as { keys: JsonWebKey[] };
  jwksCache.set(url, { keys, at: now });
  return keys;
}

function decodeSegment(seg: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(seg, "base64url").toString());
}

/**
 * Verify an RS256 JWT against a JWKS key set and validate iss/aud/exp. Returns the
 * decoded payload; throws on any failure. Pure (no network) so it is unit-testable.
 */
export function verifyJwt(
  idToken: string,
  keys: JsonWebKey[],
  opts: { iss: string[]; aud: string[]; now?: number },
): Record<string, unknown> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const [h, p, s] = idToken.split(".");
  if (!h || !p || !s) throw new Error("malformed token");

  const header = decodeSegment(h) as { kid?: string; alg?: string };
  if (header.alg !== "RS256") throw new Error(`unexpected alg: ${header.alg}`);
  const jwk = keys.find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk) throw new Error("no matching signing key");

  const pubKey = createPublicKey({ key: jwk, format: "jwk" });
  const sigOk = cryptoVerify("RSA-SHA256", Buffer.from(`${h}.${p}`), pubKey, Buffer.from(s, "base64url"));
  if (!sigOk) throw new Error("bad signature");

  const payload = decodeSegment(p);
  if (!opts.iss.includes(payload.iss as string)) throw new Error(`bad iss: ${payload.iss}`);
  if (!opts.aud.includes(payload.aud as string)) throw new Error(`bad aud: ${payload.aud}`);
  if (typeof payload.exp !== "number" || payload.exp < now) throw new Error("token expired");
  return payload;
}

/**
 * Verify a native provider id_token end-to-end and return the verified email.
 * Throws on any signature/claim failure or unverified email.
 */
export async function verifyNativeIdToken(provider: NativeProvider, idToken: string): Promise<string> {
  const cfg = PROVIDER[provider];
  const aud = allowedAudiences(provider);
  if (aud.length === 0) throw new Error("provider not configured"); // dormant: refuse rather than accept any aud
  const keys = await getKeys(cfg.jwksUrl);
  const payload = verifyJwt(idToken, keys, { iss: cfg.iss, aud });

  const email = payload.email;
  const verified = payload.email_verified; // Apple returns the string "true"
  if (typeof email !== "string" || !email || (verified !== true && verified !== "true")) {
    throw new Error("email missing or unverified");
  }
  return email;
}
