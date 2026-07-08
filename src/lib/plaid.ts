import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
  type Transaction,
} from "plaid";
import { prisma } from "./db";
import { encrypt } from "./crypto";
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

// ---- Link / token --------------------------------------------------------

export async function createLinkToken(userId: string): Promise<string> {
  const resp = await client().linkTokenCreate({
    client_name: "PBudget",
    user: { client_user_id: userId },
    products: [Products.Transactions],
    country_codes: countryCodes(),
    language: "en",
  });
  return resp.data.link_token;
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
    update: { accessToken: encrypted, ...(institutionId ? { institutionId } : {}) },
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
