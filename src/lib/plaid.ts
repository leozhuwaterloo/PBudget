import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
  type Transaction,
} from "plaid";
import crypto from "node:crypto";
import { prisma } from "./db";
import { encrypt, decrypt } from "./crypto";
import { plaidCategoryName, deletedCategoryNames } from "./categories";

// ---- Client --------------------------------------------------------------

let _client: PlaidApi | null = null;
function client(): PlaidApi {
  if (_client) return _client;
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) throw new Error("Plaid credentials not configured (PLAID_CLIENT_ID/PLAID_SECRET)");
  const env = (process.env.PLAID_ENV || "sandbox") as keyof typeof PlaidEnvironments;
  _client = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env],
      baseOptions: { headers: { "PLAID-CLIENT-ID": clientId, "PLAID-SECRET": secret } },
    })
  );
  return _client;
}

function countryCodes(): CountryCode[] {
  return (process.env.PLAID_COUNTRY_CODES || "CA")
    .split(",")
    .map((c) => c.trim() as CountryCode);
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// Public https endpoint Plaid POSTs transaction updates to. Only set on a
// publicly-reachable https origin — Plaid can't call localhost, so local dev links
// omit it (undefined = no webhook) and stay manual-sync only.
function webhookUrl(): string | undefined {
  const base = process.env.APP_URL;
  return base && base.startsWith("https://") ? `${base}/api/plaid/webhook` : undefined;
}

// ---- Link / token --------------------------------------------------------

export async function createLinkToken(userId: string): Promise<string> {
  const resp = await client().linkTokenCreate({
    client_name: "PBudget",
    user: { client_user_id: userId },
    products: [Products.Transactions],
    country_codes: countryCodes(),
    language: "en",
    webhook: webhookUrl(),
  });
  return resp.data.link_token;
}

// Register the webhook URL on an already-linked item (createLinkToken covers new
// links; this backfills existing ones). No-op in local dev where webhookUrl() is unset.
export async function updateItemWebhook(stored: string): Promise<void> {
  const url = webhookUrl();
  if (!url) return;
  await client().itemWebhookUpdate({ access_token: decrypt(stored), webhook: url });
}

// Update mode (re-auth / account selection) for an existing item.
export async function createUpdateLinkToken(userId: string, accessToken: string): Promise<string> {
  const resp = await client().linkTokenCreate({
    client_name: "PBudget",
    user: { client_user_id: userId },
    country_codes: countryCodes(),
    language: "en",
    access_token: accessToken,
    update: { account_selection_enabled: true },
  });
  return resp.data.link_token;
}

export async function exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }> {
  const resp = await client().itemPublicTokenExchange({ public_token: publicToken });
  return { accessToken: resp.data.access_token, itemId: resp.data.item_id };
}

// ---- Sync (ports App/plaid/update_item/tasks.py:_update_item) -------------

const PAGE = 500;
const LOOKBACK_DAYS = 180;

async function transactionsGet(accessToken: string, start: string, end: string, offset: number) {
  // Plaid sometimes returns PRODUCT_NOT_READY right after link; retry a few times.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const resp = await client().transactionsGet({
        access_token: accessToken,
        start_date: start,
        end_date: end,
        options: { count: PAGE, offset },
      });
      return resp.data;
    } catch (e: any) {
      lastErr = e;
      const code = e?.response?.data?.error_code;
      if (code !== "PRODUCT_NOT_READY") throw e;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// Upsert the item, its institution, accounts, and transactions. Returns counts.
export async function syncItem(
  userId: string,
  accessToken: string
): Promise<{ itemId: string; accounts: number; transactions: number }> {
  const now = new Date();
  const end = isoDate(now);
  const start = isoDate(new Date(now.getTime() - LOOKBACK_DAYS * 86400000));

  let offset = 0;
  let data = await transactionsGet(accessToken, start, end, offset);
  const itemId = data.item.item_id;
  const institutionId = data.item.institution_id;

  // institution
  if (institutionId) {
    const exists = await prisma.plaidInstitution.findUnique({ where: { institutionId } });
    if (!exists) {
      let name = institutionId;
      let primaryColor: string | null = null;
      let url: string | null = null;
      let logo: string | null = null;
      try {
        const inst = (
          await client().institutionsGetById({
            institution_id: institutionId,
            country_codes: countryCodes(),
            options: { include_optional_metadata: true },
          })
        ).data.institution;
        name = inst.name;
        primaryColor = inst.primary_color ?? null;
        url = inst.url ?? null;
        logo = inst.logo ?? null;
      } catch {
        // ponytail: institution metadata is best-effort; fall back to the id as name.
      }
      await prisma.plaidInstitution.create({ data: { institutionId, name, primaryColor, url, logo } });
    }
  }

  // item (encrypt access token at rest)
  const encrypted = encrypt(accessToken);
  await prisma.plaidItem.upsert({
    where: { itemId },
    create: {
      itemId,
      userId,
      institutionId: institutionId ?? itemId,
      accessToken: encrypted,
      lastForceRefreshed: now,
    },
    // disconnectedAt: null reactivates a previously-removed connection when the user
    // resubscribes and re-links the same bank (fresh token → live again).
    update: { accessToken: encrypted, disconnectedAt: null, ...(institutionId ? { institutionId } : {}) },
  });

  // accounts
  for (const a of data.accounts) {
    const fields = {
      name: a.name,
      officialName: a.official_name ?? null,
      accountType: String(a.type),
      accountSubtype: a.subtype ? String(a.subtype) : null,
      available: a.balances.available ?? null,
      current: a.balances.current ?? null,
      limit: a.balances.limit ?? null,
      isoCurrencyCode: a.balances.iso_currency_code ?? null,
    };
    await prisma.plaidAccount.upsert({
      where: { accountId: a.account_id },
      create: { accountId: a.account_id, itemId, ...fields },
      update: fields,
    });
  }

  // transactions (paginated, same loop as the original)
  let total = data.total_transactions;
  let batch = data.transactions;
  while (true) {
    await saveTransactions(userId, batch);
    if (offset + PAGE >= total) break;
    offset += PAGE;
    data = await transactionsGet(accessToken, start, end, offset);
    total = data.total_transactions;
    batch = data.transactions;
  }

  return { itemId, accounts: data.accounts.length, transactions: total };
}

async function saveTransactions(userId: string, txns: Transaction[]): Promise<void> {
  // Ensure per-user category rows exist for every predicted category (budget 0),
  // EXCEPT names the user has deleted — those stay deleted (see DeletedCategory).
  // Transactions still display the Plaid name via resolveCategory's fallback.
  const seen = new Set<string>();
  for (const t of txns) {
    const pfc = t.personal_finance_category?.primary;
    if (pfc) seen.add(plaidCategoryName(pfc));
  }
  const dead = await deletedCategoryNames(userId);
  for (const name of seen) {
    if (dead.has(name)) continue;
    await prisma.transactionCategory.upsert({
      where: { userId_name: { userId, name } },
      create: { userId, name },
      update: {},
    });
  }

  for (const t of txns) {
    const pfc = t.personal_finance_category ?? null;
    const legacy = t.category ?? null;
    let category: string | null = null;
    if (pfc || legacy) {
      category = JSON.stringify({ ...(pfc ?? {}), ...(legacy ? { default_categories: legacy } : {}) });
    }
    const dt = t.datetime ? new Date(t.datetime) : new Date(`${t.date}T00:00:00Z`);
    const predictedCategory = t.personal_finance_category?.primary
      ? plaidCategoryName(t.personal_finance_category.primary)
      : null;

    const fields = {
      amount: t.amount,
      isoCurrencyCode: t.iso_currency_code ?? null,
      category,
      datetime: dt,
      name: t.name,
      merchantName: t.merchant_name ?? null,
      website: t.website ?? null, // Plaid merchant enrichment (bare domain, often null)
      paymentChannel: t.payment_channel,
      pending: t.pending,
      pendingTransactionId: t.pending_transaction_id ?? null,
      predictedCategory,
    };
    await prisma.plaidTransaction.upsert({
      where: { transactionId: t.transaction_id },
      create: { transactionId: t.transaction_id, accountId: t.account_id, ...fields },
      update: fields,
    });
  }
}

// Force a refresh at most once per day (ports _update_item_with_item_id), then re-sync.
export async function refreshAndSync(
  userId: string,
  itemId: string,
  accessToken: string,
  lastForceRefreshed: Date
): Promise<{ itemId: string; accounts: number; transactions: number }> {
  const now = new Date();
  const aDayAgo = new Date(now.getTime() - 86400000);
  if (lastForceRefreshed <= aDayAgo) {
    await client().transactionsRefresh({ access_token: accessToken });
    await prisma.plaidItem.update({ where: { itemId }, data: { lastForceRefreshed: now } });
    await new Promise((r) => setTimeout(r, 5000));
  }
  return syncItem(userId, accessToken);
}

// ---- Remove a connection (billing expiry) --------------------------------

// Remove a Plaid connection while PRESERVING its data. Revokes the item at Plaid
// (best-effort — a fake/expired token or a network blip must not block the local
// change), then soft-deletes: the PlaidItem row is KEPT (so its accounts +
// transactions stay viewable) but marked disconnected with its dead token cleared.
// Connection counting + sync skip disconnected items. `stored` is the encrypted
// accessToken as held in the DB.
export async function removeConnection(itemId: string, stored: string): Promise<void> {
  try {
    await client().itemRemove({ access_token: decrypt(stored) });
  } catch {
    // ponytail: swallow — the goal is to stop syncing locally; a live Plaid revoke
    // is best-effort. Worst case the item lingers at Plaid until its token expires.
  }
  await prisma.plaidItem.update({
    where: { itemId },
    data: { disconnectedAt: new Date(), accessToken: "" },
  });
}

// Permanently delete a connection (user-initiated on Accounts): revoke it at Plaid
// (best-effort), then HARD-delete the item row. Cascade removes its accounts and
// their transactions (and the categoryOverride/reason columns that ride on each txn).
// `stored` is the encrypted accessToken — "" for an already-disconnected item, in
// which case there's nothing to revoke.
// ponytail: per-txn annotations (splits, flags, merge legs/groups) that pointed at
// the deleted txns are left as inert orphans — every read path filters by
// `account.item.userId`, so a now-missing txn drops them from view. No orphan sweep
// until dead rows ever grow enough to matter.
export async function deleteItem(itemId: string, stored: string): Promise<void> {
  if (stored) {
    try {
      await client().itemRemove({ access_token: decrypt(stored) });
    } catch {
      // best-effort revoke; the local delete proceeds regardless (dead/expired token
      // or network blip must not strand the row).
    }
  }
  await prisma.plaidItem.delete({ where: { itemId } });
}

// ---- Webhook verification (Plaid signs each webhook with an ES256 JWT) -----

// kids are immutable, so cache the derived key forever (few ever exist).
// ponytail: unbounded Map; a handful of keys, never worth an LRU.
const _keyCache = new Map<string, crypto.KeyObject>();

async function verificationKey(kid: string): Promise<crypto.KeyObject | null> {
  const cached = _keyCache.get(kid);
  if (cached) return cached;
  const jwk = (await client().webhookVerificationKeyGet({ key_id: kid })).data.key;
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") return null;
  const key = crypto.createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: "jwk" });
  _keyCache.set(kid, key);
  return key;
}

const b64urlJson = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

// Verify a Plaid webhook per https://plaid.com/docs/api/webhooks/webhook-verification:
// ES256 signature over the raw JWT, then the body-hash + freshness claims. Any failure
// → false (reject). rawBody MUST be the exact bytes received (hash is over them).
export async function verifyWebhook(rawBody: string, signedJwt: string | null): Promise<boolean> {
  if (!signedJwt) return false;
  const parts = signedJwt.split(".");
  if (parts.length !== 3) return false;

  let header: { alg?: string; kid?: string };
  try {
    header = b64urlJson(parts[0]);
  } catch {
    return false;
  }
  // Pin ES256 — refuse "none"/RS256 to close alg-substitution attacks.
  if (header.alg !== "ES256" || !header.kid) return false;

  const key = await verificationKey(header.kid);
  if (!key) return false;

  // ES256 signatures are raw R||S (JOSE), not DER — hence dsaEncoding: ieee-p1363.
  const sigOk = crypto.verify(
    "sha256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    { key, dsaEncoding: "ieee-p1363" },
    Buffer.from(parts[2], "base64url")
  );
  if (!sigOk) return false;

  let payload: { iat?: number; request_body_sha256?: string };
  try {
    payload = b64urlJson(parts[1]);
  } catch {
    return false;
  }
  // Replay guard: reject tokens older than 5 minutes.
  if (typeof payload.iat !== "number" || Date.now() / 1000 - payload.iat > 300) return false;

  // Body integrity: the JWT commits to sha256(rawBody).
  const expected = payload.request_body_sha256;
  const actual = crypto.createHash("sha256").update(rawBody, "utf8").digest("hex");
  if (typeof expected !== "string" || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
