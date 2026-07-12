// Acceptance gate for native store-IAP receipt verification (lib/iap) — the ONLY
// security check standing between a device-supplied receipt and a granted paid tier.
// Focus: the Apple StoreKit signed-transaction JWS verification (verifyAppleJws /
// verifyAppleTransaction), the novel offline crypto path. Proves it accepts a valid,
// properly-chained, correctly-pinned receipt AND rejects every tampering the money
// path depends on: tampered body, unpinned root, broken chain, wrong alg, wrong app.
//
// Deterministic, no network: we mint a real EC cert chain (root/intermediate/leaf)
// with openssl, inject the test root, and sign the JWS body in Node (ES256, raw r||s).
// Also spot-checks the geo-gated web-link compliance logic. Run: npm run check:iap
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { sign as ecSign, X509Certificate } from "crypto";
import { verifyAppleJws, verifyAppleTransaction } from "../src/lib/iap";
import { showWebLink } from "../src/lib/iap_geo";

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}
function rejects(fn: () => unknown): boolean {
  try { fn(); return false; } catch { return true; }
}
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

// --- Mint an EC P-256 root -> intermediate -> leaf chain with openssl ---------
const dir = mkdtempSync(join(tmpdir(), "iap-check-"));
const ossl = (args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
const genKey = (n: string) => ossl(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", `${n}.key`]);
const selfSign = (n: string, cn: string) =>
  ossl(["req", "-new", "-x509", "-key", `${n}.key`, "-out", `${n}.crt`, "-days", "3650", "-subj", `/CN=${cn}`]);
const signWith = (child: string, cn: string, ca: string) => {
  ossl(["req", "-new", "-key", `${child}.key`, "-out", `${child}.csr`, "-subj", `/CN=${cn}`]);
  ossl(["x509", "-req", "-in", `${child}.csr`, "-CA", `${ca}.crt`, "-CAkey", `${ca}.key`,
        "-CAcreateserial", "-out", `${child}.crt`, "-days", "3650"]);
};
genKey("root"); selfSign("root", "Test Apple Root");
genKey("inter"); signWith("inter", "Test Intermediate", "root");
genKey("leaf"); signWith("leaf", "Test Leaf", "inter");

const rootPem = readFileSync(join(dir, "root.crt"), "utf8");
const leafKeyPem = readFileSync(join(dir, "leaf.key"), "utf8");
const der = (name: string) => new X509Certificate(readFileSync(join(dir, `${name}.crt`))).raw.toString("base64");
const X5C = [der("leaf"), der("inter"), der("root")];

const BUNDLE = "com.ppvnx.pbudget"; // default APPLE_BUNDLE_ID
const PRODUCT = "com.ppvnx.pbudget.pro.monthly";

// Build a signed StoreKit-style JWS (ES256, JOSE raw r||s) with the leaf key.
function makeJws(o: { alg?: string; x5c?: string[]; payload?: Record<string, unknown>; tamper?: boolean } = {}): string {
  const header = b64url(JSON.stringify({ alg: o.alg ?? "ES256", x5c: o.x5c ?? X5C }));
  const payload = b64url(JSON.stringify(o.payload ?? {
    bundleId: BUNDLE, productId: PRODUCT, originalTransactionId: "2000000012345678",
    expiresDate: Date.now() + 30 * 86400_000,
  }));
  const input = `${header}.${payload}`;
  const sig = ecSign("sha256", Buffer.from(input), { key: leafKeyPem, dsaEncoding: "ieee-p1363" });
  return `${input}.${o.tamper ? b64url(Buffer.from(sig).fill(0)) : b64url(sig)}`;
}

try {
  console.log("\nChecking Apple StoreKit JWS signature + chain + pin:");
  const good = makeJws();
  check(verifyAppleJws(good, rootPem).productId === PRODUCT, "accepts a valid, correctly-chained, pinned JWS");
  check(rejects(() => verifyAppleJws(good)), "rejects a JWS that doesn't chain to the PINNED Apple root");
  check(rejects(() => verifyAppleJws(makeJws({ tamper: true }), rootPem)), "rejects a tampered body signature");
  check(rejects(() => verifyAppleJws(makeJws({ x5c: [der("leaf"), der("root")] }), rootPem)), "rejects a broken cert chain (missing intermediate)");
  check(rejects(() => verifyAppleJws(makeJws({ x5c: [der("leaf")] }), rootPem)), "rejects a single-cert receipt (no chain)");
  check(rejects(() => verifyAppleJws(makeJws({ alg: "RS256" }), rootPem)), "rejects a non-ES256 alg (no alg confusion)");
  check(rejects(() => verifyAppleJws("not.a.jws", rootPem)), "rejects a malformed token");

  console.log("\nChecking transaction extraction + guards:");
  const tx = verifyAppleTransaction(good, rootPem);
  check(tx.productId === PRODUCT && tx.originalTransactionId === "2000000012345678", "extracts productId + originalTransactionId");
  check(tx.expiresMs !== null && tx.expiresMs > Date.now() && !tx.revoked, "reports an unexpired, un-revoked transaction");
  check(
    rejects(() => verifyAppleTransaction(makeJws({ payload: { bundleId: "com.evil.app", productId: PRODUCT, originalTransactionId: "1" } }), rootPem)),
    "rejects a receipt for a DIFFERENT app bundle",
  );
  const revoked = verifyAppleTransaction(makeJws({ payload: { bundleId: BUNDLE, productId: PRODUCT, originalTransactionId: "1", revocationDate: Date.now() } }), rootPem);
  check(revoked.revoked === true, "flags a revoked (refunded) transaction");

  console.log("\nChecking geo-gated web-link compliance:");
  check(showWebLink("android", null) === true, "Android: web link shown broadly");
  check(showWebLink("ios", "USA") === true, "iOS US storefront: web link shown");
  check(showWebLink("ios", "CAN") === false, "iOS non-US storefront: web link hidden");
  check(showWebLink("ios", null) === false, "iOS unknown storefront: web link hidden (safe default)");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} check(s) failed\n`);
  process.exit(1);
}
console.log("\nAll IAP receipt-verification checks passed\n");
