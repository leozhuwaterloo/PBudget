import crypto from "crypto";

// AES-256-GCM encryption at rest for Plaid access tokens AND the PII columns
// encrypted transparently by the Prisma extension in db.ts.
//
// The key here is a DEK (data encryption key). In prod it is delivered as APP_DEK,
// which the Vault agent sidecar unwraps ONCE at startup from a Transit-KEK-wrapped
// blob (envelope encryption) and renders to /vault/secrets — so bulk crypto stays
// local/fast and Vault is never on the read path. Local dev (and legacy
// access-token ciphertext) use APP_ENCRYPTION_KEY; the DEK bytes are that same
// value, so wiring the envelope re-encrypts nothing.
//
// Rotation: rotating the KEK is a Vault-side `rewrap` of the wrapped DEK with NO
// data change (the DEK plaintext is unchanged). ponytail: rotating the DEK itself
// (rare — break-glass) = generate a new DEK as active and list the old one in
// APP_DEK_PREVIOUS; GCM's auth tag lets decrypt trial each key, so old rows keep
// decrypting with no version tag until a rewrap pass re-seals them.

function decodeKey(raw: string): Buffer {
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("encryption key must be a base64-encoded 32-byte value");
  return buf;
}

// Active DEK first, then any retired DEKs still needed to read un-rewrapped rows.
function deks(): Buffer[] {
  const active = process.env.APP_DEK ?? process.env.APP_ENCRYPTION_KEY;
  if (!active) throw new Error("APP_DEK / APP_ENCRYPTION_KEY is not set");
  const prev = (process.env.APP_DEK_PREVIOUS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [active, ...prev].map(decodeKey);
}

// Format: base64(iv).base64(authTag).base64(ciphertext)
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deks()[0], iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Malformed ciphertext");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  let lastErr: unknown;
  for (const k of deks()) {
    try {
      const d = crypto.createDecipheriv("aes-256-gcm", k, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(ct), d.final()]).toString("utf8"); // GCM: wrong key → final() throws
    } catch (e) {
      lastErr = e; // try the next DEK
    }
  }
  throw lastErr ?? new Error("decrypt failed");
}

// Shape of our ciphertext: three base64 segments. Cheap gate so we never try to
// "decrypt" a legacy plaintext row (written before encryption was enabled).
const CIPHERTEXT = /^[A-Za-z0-9+/]+={0,2}\.[A-Za-z0-9+/]+={0,2}\.[A-Za-z0-9+/]+={0,2}$/;

// Decrypt if it authenticates; otherwise return the value untouched. Safe on
// plaintext and on same-named fields of other models — GCM's auth tag rejects
// anything not sealed with our DEK (a false positive is a ~2^-128 tag collision).
// This tolerance is what makes the pre-backfill window and the transparent read
// extension in db.ts safe.
export function maybeDecrypt(value: string): string {
  if (!CIPHERTEXT.test(value)) return value;
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}
