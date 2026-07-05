// PBudget V2 vendor catalog (F4, FR2) — a ONE-TIME authored artifact, not a build
// step. Each entry is a ready-made vendor a user can instantiate (a one-time COPY
// into their own editable vendor list; no live link back to the catalog).
//
// PROVENANCE: every merchant/name string and its category outcome below is a
// faithful translation of the OLD categorization funnel, read from the Portfolio
// repo git history at commit e8e10b8~1, file:
//   App/airflow_tasks/dags/transaction_processor/process_transaction.py
// (funcs predicted_category_funnel / default_categories_funnel / name_funnel).
// The funnel's `contains(merchant_name, {...})` -> a merchant "contains" row;
// `contains(name, {...})` -> a name "contains" row; `payment_channel == X` ->
// paymentChannel; `detailed_category`/`primary_category` -> plaidDetailed/
// plaidPrimary; amount bounds -> amountMin/amountMax (signed dollars, Plaid
// convention: + = outflow). The legacy `default_categories` gate (a coarse
// pre-PFC label array with no V2 equivalent) is dropped — the merchant/name
// contains-string is the real signal. Suggested categories use F6's seeded set
// (src/lib/categories.ts DEFAULT_CATEGORIES); the funnel outcomes Ignore/Unknown/
// BigPayment were never categories and map to Transfer / omitted / (n/a).
//
// Buckets (Self / General Bank / General Spending) fold the funnel's non-merchant
// lines (overrides, e-transfer/transfer noise, bank fees & rebates, and the pure
// PFC category rules) so every historical transaction has a catalog path and the
// unmatched queue can reach zero (PRD assumption 4).

import { ICON_SLUGS } from "./icons";

// ---- Public shape (what the API + instantiate consume) ----------------------

export type CatalogCondition = {
  order: number;
  categoryName: string; // seeded category name (the row's outcome)
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

export type CatalogEntry = {
  slug: string; // stable id (kebab of name); used by search + instantiate
  name: string; // display name
  icon: string | null; // bundled icon slug | null → letter avatar
  categoryName: string | null; // optional vendor DEFAULT category (FR3 fallback)
  conditions: CatalogCondition[]; // ≥1, ordered; first match decides category
};

// ---- Authoring helpers (compact internal row builders) ----------------------

type Row = {
  category: string;
  merchant?: string; // merchant "contains"
  name?: string; // name "contains"
  nameEquals?: string;
  channel?: string;
  plaidPrimary?: string;
  plaidDetailed?: string;
  amountMin?: number;
  amountMax?: number;
};
type EntryDef = { name: string; icon?: string; category?: string; rows: Row[] };

// merchant-contains row
const m = (category: string, merchant: string, extra: Partial<Row> = {}): Row => ({ category, merchant, ...extra });
// name-contains row
const n = (category: string, name: string, extra: Partial<Row> = {}): Row => ({ category, name, ...extra });

// A plain in-store merchant entry (funnel required payment_channel == "in store").
const inStore = (category: string) => (name: string, merchant = name): EntryDef => ({ name, rows: [m(category, merchant, { channel: "in store" })] });
// A plain merchant entry with no channel constraint.
const plain = (category: string) => (name: string, merchant = name): EntryDef => ({ name, rows: [m(category, merchant)] });

const resto = inStore("Restaurant");
const store = inStore("In-Store Shopping");
const grocery = plain("Grocery");
const pet = plain("Pet");
const feeM = plain("Fee");
const income = plain("Other Income");

// ---- Merchant entries -------------------------------------------------------

const MERCHANTS: EntryDef[] = [
  // -- Food delivery (predicted_category_funnel: FOOD_AND_DRINK + merchant/name) --
  { name: "Uber Eats", icon: "ubereats", rows: [m("Food Delivery", "Uber Eats", { plaidPrimary: "FOOD_AND_DRINK" }), n("Food Delivery", "Uber Eats")] },
  { name: "Domino's", rows: [m("Food Delivery", "Domino's", { plaidPrimary: "FOOD_AND_DRINK" })] },
  plain("Food Delivery")("Antalya Charcoal Kebab"),
  plain("Food Delivery")("Gyubee Japanese Grill"),
  plain("Food Delivery")("Uncle Tetsu"),
  { name: "Fantuan", rows: [n("Food Delivery", "Fantuan")] },

  // -- Coffee/Restaurant --
  { name: "Starbucks", icon: "starbucks", rows: [m("Restaurant", "Starbucks", { plaidDetailed: "FOOD_AND_DRINK_COFFEE" })] },
  { name: "McDonald's", icon: "mcdonalds", rows: [m("Restaurant", "McDonald's", { channel: "in store" })] },
  resto("Coco"),
  resto("Yunshangrice"),
  resto("Zoup"),
  resto("NYF"),
  resto("Shaoshao Hotpot"),
  resto("Top Chicken"),
  resto("Ben Thanh Viet Thai"),
  resto("Mizu Restaurant"),
  resto("Hong Kong Seafood", "Hong Kong Seafood Rest"),
  resto("Sang-Ji Fried Bao", "Ji Fried Bao"),
  resto("Lucullus Bakery", "Lucullus"),
  resto("A Perfect Meat Bowl"),
  resto("Yifang Taiwan Fruit Tea"),
  resto("Shuyi Tealicious"),
  resto("Mr. Sun", "Mr.sun"),
  resto("Shudaxia Hotpot"),
  resto("Thai Express"),
  resto("Umi Teriyaki & Sushi", "Umi Teriyaki"),
  resto("The Alley"),
  resto("Best Friend Chinese"),
  resto("Sam's Chinese"),
  resto("Tim Hortons"),
  resto("Red Lobster"),
  resto("Taste Of Taiwan", "Taste Of Taiwan"),
  resto("Tandoori Zaika"),
  resto("Daldongnae"),
  resto("The Owl Of Minerva"),
  resto("Gol's Lanzhou Noodle"),
  resto("Subway"),
  resto("Booster Juice"),
  resto("Sushi Stars"),
  resto("Akko Cake House"),
  resto("Ian Cakery"),
  resto("Langdon Hall"),
  resto("Yummy Chongqing"),
  resto("Sansotei Ramen"),
  resto("Conestoga Bloom"),
  resto("Famous Wok"),
  resto("Yunnan Steam Fish Pot"),
  resto("Tsujiri"),
  resto("Derek & Laura", "Derek & Laura"),
  resto("La La Bakeshop"),
  resto("Kin Gyu Japanese Grill"),
  resto("Mac's Sushi"),
  resto("Cobs Bread"),
  resto("Hongs Mymy Chicken"),
  resto("The Green Isle"),
  resto("Taro's Fish"),
  resto("Hey Chefz"),
  resto("Second Cup"),
  resto("Manon Bakery"),
  resto("Matcha Yuzu"),
  resto("Rain & Sunny Chinese Noodle", "Rain & Sunny Chinese Noo"),
  resto("Popeyes"),
  resto("Loobapbap"),
  resto("Yunshangricenoodle"),
  { name: "Nian Yi Kuai Zi", rows: [n("Restaurant", "NIAN YI KUAI ZI", { channel: "in store" })] },
  { name: "The Keg", rows: [n("Restaurant", "KEG", { channel: "in store" })] },
  { name: "iShawarma", rows: [n("Restaurant", "ISHAWARMA", { channel: "in store" })] },

  // -- Grocery --
  grocery("Kitchener W.M.", "Kitchener Wm"),
  grocery("T&T Supermarket", "T&t Supermarket"),
  grocery("FreshCo", "Freshco"),
  grocery("Sobeys"),
  grocery("Food Basics"),
  grocery("Fresh Palace Supermarket"),
  grocery("Foody Mart"),
  grocery("Costco"),
  grocery("Foody World"),
  grocery("Asia Food Mart"),
  grocery("Waterloo Central Supermarket", "Waterloo Central Supermar"),
  grocery("Factor Meals", "Factor"),
  { name: "Sunrise Supermarket", rows: [m("Grocery", "Sunrise", { channel: "in store" })] },

  // -- Games / digital --
  { name: "Steam", icon: "steam", rows: [n("Game", "Steam Games")] },
  { name: "Apple", icon: "apple", rows: [m("Game", "Apple")] },
  plain("Game")("Tebex"),
  plain("Game")("Mind Games"),
  { name: "401 Games", rows: [n("Game", "401 GAMES")] },
  { name: "PlayerAuctions", rows: [m("Game", "Playerauctions"), n("Game", "PLAYERAUCTIONS")] },
  plain("Game")("Xsolla Netmarble", "Xsolla Netmarb"),
  plain("Game")("Eneba"),

  // -- Utility --
  { name: "City of Kitchener", rows: [n("Utility", "City of Kitchener")] },
  { name: "Kitchener-Wilmot Hydro", rows: [n("Utility", "KITCHENER-WILMOT HYDRO")] },

  // -- Entertainment --
  plain("Entertainment")("African Lion Safari", "African Lion"),
  plain("Entertainment")("Mirvish Productions"),
  plain("Entertainment")("Cirque du Soleil", "Cirquesoleil"),
  plain("Entertainment")("KW Tickets", "Kw Tickets"),
  plain("Entertainment")("Cambridge Butterfly Conservatory", "Cambridge Butterfly Conse"),
  plain("Entertainment")("Ra-Compass The Aud", "Ra-compass-the Aud"),
  plain("Entertainment")("Lyndon Fishing Pond"),

  // -- Online shopping --
  { name: "Walmart", rows: [m("Online Shopping", "Walmart", { channel: "online" }), m("In-Store Shopping", "Walmart", { channel: "in store" })] },
  { name: "Shopperplus", rows: [m("Online Shopping", "Shopperplus", { channel: "online" })] },
  { name: "Groupon", icon: "groupon", rows: [m("Online Shopping", "Groupon", { channel: "online" })] },
  plain("Online Shopping")("Atlas Headrest", "Atlasheadre"),
  { name: "Adidas", icon: "adidas", rows: [m("Online Shopping", "Adidascanad", { channel: "online" })] },
  plain("Online Shopping")("Temu"),
  plain("Online Shopping")("Zenni Optical", "Zenniopticl"),
  plain("Online Shopping")("Best Buy", "Bestbuy"),
  { name: "Uniqlo", icon: "uniqlo", rows: [m("Online Shopping", "Uniqlo", { channel: "online" })] },
  plain("Online Shopping")("Lululemon"),
  plain("Online Shopping")("Top Select", "Topselectca"),
  { name: "Taobao", icon: "taobao", rows: [n("Online Shopping", "TAOBAO.COM")] },
  { name: "Amazon", rows: [n("Online Shopping", "AMAZON")] },
  { name: "Shein", rows: [n("Online Shopping", "SHEINDISTRI")] },
  plain("Online Shopping")("Snaplii"),
  plain("Online Shopping")("Herman Miller"),
  plain("Online Shopping")("Giddy Yoyo", "Giddy Yoyo"),
  plain("Online Shopping")("Jo Malone"),
  { name: "Alipay", icon: "alipay", rows: [m("Online Shopping", "Alipay", { channel: "in store" })] },
  { name: "Silver Gold Bull", rows: [m("Online Shopping", "Silver Gold")] },

  // -- In-store shopping --
  store("Sheridan Nurseries"),
  store("The Home Depot"),
  store("Dollarama"),
  { name: "IKEA", icon: "ikea", rows: [m("In-Store Shopping", "IKEA", { channel: "in store" })] },
  store("Linen Chest"),
  store("Lids"),
  store("Planet Health Pharmacy"),
  store("Calvin Klein"),
  store("Jysk", "Jysk"),
  store("Bunny Munnie"),
  store("Toys R Us", "Toys R"),
  store("Old Navy"),
  store("Yorkdale"),
  store("Canada Computers"),
  store("Quilts Etc", "Quilts"),
  store("La Vie En Rose"),
  store("Staples", "Staples"),
  store("Your Dollar Store"),
  store("Party City"),
  store("QE Home", "Qe Home"),
  store("La Senza"),
  store("LCBO", "Lcbo"),
  store("Shoppers Drug Mart", "Shoppers Drug"),
  store("Zwilling"),
  store("World Tea House"),
  store("Marshalls"),
  store("Talize"),
  store("Value Hunt"),
  store("Hudson's Bay", "Hudson's Bay"),
  store("Vincenzo's"),
  store("Sanya Zhong Mian Shop"),
  store("Krazy Binz"),
  store("L'Amour", "Lamour"),
  store("Canadian Tire"),
  store("The Brick"),
  store("Crystal Clear Water"),
  store("Canada Post", "Cpc Scp"),
  store("Brown's"),
  { name: "Winners", rows: [n("In-Store Shopping", "WINNERS")] },
  { name: "Casper", rows: [n("In-Store Shopping", "SP CASPER", { channel: "in store" })] },
  { name: "Polo Factory Store", rows: [n("In-Store Shopping", "POLO FACTORY STORE", { channel: "in store" })] },
  { name: "Coach", rows: [n("In-Store Shopping", "COACH", { channel: "in store" })] },
  { name: "CCS Toronto", rows: [m("In-Store Shopping", "Ccs Toronto", { channel: "online" })] },

  // -- Pet --
  pet("Global Pet Foods"),
  pet("Pet Valu"),
  pet("Big Al's Aquarium"),
  pet("Chewy", "Chewycanada"),
  pet("KW Humane Society", "Kitchener Waterloo Humane"),
  pet("Ren's Pets"),

  // -- Travel --
  { name: "Air Canada", icon: "aircanada", rows: [m("Travel", "Air Canada"), n("Travel", "AIR CAN")] },
  { name: "Air China", icon: "airchina", rows: [n("Travel", "AIR CHINA")] },
  { name: "Ctrip", icon: "tripdotcom", rows: [n("Travel", "CTRIP")] },
  { name: "Royal Caribbean", rows: [n("Travel", "Royal Caribbean")] },
  { name: "Shanghai Disney", rows: [n("Travel", "Disney SHANGHAI")] },

  // -- Baby --
  plain("Baby")("Once Upon A Child"),
  plain("Baby")("Westcoast Kids", "Westcoast"),
  plain("Baby")("Guelph Foto Source", "Ls Guelph Foto Source"),
  plain("Baby")("Birth Certificate (MPBSD)", "Mpbsd So Birth Other Ce"),

  // -- Recurring --
  plain("Recurring")("Gore Mutual Insurance", "Insurance Gore Mutual"),
  plain("Recurring")("City of Toronto Taxes", "Taxes Toronto"),
  plain("Recurring")("TSCC (Condo Fees)", "Tscc No"),
  plain("Recurring")("Reliance Home Comfort"),
  { name: "Rogers", rows: [n("Recurring", "ROGERS")] },
  { name: "Bell Canada", rows: [n("Recurring", "Bell Canada")] },
  { name: "Unica", rows: [n("Recurring", "UNICA")] },
  // Fido / Virgin Plus: funnel splits by amount — >= $100 is a Fee, else Recurring.
  { name: "Fido", rows: [m("Fee", "Fido", { amountMin: 100 }), m("Recurring", "Fido")] },
  { name: "Virgin Plus", rows: [m("Fee", "Virgin Plus", { amountMin: 100 }), m("Recurring", "Virgin Plus")] },

  // -- Fee (services/government/medical) --
  feeM("Toronto Services (TSD)", "Tsd So"),
  feeM("Immigration Canada"),
  feeM("CSRA"),
  feeM("Lifeline Fire Protection", "Lifeline Fire Protect"),
  feeM("Kitchener Finance"),
  feeM("Belmont Medical Centre"),
  feeM("Mercedes-Benz Kitchener", "Mercedes-benz Kitchner"),
  feeM("CAA Insurance", "Caa Insurance"),
  feeM("Avis"),
  feeM("Plaid Inc.", "Plaid Inc."),
  feeM("Grand River Hospital"),
  feeM("China Bridge Group"),
  feeM("Halton Hills"),
  feeM("CRA", "CRA"),
  feeM("CFIA Store Front", "Cfia Acia Store Front"),

  // -- Other income (reimbursements) --
  income("Massageworks"),
  income("Clearly", "Clearly Ecomm"),
  income("Westheights Chiropractic"),
  income("Dr. Johal And Associates"),
  { name: "Navan", rows: [n("Other Income", "NAVAN, INC. MSP")] },
  { name: "League Inc.", rows: [n("Other Income", "LEAGUE, INC.")] },
];

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

function toCondition(r: Row, order: number): CatalogCondition {
  const c: CatalogCondition = { order, categoryName: r.category };
  if (r.merchant) { c.merchantOp = "contains"; c.merchantValue = r.merchant; }
  if (r.name) { c.nameOp = "contains"; c.nameValue = r.name; }
  if (r.nameEquals) { c.nameOp = "equals"; c.nameValue = r.nameEquals; }
  if (r.channel) c.paymentChannel = r.channel;
  if (r.plaidPrimary) c.plaidPrimary = r.plaidPrimary;
  if (r.plaidDetailed) c.plaidDetailed = r.plaidDetailed;
  if (r.amountMin != null) c.amountMin = r.amountMin;
  if (r.amountMax != null) c.amountMax = r.amountMax;
  return c;
}

function build(defs: EntryDef[]): CatalogEntry[] {
  return defs.map((d) => ({
    slug: slugify(d.name),
    name: d.name,
    icon: d.icon ?? null,
    // Vendor DEFAULT category (FR3 fallback) = explicit, else the first row's.
    categoryName: d.category ?? d.rows[0]?.category ?? null,
    conditions: d.rows.map((r, i) => toCondition(r, i)),
  }));
}

export const CATALOG: CatalogEntry[] = build([...MERCHANTS, ...BUCKETS]);

// Slugs must be unique (they identify entries for instantiate). Fail loudly at
// module load if an authoring collision ever slips in.
{
  const seen = new Set<string>();
  for (const e of CATALOG) {
    if (seen.has(e.slug)) throw new Error(`Duplicate catalog slug: ${e.slug} (${e.name})`);
    seen.add(e.slug);
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

// Re-export so callers (F10 icon picker) get the icon list from one import.
export { ICON_SLUGS };
