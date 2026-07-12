// Self-check for the Plaid webhook verification math in src/lib/plaid.ts. The risky
// bit is ES256's raw R||S signature (JOSE) vs DER — verify() must use
// dsaEncoding:"ieee-p1363" or a valid signature silently fails. Mirrors verifyWebhook's
// primitives exactly and asserts: valid passes, tampered body / wrong key / stale iat fail.
// Run: tsx scripts/check-webhook.ts   (no DB, no network)
import crypto from "node:crypto";
import assert from "node:assert";

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function makeJwt(rawBody: string, privateKey: crypto.KeyObject, iat = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: "test", typ: "JWT" }));
  const bodyHash = crypto.createHash("sha256").update(rawBody, "utf8").digest("hex");
  const payload = b64url(JSON.stringify({ iat, request_body_sha256: bodyHash }));
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${b64url(sig)}`;
}

// verifyWebhook's core, with the key passed in (the real fn fetches it from Plaid by kid).
function verify(rawBody: string, jwt: string, key: crypto.KeyObject): boolean {
  const [h, p, s] = jwt.split(".");
  if (!h || !p || !s) return false;
  if (JSON.parse(Buffer.from(h, "base64url").toString()).alg !== "ES256") return false;
  if (!crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))) return false;
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  if (Date.now() / 1000 - payload.iat > 300) return false;
  const actual = crypto.createHash("sha256").update(rawBody, "utf8").digest("hex");
  const expected = payload.request_body_sha256;
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const other = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const body = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "DEFAULT_UPDATE", item_id: "itm_1" });

assert.equal(verify(body, makeJwt(body, privateKey), publicKey), true, "valid webhook must pass");
assert.equal(verify(body + " ", makeJwt(body, privateKey), publicKey), false, "tampered body must fail (hash mismatch)");
assert.equal(verify(body, makeJwt(body, other.privateKey), publicKey), false, "wrong signing key must fail");
assert.equal(verify(body, makeJwt(body, privateKey, Math.floor(Date.now() / 1000) - 600), publicKey), false, "stale iat (10m) must fail");

console.log("✓ webhook verification: valid passes; tampered body, wrong key, stale iat all rejected");
