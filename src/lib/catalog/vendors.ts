// PBudget V2 vendor catalog (F4, FR2) — ready-made vendors a user can instantiate
// (a one-time COPY into their own editable vendor list; no live link back).
//
// The MERCHANT entries are GENERATED from the owner's curated vendor list
// (generated.json, rebuilt by scripts/gen-catalog.ts) so the catalog mirrors a real,
// battle-tested set — each carrying its cached favicon (data URI) when small enough to
// embed. The BUCKETS below (Self / General Bank / General Spending) stay hand-authored:
// they are the 3 generic catch-alls new signups seed (CATALOG_BUCKET_SLUGS) so every
// transaction gets a category path and the unmatched queue can reach zero.

import GENERATED from "./generated.json";

// ---- Public shape (what the API + instantiate consume) ----------------------

export type CatalogCondition = {
  order: number;
  categoryName?: string; // outcome (category rules only; omitted for match rows)
  nameOp?: string;
  nameValue?: string;
  merchantOp?: string;
  merchantValue?: string;
  paymentChannel?: string;
  plaidPrimary?: string;
  plaidDetailed?: string;
  amountMin?: number; // signed dollars
  amountMax?: number;
};

// Two-stage vendor: `matchConditions` decide identity (any → the vendor claims the
// txn); `categoryRules` refine the category (first match → its categoryName, else
// the default).
export type CatalogEntry = {
  slug: string; // stable id (kebab of name); used by search + instantiate
  name: string; // display name
  link: string | null; // Google Maps / website URL | null
  icon?: string | null; // cached favicon data URI (embedded when small); null → letter avatar
  categoryName: string | null; // vendor DEFAULT category (FR3 fallback)
  matchConditions: CatalogCondition[]; // identity rows
  categoryRules: CatalogCondition[]; // refinement rows (each has a categoryName)
};

// ---- Authoring helpers (compact internal row builders, used by the buckets) --

type Row = {
  category: string;
  merchant?: string; // merchant "contains"
  name?: string; // name "contains"
  channel?: string;
  plaidPrimary?: string;
  plaidDetailed?: string;
  amountMin?: number;
  amountMax?: number;
};
type EntryDef = { name: string; category?: string; rows: Row[] };

// merchant-contains row
const m = (category: string, merchant: string, extra: Partial<Row> = {}): Row => ({ category, merchant, ...extra });
// name-contains row
const n = (category: string, name: string, extra: Partial<Row> = {}): Row => ({ category, name, ...extra });

// ---- Bucket entries (non-merchant funnel lines) -----------------------------

const BUCKETS: EntryDef[] = [
  {
    // Personal transfers between the user's own / family accounts, and the old
    // override_funnel "Ignore"/"Transfer" intents (transaction-id overrides for
    // wife transfers, FX to family, cancelled/reclaimed e-transfers). Category
    // Transfer is excluded from totals (F6).
    name: "Self / Personal Transfers",
    rows: [
      n("Transfer", "INTERAC E-TRANSFER"),
      n("Transfer", "E-TFR"),
      n("Transfer", "SEND E-TFR"),
      n("Transfer", "CANCEL E-TFR"),
      n("Transfer", "RECLAIM E-TFR"),
      n("Transfer", "Online Banking transfer"),
      n("Transfer", "TFR-TO C/C"),
      n("Transfer", "Customer Transfer Dr."),
      n("Transfer", "SCOTIABANK TRANSIT"),
      n("Transfer", "Request Money LICHEN ZHU"),
      n("Transfer", "QIAOXU YE"),
      m("Transfer", "SSV", { plaidDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER" }),
      { category: "Transfer", name: "INVESTMENT PURCHASE", plaidPrimary: "TRANSFER_OUT" },
    ],
  },
  {
    // Bank-generated noise: ABM/monthly fees, credit-card payments, PTS/SSV bank
    // transfers, interest earned, and government/loyalty rebates.
    name: "General Bank",
    rows: [
      n("Fee", "ABM FEE"),
      n("Fee", "Monthly fee"),
      n("Fee", "MultiProduct rebate"),
      n("Fee", "ACCT BAL REBATE"),
      { category: "Fee", plaidPrimary: "BANK_FEES" },
      n("Transfer", "PREAUTHORIZED PAYMENT"),
      n("Transfer", "PAYMENT - THANK YOU"),
      n("Transfer", "PTS FRM:"),
      n("Transfer", "SSV FRM:"),
      { category: "Transfer", plaidDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" },
      n("Other Income", "MOBILE DEPOSIT"),
      n("Other Income", "Canada Carbon Rebate"),
      n("Other Income", "Tax Refund"),
      n("Other Income", "TD Points Redemption"),
      n("Other Income", "GST"),
      { category: "Other Income", plaidDetailed: "INCOME_INTEREST_EARNED" },
    ],
  },
  {
    // Broad Plaid-category catch-alls (the funnel's pure primary/detailed rules,
    // no merchant). Instantiate LAST to sweep whatever the merchant vendors and
    // the other buckets didn't claim, so the unmatched queue can reach zero.
    name: "General Spending",
    rows: [
      { category: "Grocery", plaidDetailed: "FOOD_AND_DRINK_GROCERIES" },
      { category: "Restaurant", plaidDetailed: "FOOD_AND_DRINK_COFFEE" },
      { category: "Game", plaidDetailed: "ENTERTAINMENT_VIDEO_GAMES" },
      { category: "Entertainment", plaidDetailed: "ENTERTAINMENT_TV_AND_MOVIES" },
      { category: "Entertainment", plaidDetailed: "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS" },
      { category: "Online Shopping", plaidDetailed: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES", channel: "online" },
      { category: "Pet", plaidDetailed: "GENERAL_MERCHANDISE_PET_SUPPLIES" },
      { category: "Pet", plaidDetailed: "MEDICAL_VETERINARY_SERVICES" },
      { category: "Gas", plaidDetailed: "TRANSPORTATION_GAS" },
      { category: "Fee", plaidDetailed: "TRANSPORTATION_PARKING" },
      { category: "Fee", plaidDetailed: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES" },
      { category: "Cash", plaidDetailed: "TRANSFER_OUT_WITHDRAWAL" },
      { category: "Travel", plaidPrimary: "TRAVEL" },
      { category: "Income", plaidPrimary: "INCOME" },
    ],
  },
];

// ---- Build the public catalog -----------------------------------------------

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// `withCategory=false` emits a match row (identity, no outcome); true emits a
// category rule (carries its category).
function toCondition(r: Row, order: number, withCategory: boolean): CatalogCondition {
  const c: CatalogCondition = withCategory ? { order, categoryName: r.category } : { order };
  if (r.merchant) { c.merchantOp = "contains"; c.merchantValue = r.merchant; }
  if (r.name) { c.nameOp = "contains"; c.nameValue = r.name; }
  if (r.channel) c.paymentChannel = r.channel;
  if (r.plaidPrimary) c.plaidPrimary = r.plaidPrimary;
  if (r.plaidDetailed) c.plaidDetailed = r.plaidDetailed;
  if (r.amountMin != null) c.amountMin = r.amountMin;
  if (r.amountMax != null) c.amountMax = r.amountMax;
  return c;
}

// Fold an authored bucket into the two-stage shape. All rows share one category →
// identity match conditions + that default; rows disagree → category rules.
function build(defs: EntryDef[]): CatalogEntry[] {
  return defs.map((d) => {
    const singleCategory = new Set(d.rows.map((r) => r.category)).size <= 1;
    return {
      slug: slugify(d.name),
      name: d.name,
      link: null,
      icon: null,
      categoryName: d.category ?? d.rows[0]?.category ?? null,
      matchConditions: singleCategory ? d.rows.map((r, i) => toCondition(r, i, false)) : [],
      categoryRules: singleCategory ? [] : d.rows.map((r, i) => toCondition(r, i, true)),
    };
  });
}

// Generated merchants (owner-curated, with icons) first, then the 3 catch-all buckets.
export const CATALOG: CatalogEntry[] = [...(GENERATED as CatalogEntry[]), ...build(BUCKETS)];

// Slugs of the 3 generic catch-all buckets — new signups seed only these; the rest
// is opt-in per merchant.
export const CATALOG_BUCKET_SLUGS: Set<string> = new Set(BUCKETS.map((b) => slugify(b.name)));

// Slugs must be unique (they identify entries for instantiate); every entry must
// carry a default category (instantiate copies it straight in, bypassing the guard).
// Fail loudly at module load if either invariant ever breaks.
{
  const seen = new Set<string>();
  for (const e of CATALOG) {
    if (seen.has(e.slug)) throw new Error(`Duplicate catalog slug: ${e.slug} (${e.name})`);
    seen.add(e.slug);
    if (!e.categoryName) throw new Error(`Catalog entry has no default category: ${e.slug} (${e.name})`);
  }
}

export function findCatalogEntry(slug: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.slug === slug);
}

// Case-insensitive substring search over the display name (list + text search,
// FR2). Empty query returns the whole catalog.
export function searchCatalog(query: string): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return CATALOG;
  return CATALOG.filter((e) => e.name.toLowerCase().includes(q));
}
