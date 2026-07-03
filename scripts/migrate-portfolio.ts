// One-off, idempotent, re-runnable migration of the OLD Portfolio Django plaid
// app's data into this app's Prisma schema (FR8).
//
//   npm run migrate:portfolio            # reads OLD_DATABASE_URL (Postgres)
//   npm run migrate:portfolio -- --fixture  # reads the bundled fixture (no prod access)
//
// Env: OLD_DATABASE_URL (source Postgres), OLD_FERNET_KEY (Django's Fernet key),
//      OWNER_EMAIL (attach everything to this existing user; default below),
//      APP_ENCRYPTION_KEY (this app's key, via .env — used to re-encrypt tokens).
//
// Design decisions (SPEC "Migration (F10)"): original Plaid transaction/account/
// item IDs are PRESERVED so the next 180-day sync upserts into migrated rows
// instead of duplicating (which would mass-false-flag duplicates). Every upsert
// keys on those natural IDs → re-running is a no-op. The analyzer is NOT run
// here; analysis happens on the next sync/analyzeUser (nothing grandfathered).
import crypto from "crypto";
import { prisma } from "../src/lib/db";
import { encrypt } from "../src/lib/crypto";

const DEFAULT_OWNER_EMAIL = "yuner25699@gmail.com";

// ---- Source row shapes (snake_case columns, mirroring the Django tables) ----
// Both readers (pg + fixture) yield these; only the reader differs.
export type InstitutionRow = { institution_id: string; name: string; primary_color: string | null; url: string | null; logo: string | null };
export type ItemRow = { item_id: string; user_id: number | string; institution_id: string; access_token: Buffer | string; last_force_refreshed: Date | string };
export type AccountRow = { account_id: string; item_id: string; name: string; official_name: string | null; account_type: string; account_subtype: string | null; available: string | number | null; current: string | number | null; limit: string | number | null; iso_currency_code: string | null };
export type TransactionRow = { transaction_id: string; account_id: string; amount: string | number; iso_currency_code: string | null; category: string | object | null; datetime: Date | string; name: string; merchant_name: string | null; payment_channel: string; pending: boolean; pending_transaction_id: string | null };
export type CategoryRow = { name: string; budget: string | number };
export type MetaRow = { transaction_id: string; predicted_category_id: string };
export type SourceRows = {
  institutions: InstitutionRow[];
  items: ItemRow[];
  accounts: AccountRow[];
  transactions: TransactionRow[];
  categories: CategoryRow[];
  metas: MetaRow[];
};

// ---- Fernet decrypt (github.com/fernet/spec) --------------------------------
// key: url-safe base64 of 32 bytes = signingKey(16) || encKey(16).
// token: the Fernet token (url-safe base64 string), or the raw bytea Buffer
// holding its ASCII (Django BinaryField). AES-128-CBC + HMAC-SHA256.
function fernetDecrypt(key: string, token: Buffer | string): string {
  const keyBytes = Buffer.from(key, "base64url");
  if (keyBytes.length !== 32) throw new Error("OLD_FERNET_KEY must be 32 url-safe base64 bytes");
  const signingKey = keyBytes.subarray(0, 16);
  const encKey = keyBytes.subarray(16, 32);

  const tokenStr = Buffer.isBuffer(token) ? token.toString("utf8") : token;
  const data = Buffer.from(tokenStr, "base64url");
  // 1 version + 8 timestamp + 16 iv + >=16 ciphertext + 32 hmac
  if (data.length < 57 || data[0] !== 0x80) throw new Error("Invalid Fernet token");

  const mac = data.subarray(data.length - 32);
  const signed = data.subarray(0, data.length - 32);
  const expected = crypto.createHmac("sha256", signingKey).update(signed).digest();
  if (!crypto.timingSafeEqual(mac, expected)) throw new Error("Fernet HMAC verification failed (wrong key?)");

  const iv = data.subarray(9, 25);
  const ciphertext = data.subarray(25, data.length - 32);
  const decipher = crypto.createDecipheriv("aes-128-cbc", encKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// ---- Readers ----------------------------------------------------------------

async function readFromPg(connectionString: string): Promise<SourceRows> {
  const { Client } = await import("pg"); // only load pg in non-fixture mode
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const q = async (sql: string) => (await client.query(sql)).rows;
    return {
      institutions: await q("SELECT institution_id, name, primary_color, url, logo FROM plaid_plaidinstitution"),
      items: await q("SELECT item_id, user_id, institution_id, access_token, last_force_refreshed FROM plaid_plaiditem"),
      accounts: await q('SELECT account_id, item_id, name, official_name, account_type, account_subtype, available, current, "limit", iso_currency_code FROM plaid_plaidaccount'),
      transactions: await q("SELECT transaction_id, account_id, amount, iso_currency_code, category, datetime, name, merchant_name, payment_channel, pending, pending_transaction_id FROM plaid_plaidtransaction"),
      categories: await q("SELECT name, budget FROM plaid_transactioncategory"),
      metas: await q("SELECT transaction_id, predicted_category_id FROM plaid_plaidtransactionmeta"),
    };
  } finally {
    await client.end();
  }
}

// ---- Transform + upsert (shared by both readers) ----------------------------

const toJson = (c: string | object | null): string | null =>
  c == null ? null : typeof c === "string" ? c : JSON.stringify(c);

async function migrate(rows: SourceRows, ownerId: string, fernetKey: string) {
  for (const r of rows.institutions) {
    const data = { name: r.name, primaryColor: r.primary_color, url: r.url, logo: r.logo };
    await prisma.plaidInstitution.upsert({
      where: { institutionId: r.institution_id },
      create: { institutionId: r.institution_id, ...data },
      update: data,
    });
  }

  for (const r of rows.items) {
    // Decrypt with the OLD Fernet key, re-encrypt with THIS app's crypto so the
    // bank stays connected (same access token, new at-rest scheme).
    const accessToken = encrypt(fernetDecrypt(fernetKey, r.access_token));
    const data = {
      userId: ownerId, // attach to the owner, ignoring the source user_id
      institutionId: r.institution_id,
      accessToken,
      lastForceRefreshed: new Date(r.last_force_refreshed),
    };
    await prisma.plaidItem.upsert({
      where: { itemId: r.item_id },
      create: { itemId: r.item_id, ...data },
      update: data,
    });
  }

  for (const r of rows.accounts) {
    const data = {
      itemId: r.item_id,
      name: r.name,
      officialName: r.official_name,
      accountType: r.account_type,
      accountSubtype: r.account_subtype,
      available: r.available,
      current: r.current,
      limit: r.limit,
      isoCurrencyCode: r.iso_currency_code,
    };
    await prisma.plaidAccount.upsert({
      where: { accountId: r.account_id },
      create: { accountId: r.account_id, ...data },
      update: data,
    });
  }

  // Per-owner category rows carry the old global budgets.
  for (const r of rows.categories) {
    await prisma.transactionCategory.upsert({
      where: { userId_name: { userId: ownerId, name: r.name } },
      create: { userId: ownerId, name: r.name, budget: r.budget },
      update: { budget: r.budget },
    });
  }

  // predictedCategory comes from the old ML meta table (null when no meta row).
  const predicted = new Map(rows.metas.map((m) => [m.transaction_id, m.predicted_category_id]));
  for (const r of rows.transactions) {
    const data = {
      accountId: r.account_id,
      amount: r.amount,
      isoCurrencyCode: r.iso_currency_code,
      category: toJson(r.category),
      datetime: new Date(r.datetime),
      name: r.name,
      merchantName: r.merchant_name,
      paymentChannel: r.payment_channel,
      pending: r.pending,
      pendingTransactionId: r.pending_transaction_id,
      predictedCategory: predicted.get(r.transaction_id) ?? null,
    };
    await prisma.plaidTransaction.upsert({
      where: { transactionId: r.transaction_id },
      create: { transactionId: r.transaction_id, ...data },
      update: data,
    });
  }

  return {
    PlaidInstitution: rows.institutions.length,
    PlaidItem: rows.items.length,
    PlaidAccount: rows.accounts.length,
    PlaidTransaction: rows.transactions.length,
    TransactionCategory: rows.categories.length,
  };
}

// ---- Entry point ------------------------------------------------------------

async function main(): Promise<void> {
  const fixture = process.argv.includes("--fixture");
  const ownerEmail = process.env.OWNER_EMAIL || DEFAULT_OWNER_EMAIL;

  const owner = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (!owner) {
    throw new Error(`Owner user not found for OWNER_EMAIL="${ownerEmail}". Create/seed that user first.`);
  }

  let rows: SourceRows;
  let fernetKey: string;
  if (fixture) {
    const fx = await import("./fixtures/portfolio-fixture");
    rows = fx.fixtureRows;
    fernetKey = fx.FIXTURE_FERNET_KEY;
    console.log("Reading bundled fixture (--fixture).");
  } else {
    const oldUrl = process.env.OLD_DATABASE_URL;
    fernetKey = process.env.OLD_FERNET_KEY || "";
    if (!oldUrl || !fernetKey) {
      throw new Error("OLD_DATABASE_URL and OLD_FERNET_KEY must both be set (or pass --fixture).");
    }
    rows = await readFromPg(oldUrl);
    console.log(`Read from OLD_DATABASE_URL.`);
  }

  const counts = await migrate(rows, owner.id, fernetKey);
  console.log(`Migrated to owner "${ownerEmail}":`, counts);
  console.log("Done. Run analyzeUser on the next sync — nothing is analyzed here.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });
