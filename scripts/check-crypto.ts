// Acceptance gate for at-rest field encryption. Proves the crypto primitives
// (round-trip, DEK rotation via trial-decrypt, legacy-plaintext tolerance) AND the
// end-to-end property that matters: a written PII column is CIPHERTEXT on disk yet
// reads back as plaintext through the db.ts Prisma extension. Deterministic, no
// network. Run: npm run check:crypto
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

import { PrismaClient } from "@prisma/client";
import { prisma } from "../src/lib/db"; // extended: encrypts on write, decrypts on read
import { encrypt, decrypt, maybeDecrypt } from "../src/lib/crypto";

const raw = new PrismaClient(); // NO extension → sees exactly what's stored on disk

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

const USER = "crypto-test-user";
const ITEM = "ct-item";
const ACCT = "ct-acct";
const TXN = "ct-txn-1";
const looksEncrypted = (s: string) => /^[A-Za-z0-9+/]+={0,2}(\.[A-Za-z0-9+/]+={0,2}){2}$/.test(s);

async function main(): Promise<void> {
  console.log("\nChecking at-rest field encryption:");

  // --- Primitives ----------------------------------------------------------
  const secret = "STARBUCKS STORE #12345, Seattle WA";
  const ct = encrypt(secret);
  check(ct !== secret && looksEncrypted(ct), "encrypt produces ciphertext");
  check(decrypt(ct) === secret, "decrypt round-trips");
  check(encrypt(secret) !== encrypt(secret), "same plaintext → different ciphertext (random IV)");

  // maybeDecrypt tolerates legacy plaintext — including values that happen to look
  // dotted (a merchant literally named "T.D.Bank" must survive untouched).
  check(maybeDecrypt(ct) === secret, "maybeDecrypt decrypts real ciphertext");
  check(maybeDecrypt("STARBUCKS") === "STARBUCKS", "maybeDecrypt passes plaintext through");
  check(maybeDecrypt("T.D.Bank") === "T.D.Bank", "maybeDecrypt passes dotted plaintext through");

  // DEK rotation: encrypt under key A, then make B active with A retired → still reads.
  const keyA = process.env.APP_DEK ?? (process.env.APP_ENCRYPTION_KEY as string);
  const keyB = Buffer.alloc(32, 9).toString("base64");
  const underA = encrypt("rotated-secret");
  process.env.APP_DEK = keyB;
  process.env.APP_DEK_PREVIOUS = keyA;
  check(decrypt(underA) === "rotated-secret", "rotation: old-DEK ciphertext still decrypts via APP_DEK_PREVIOUS");
  check(decrypt(encrypt("fresh")) === "fresh", "rotation: new active DEK round-trips");
  delete process.env.APP_DEK; // restore single-key state for the DB proof
  delete process.env.APP_DEK_PREVIOUS;

  // --- End-to-end: at rest on disk, plaintext through the extension --------
  await reset();
  await prisma.plaidTransaction.create({
    data: {
      transactionId: TXN, accountId: ACCT, amount: 4.5,
      category: JSON.stringify({ primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE" }),
      datetime: new Date("2026-01-01"), name: "STARBUCKS #123", merchantName: "Starbucks",
      website: "starbucks.com", paymentChannel: "in store", pending: false,
    },
  });

  const onDisk = await raw.plaidTransaction.findUnique({ where: { transactionId: TXN } });
  check(!!onDisk && onDisk.name !== "STARBUCKS #123" && looksEncrypted(onDisk.name), "at rest: name column is ciphertext");
  check(!!onDisk && looksEncrypted(onDisk.merchantName!), "at rest: merchantName column is ciphertext");
  check(!!onDisk && looksEncrypted(onDisk.category!), "at rest: category column is ciphertext");
  check(!!onDisk && looksEncrypted(onDisk.website!), "at rest: website column is ciphertext");

  const read = await prisma.plaidTransaction.findUnique({ where: { transactionId: TXN } });
  check(read?.name === "STARBUCKS #123", "read: extension decrypts name transparently");
  check(read?.merchantName === "Starbucks", "read: extension decrypts merchantName");
  check(read?.category === JSON.stringify({ primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE" }), "read: category JSON restored");

  // Nested include (item → accounts) must decrypt too, not just top-level reads.
  const acct = await raw.plaidAccount.findUnique({ where: { accountId: ACCT } });
  check(!!acct && looksEncrypted(acct.name), "at rest: account name column is ciphertext");
  const nested = await prisma.plaidItem.findUnique({ where: { itemId: ITEM }, include: { accounts: true } });
  check(nested?.accounts[0]?.name === "CT Chequing", "read: nested-include account name decrypted");

  await teardown();
  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED\n`);
    process.exit(1);
  }
  console.log("\nAll at-rest encryption checks passed.\n");
}

async function reset(): Promise<void> {
  await teardown();
  await prisma.user.create({ data: { id: USER, email: `${USER}@t.local`, passwordHash: "x" } });
  await prisma.plaidInstitution.upsert({
    where: { institutionId: "ct-inst" },
    create: { institutionId: "ct-inst", name: "CT Bank" },
    update: {},
  });
  await prisma.plaidItem.create({
    data: { itemId: ITEM, userId: USER, institutionId: "ct-inst", accessToken: "x", lastForceRefreshed: new Date("2026-01-01") },
  });
  await prisma.plaidAccount.create({ data: { accountId: ACCT, itemId: ITEM, name: "CT Chequing", officialName: "CT Chequing Account", accountType: "depository" } });
}

async function teardown(): Promise<void> {
  await prisma.user.deleteMany({ where: { id: USER } }); // cascades item→acct→txn
  await prisma.plaidInstitution.deleteMany({ where: { institutionId: "ct-inst" } });
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await raw.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    await raw.$disconnect();
    process.exit(1);
  });
