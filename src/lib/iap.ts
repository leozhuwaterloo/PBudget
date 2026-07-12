import { verify as cryptoVerify, createSign, X509Certificate } from "crypto";
import type { User } from "@prisma/client";
import type { Plan } from "./stripe";
import { setUserTier } from "./stripe";
import { prisma } from "./db";

// Native store IAP (iOS StoreKit / Google Play Billing) with SELF-HOSTED receipt
// validation. Web billing stays Stripe (lib/stripe.ts); this is the app-only path
// because Apple/Google mandate their own in-app billing for digital subscriptions.
//
// Entitlement is set through the SAME setUserTier() the Stripe webhook uses — a
// verified purchase writes the same plan/subscriptionStatus fields, so everything
// downstream (entitledConnections/enforceEntitlement) is identical to Stripe.
//
// DORMANT until configured: no product ids => the native UI hides and the routes
// 503. Mirrors how native_auth / social login stay dormant until their env is set.
//
// SECURITY: the client token is UNTRUSTED. iOS is verified by validating Apple's
// signed-transaction JWS against the pinned Apple Root CA (offline, below). Android
// is verified by re-querying the Google Play Developer API server-side. Never trust
// the client's claimed product/plan.

export type IapPlatform = "ios" | "android";

// App bundle / package id (public — ships in the binary; matches capacitor.config.ts).
const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID || "com.ppvnx.pbudget";
const ANDROID_PACKAGE = process.env.ANDROID_PACKAGE_NAME || "com.ppvnx.pbudget";

// ---- Product-id -> plan (dormant until env set) ---------------------------

// The two store product ids the native UI registers. Use the SAME product-id
// string on both stores; the PRICE (web x ~1.3) is set per store console.
export function iapProducts(): { pro: string; max: string } | null {
  const pro = process.env.IAP_PRODUCT_PRO;
  const max = process.env.IAP_PRODUCT_MAX;
  return pro && max ? { pro, max } : null;
}
export function iapEnabled(): boolean {
  return iapProducts() !== null;
}

function productToPlan(productId: string | undefined): Plan | null {
  if (!productId) return null;
  if (productId === process.env.IAP_PRODUCT_PRO) return "pro";
  if (productId === process.env.IAP_PRODUCT_MAX) return "max";
  return null;
}

// Mirrors stripe.planForSubscription: only an ACTIVE purchase of a known product is
// paid; anything else (expired / refunded / unknown product) falls back to free.
export function iapPlanForProduct(productId: string, active: boolean): Plan {
  return active ? productToPlan(productId) ?? "free" : "free";
}

// What the native billing UI needs (products to register + web-billing URL for the
// geo-gated "save on web" link). enabled=false => render nothing / dormant.
export function iapBillingConfig(): {
  enabled: boolean;
  products: { pro: string; max: string } | null;
  webUrl: string;
} {
  const products = iapProducts();
  return {
    enabled: products !== null,
    products,
    webUrl: `${process.env.APP_URL || "http://localhost:5300"}/customizations#billing`,
  };
}

// Geo-gated "pay on the web and save" compliance lives in lib/iap_geo.ts
// (client-safe: it has to bundle into the browser, so it can't import crypto/prisma).

// ---- Apple: verify a StoreKit 2 signed transaction JWS (offline) ----------

// Apple Root CA - G3 (public). StoreKit 2 signed transactions and App Store Server
// Notifications V2 are ES256 JWS whose x5c header is a cert chain terminating here.
const APPLE_ROOT_CA_G3_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;

function b64urlJson(seg: string): Record<string, any> {
  return JSON.parse(Buffer.from(seg, "base64url").toString());
}

// Verify an Apple ES256 JWS with an x5c cert chain and return its decoded payload.
// SECURITY (the client-supplied token is untrusted): (1) walk the x5c chain
// leaf<-...<-root verifying each cert's signature with the next cert's key, (2) PIN
// the chain's root to the embedded Apple Root CA G3 (raw-DER compare — the anchor of
// trust), (3) verify the JWS body signature (ES256, JOSE raw r||s) with the LEAF key.
// Pure (no network) so it is unit-testable; `rootPem` is injectable for the test.
// ponytail: no cert notBefore/notAfter check — the pinned chain + body signature is
// the trust anchor and the payload's own expiresDate gates entitlement. Add cert-date
// validation if Apple leaf-cert rotation ever needs enforcing.
export function verifyAppleJws(jws: string, rootPem: string = APPLE_ROOT_CA_G3_PEM): Record<string, any> {
  const [h, p, s] = jws.split(".");
  if (!h || !p || !s) throw new Error("malformed jws");

  const header = b64urlJson(h) as { alg?: string; x5c?: string[] };
  if (header.alg !== "ES256") throw new Error(`unexpected alg: ${header.alg}`);
  if (!header.x5c || header.x5c.length < 2) throw new Error("missing x5c chain");

  const chain = header.x5c.map((c) => new X509Certificate(Buffer.from(c, "base64")));
  const root = new X509Certificate(rootPem);

  // Pin: the chain must terminate at OUR embedded Apple root (byte-for-byte).
  if (!chain[chain.length - 1].raw.equals(root.raw)) throw new Error("untrusted root: not the pinned Apple root");
  // Each cert must be signed by the one above it (leaf<-intermediate<-root).
  for (let i = 0; i < chain.length - 1; i++) {
    if (!chain[i].verify(chain[i + 1].publicKey)) throw new Error(`broken chain link at ${i}`);
  }

  const sigOk = cryptoVerify(
    "sha256",
    Buffer.from(`${h}.${p}`),
    { key: chain[0].publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(s, "base64url")
  );
  if (!sigOk) throw new Error("bad jws signature");
  return b64urlJson(p);
}

export interface AppleTx {
  productId: string;
  originalTransactionId: string;
  expiresMs: number | null;
  revoked: boolean;
}

// Verify a StoreKit 2 signed transaction JWS and pull out what we grant on, after
// confirming it is OUR app's bundle (a valid JWS for a different app is still a forgery
// against us). `rootPem` is injectable for the test (defaults to the pinned Apple root).
export function verifyAppleTransaction(jws: string, rootPem?: string): AppleTx {
  const t = verifyAppleJws(jws, rootPem);
  if (t.bundleId !== APPLE_BUNDLE_ID) throw new Error(`bundle mismatch: ${t.bundleId}`);
  if (typeof t.productId !== "string" || typeof t.originalTransactionId !== "string") {
    throw new Error("transaction missing productId/originalTransactionId");
  }
  return {
    productId: t.productId,
    originalTransactionId: t.originalTransactionId,
    expiresMs: typeof t.expiresDate === "number" ? t.expiresDate : null,
    revoked: typeof t.revocationDate === "number", // refund / revoke sets this
  };
}

async function grantApple(userId: string, tx: AppleTx): Promise<Plan> {
  const active = !tx.revoked && (tx.expiresMs === null || tx.expiresMs > Date.now());
  const plan = iapPlanForProduct(tx.productId, active);
  await setUserTier(userId, plan, active ? "active" : "canceled", {
    iapPlatform: "ios",
    iapProductId: tx.productId,
    iapOriginalTxnId: tx.originalTransactionId,
  });
  return plan;
}

// /api/iap/verify (iOS): the client hands us the signed transaction JWS. We verify
// it end-to-end and grant to the AUTHENTICATED user (binding iapOriginalTxnId so a
// later renewal/cancel notification maps back here).
export async function grantFromAppleJws(userId: string, jws: string): Promise<Plan> {
  return grantApple(userId, verifyAppleTransaction(jws));
}

// App Store Server Notification V2: { signedPayload } (a JWS) whose data carries a
// signedTransactionInfo (another JWS). Verify both, then map by originalTransactionId
// to the user who bought it and re-set their tier from the (authoritative) transaction.
export async function applyAppleNotification(signedPayload: string): Promise<void> {
  const outer = verifyAppleJws(signedPayload);
  const txJws = outer.data?.signedTransactionInfo as string | undefined;
  if (!txJws) return; // e.g. test/other notifications with no transaction — nothing to do
  const tx = verifyAppleTransaction(txJws);
  const user = await prisma.user.findFirst({ where: { iapOriginalTxnId: tx.originalTransactionId } });
  if (!user) return; // a purchase we never bound to an account — ignore
  await grantApple(user.id, tx);
}

// ---- Android: verify via the Google Play Developer API (network) -----------

interface GoogleSA {
  client_email: string;
  private_key: string;
  token_uri: string;
}
function googleSA(): GoogleSA | null {
  const raw = process.env.GOOGLE_PLAY_SA_JSON;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as Partial<GoogleSA>;
    if (!sa.client_email || !sa.private_key) return null;
    return {
      client_email: sa.client_email,
      private_key: sa.private_key,
      token_uri: sa.token_uri || "https://oauth2.googleapis.com/token",
    };
  } catch {
    return null;
  }
}

// RS256-sign a service-account JWT and exchange it for an androidpublisher token.
// ponytail: hand-rolled instead of the (huge) googleapis SDK — one signed JWT + one
// token POST, matching the repo's fetch-only, dependency-light house style.
async function googleAccessToken(sa: GoogleSA): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const signingInput = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign("RSA-SHA256").update(signingInput).end().sign(sa.private_key).toString("base64url");
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${sig}`,
    }),
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

// Ask Google Play whether this subscription purchase token is currently valid.
export async function verifyGoogleSubscription(
  productId: string,
  token: string
): Promise<{ expiresMs: number | null; active: boolean }> {
  const sa = googleSA();
  if (!sa) throw new Error("Google Play service account not configured");
  const at = await googleAccessToken(sa);
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ANDROID_PACKAGE}` +
    `/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${at}` } });
  if (!res.ok) throw new Error(`play api verify failed: ${res.status}`);
  const sub = (await res.json()) as { expiryTimeMillis?: string; paymentState?: number };
  const expiresMs = sub.expiryTimeMillis ? Number(sub.expiryTimeMillis) : null;
  // paymentState: 1=received, 2=free-trial => paid; anything else (0 pending / 3
  // deferred / absent on canceled) is not entitled. Active also requires unexpired.
  const paid = sub.paymentState === 1 || sub.paymentState === 2;
  return { expiresMs, active: paid && expiresMs !== null && expiresMs > Date.now() };
}

async function grantGoogle(userId: string, productId: string, token: string): Promise<Plan> {
  const { active } = await verifyGoogleSubscription(productId, token);
  const plan = iapPlanForProduct(productId, active);
  await setUserTier(userId, plan, active ? "active" : "canceled", {
    iapPlatform: "android",
    iapProductId: productId,
    iapPurchaseToken: token,
  });
  return plan;
}

// /api/iap/verify (Android): grant to the authenticated user after Play confirms it.
export async function grantFromGooglePurchase(userId: string, productId: string, token: string): Promise<Plan> {
  return grantGoogle(userId, productId, token);
}

// Google RTDN (Pub/Sub push): { message: { data: base64(json) } }. The inner data has
// subscriptionNotification.{purchaseToken, subscriptionId}. We DON'T trust the push —
// map by the stored purchase token to the user, then re-query Play (authoritative).
export async function applyGoogleNotification(body: unknown): Promise<void> {
  const dataB64 = (body as { message?: { data?: string } })?.message?.data;
  if (!dataB64) return;
  const payload = JSON.parse(Buffer.from(dataB64, "base64").toString()) as {
    subscriptionNotification?: { purchaseToken?: string; subscriptionId?: string };
  };
  const n = payload.subscriptionNotification;
  if (!n?.purchaseToken || !n?.subscriptionId) return; // e.g. test / voided / one-time — ignore
  const user = await prisma.user.findFirst({ where: { iapPurchaseToken: n.purchaseToken } });
  if (!user) return;
  await grantGoogle(user.id, n.subscriptionId, n.purchaseToken);
}

// Narrow re-export so routes don't reach into @prisma/client for the User type.
export type { User };
