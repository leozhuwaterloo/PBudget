// Demo seed (FR9) — the verification backbone. Idempotent via fixed IDs.
//   npm run seed:demo            # phase 1: user + accounts + fixture inventory
//   npm run seed:demo -- --phase2 # + phase-2 injections (posted replacement, new txns)
// Both phases end by re-running analyzeUser (a no-op until F1 lands).
//
// Sign convention (Plaid): positive amount = money OUT (charge), negative = IN
// (refund/credit). See SPEC "Demo fixtures".
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";
import { humanize } from "../src/lib/categories";
import { analyzeUser } from "../src/lib/analysis/analyze";
import { createMergeGroup } from "../src/lib/analysis/merge";

const USER_ID = "demo-user";
const EMAIL = "demo@pbudget.local";
const PASSWORD = "demo-pbudget-2026";
const INST_ID = "demo-inst";
const ITEM_ID = "demo-item";
const CHEQUING = "demo-acct-chequing";
const SAVINGS = "demo-acct-savings";
const CURRENCY = "CAD";

const now = new Date();
const daysAgo = (n: number): Date => new Date(now.getTime() - n * 86400000);

type Fx = {
  id: string;
  account: string;
  amount: number; // Plaid sign: + = money out
  name: string;
  merchant: string | null;
  primary: string | null; // Plaid pfc primary → category JSON + predictedCategory
  daysAgo: number;
  pending?: boolean;
  replaces?: string; // pendingTransactionId (posted replacement of a pending row)
  channel?: string; // paymentChannel (default "online") — F1 channel probe
  detailed?: string; // Plaid pfc detailed (default `${primary}_OTHER`) — F1 detailed probe
};

// --- Fixture inventory ------------------------------------------------------

const PHASE1: Fx[] = [
  // Vendor A — PRE-APPROVED: priors 100/110/120 (median 110), one ≥3× (400),
  // one below-threshold (150), one refund (-50). → criterion 6
  { id: "demo-txn-a-prior-1", account: CHEQUING, amount: 100, name: "Vendor A", merchant: "Vendor A", primary: "GENERAL_MERCHANDISE", daysAgo: 20 },
  { id: "demo-txn-a-prior-2", account: CHEQUING, amount: 110, name: "Vendor A", merchant: "Vendor A", primary: "GENERAL_MERCHANDISE", daysAgo: 18 },
  { id: "demo-txn-a-prior-3", account: CHEQUING, amount: 120, name: "Vendor A", merchant: "Vendor A", primary: "GENERAL_MERCHANDISE", daysAgo: 16 },
  { id: "demo-txn-a-unusual", account: CHEQUING, amount: 400, name: "Vendor A", merchant: "Vendor A", primary: "GENERAL_MERCHANDISE", daysAgo: 5 },
  { id: "demo-txn-a-normal", account: CHEQUING, amount: 150, name: "Vendor A", merchant: "Vendor A", primary: "GENERAL_MERCHANDISE", daysAgo: 4 },
  { id: "demo-txn-a-refund", account: CHEQUING, amount: -50, name: "Vendor A refund", merchant: "Vendor A", primary: "GENERAL_MERCHANDISE", daysAgo: 3 },

  // Vendor B — PENDING: priors 100/100/100 + one ≥3× (400). → criterion 19
  { id: "demo-txn-b-prior-1", account: CHEQUING, amount: 100, name: "Vendor B", merchant: "Vendor B", primary: "GENERAL_SERVICES", daysAgo: 19 },
  { id: "demo-txn-b-prior-2", account: CHEQUING, amount: 100, name: "Vendor B", merchant: "Vendor B", primary: "GENERAL_SERVICES", daysAgo: 17 },
  { id: "demo-txn-b-prior-3", account: CHEQUING, amount: 100, name: "Vendor B", merchant: "Vendor B", primary: "GENERAL_SERVICES", daysAgo: 15 },
  { id: "demo-txn-b-unusual", account: CHEQUING, amount: 400, name: "Vendor B", merchant: "Vendor B", primary: "GENERAL_SERVICES", daysAgo: 6 },

  // Unknown one-off vendors, one dated TODAY (counters). → criterion 1
  { id: "demo-txn-unknown-today", account: CHEQUING, amount: 45, name: "Corner Cafe", merchant: "Corner Cafe", primary: "FOOD_AND_DRINK", daysAgo: 0 },
  { id: "demo-txn-unknown-parking", account: CHEQUING, amount: 30, name: "City Parking", merchant: "City Parking", primary: "TRANSPORTATION", daysAgo: 2 },
  { id: "demo-txn-unknown-books", account: CHEQUING, amount: 75, name: "Book Nook", merchant: "Book Nook", primary: "GENERAL_MERCHANDISE", daysAgo: 8 },

  // E-transfer auto-match pair: +200/-200, two accounts, 2 days apart. → criteria 4, 17
  { id: "demo-txn-etransfer-out", account: CHEQUING, amount: 200, name: "E-Transfer sent", merchant: null, primary: "TRANSFER_OUT", daysAgo: 5 },
  { id: "demo-txn-etransfer-in", account: SAVINGS, amount: -200, name: "E-Transfer received", merchant: null, primary: "TRANSFER_IN", daysAgo: 3 },

  // Lone transfer-out, no counterpart within 4 days. → criterion 5
  { id: "demo-txn-lone-transfer", account: CHEQUING, amount: 155, name: "E-Transfer to landlord", merchant: null, primary: "TRANSFER_OUT", daysAgo: 10 },

  // Unmatched transfer pair: +275/-275, two accounts, 6 days apart (outside window). → criterion 14a
  { id: "demo-txn-unmatched-out", account: CHEQUING, amount: 275, name: "E-Transfer to savings", merchant: null, primary: "TRANSFER_OUT", daysAgo: 12 },
  { id: "demo-txn-unmatched-in", account: SAVINGS, amount: -275, name: "E-Transfer from chequing", merchant: null, primary: "TRANSFER_IN", daysAgo: 6 },

  // Vendor C — UNAPPROVED: 500 charge + -100 refund (merge → -400). → criteria 14b, 9, 10
  { id: "demo-txn-c-charge", account: CHEQUING, amount: 500, name: "Vendor C", merchant: "Vendor C", primary: "GENERAL_MERCHANDISE", daysAgo: 7 },
  { id: "demo-txn-c-refund", account: CHEQUING, amount: -100, name: "Vendor C refund", merchant: "Vendor C", primary: "GENERAL_MERCHANDISE", daysAgo: 6 },

  // Duplicate pair: same vendor, same signed amount, 1 day apart. → criterion 7
  { id: "demo-txn-dup-1", account: CHEQUING, amount: 80, name: "Quick Mart", merchant: "Quick Mart", primary: "FOOD_AND_DRINK", daysAgo: 4 },
  { id: "demo-txn-dup-2", account: CHEQUING, amount: 80, name: "Quick Mart", merchant: "Quick Mart", primary: "FOOD_AND_DRINK", daysAgo: 3 },

  // Pending transaction — invisible to analysis. → criterion 15
  { id: "demo-txn-pending", account: CHEQUING, amount: 65, name: "Pending Vendor", merchant: "Pending Vendor", primary: "FOOD_AND_DRINK", daysAgo: 1, pending: true },
];

const PHASE2: Fx[] = [
  // Posted replacement of the pending txn (NEW Plaid ID, pendingTransactionId set):
  // must be flagged, and must NOT pair with its pending original as a duplicate. → criteria 2, 3, 15, 16
  { id: "demo-txn-pending-posted", account: CHEQUING, amount: 65, name: "Pending Vendor", merchant: "Pending Vendor", primary: "FOOD_AND_DRINK", daysAgo: 0, replaces: "demo-txn-pending" },

  // New txn from the pending-status Vendor B — no re-flag once approved. → criterion 2
  { id: "demo-txn-b-new", account: CHEQUING, amount: 100, name: "Vendor B", merchant: "Vendor B", primary: "GENERAL_SERVICES", daysAgo: 0 },

  // New txn from an existing unknown vendor (City Parking) — re-flagged after reject. → criterion 3
  { id: "demo-txn-unknown-new", account: CHEQUING, amount: 40, name: "City Parking", merchant: "City Parking", primary: "TRANSPORTATION", daysAgo: 0 },
];

// --- F1 vendor-matching fixtures --------------------------------------------
// Isolated from the suspicion fixtures above: every probe carries a unique token
// in its name/merchant so vendors match exactly the intended rows. Each operator
// gets a HIT (matches) and a MISS (near-miss that does not). All positive/outflow
// and mostly CHEQUING so auto-match (opposite-sign, cross-account) never fires.
const gm = "GENERAL_MERCHANDISE";
const MATCH_FIXTURES: Fx[] = [
  // name operators
  { id: "f1-name-contains-hit", account: CHEQUING, amount: 41, name: "AA Znamecontains BB", merchant: "nc-hit", primary: gm, daysAgo: 9 },
  { id: "f1-name-contains-miss", account: CHEQUING, amount: 42, name: "Znamecontain", merchant: "nc-miss", primary: gm, daysAgo: 9 },
  { id: "f1-name-equals-hit", account: CHEQUING, amount: 43, name: "Znameequals", merchant: "ne-hit", primary: gm, daysAgo: 9 },
  { id: "f1-name-equals-miss", account: CHEQUING, amount: 44, name: "Znameequals Extra", merchant: "ne-miss", primary: gm, daysAgo: 9 },
  { id: "f1-name-starts-hit", account: CHEQUING, amount: 45, name: "Znamestarts Here", merchant: "ns-hit", primary: gm, daysAgo: 10 },
  { id: "f1-name-starts-miss", account: CHEQUING, amount: 46, name: "Not Znamestarts", merchant: "ns-miss", primary: gm, daysAgo: 10 },
  { id: "f1-name-regex-hit", account: CHEQUING, amount: 47, name: "Znameregex 7", merchant: "nr-hit", primary: gm, daysAgo: 10 },
  { id: "f1-name-regex-miss", account: CHEQUING, amount: 48, name: "Znameregex x", merchant: "nr-miss", primary: gm, daysAgo: 10 },
  // merchant operators
  { id: "f1-merch-contains-hit", account: CHEQUING, amount: 49, name: "MprobeC hit", merchant: "AA Zmerchcontains BB", primary: gm, daysAgo: 11 },
  { id: "f1-merch-contains-miss", account: CHEQUING, amount: 50, name: "MprobeC miss", merchant: "Zmerchcontain", primary: gm, daysAgo: 11 },
  { id: "f1-merch-regex-hit", account: CHEQUING, amount: 51, name: "MprobeR hit", merchant: "Shop Zmerchregex42", primary: gm, daysAgo: 11 },
  { id: "f1-merch-regex-miss", account: CHEQUING, amount: 52, name: "MprobeR miss", merchant: "Zmerchregex4", primary: gm, daysAgo: 11 },
  // amount range (anchored by a name token so the range stays isolated)
  { id: "f1-amount-hit", account: CHEQUING, amount: 75, name: "Zamount", merchant: "amt-hit", primary: gm, daysAgo: 12 },
  { id: "f1-amount-miss", account: CHEQUING, amount: 200, name: "Zamount", merchant: "amt-miss", primary: gm, daysAgo: 12 },
  // account (SAVINGS matches, CHEQUING doesn't)
  { id: "f1-account-hit", account: SAVINGS, amount: 61, name: "Zaccount", merchant: "acct-hit", primary: gm, daysAgo: 12 },
  { id: "f1-account-miss", account: CHEQUING, amount: 62, name: "Zaccount", merchant: "acct-miss", primary: gm, daysAgo: 12 },
  // payment channel
  { id: "f1-channel-hit", account: CHEQUING, amount: 63, name: "Zchannel", merchant: "chan-hit", primary: gm, daysAgo: 13, channel: "in store" },
  { id: "f1-channel-miss", account: CHEQUING, amount: 64, name: "Zchannel", merchant: "chan-miss", primary: gm, daysAgo: 13, channel: "online" },
  // plaid primary
  { id: "f1-primary-hit", account: CHEQUING, amount: 65, name: "Zprimary", merchant: "prim-hit", primary: "ENTERTAINMENT", daysAgo: 13 },
  { id: "f1-primary-miss", account: CHEQUING, amount: 66, name: "Zprimary", merchant: "prim-miss", primary: "TRAVEL", daysAgo: 13 },
  // plaid detailed (same primary, differ only on detailed → proves detailed granularity)
  { id: "f1-detailed-hit", account: CHEQUING, amount: 67, name: "Zdetailed", merchant: "det-hit", primary: "GENERAL_SERVICES", detailed: "GENERAL_SERVICES_MEMBERSHIP", daysAgo: 14 },
  { id: "f1-detailed-miss", account: CHEQUING, amount: 68, name: "Zdetailed", merchant: "det-miss", primary: "GENERAL_SERVICES", detailed: "GENERAL_SERVICES_OTHER", daysAgo: 14 },

  // Multi-match conflict: matches conf-high (name) AND conf-low (merchant). → point 4
  { id: "f1-conflict", account: CHEQUING, amount: 88, name: "Zconflict Payee", merchant: "Zconflictm Inc", primary: gm, daysAgo: 9 },
  // Unmatched target: matches no seeded vendor until check creates one. → point 4
  { id: "f1-unmatch", account: CHEQUING, amount: 33, name: "Zunmatch Me", merchant: "Zunmatch Co", primary: gm, daysAgo: 10 },
  // Manual-merge legs → net +400 (≠0). Queues via the GROUP, not the legs. → point 4
  { id: "f1-group-primary", account: CHEQUING, amount: 300, name: "Zgroup Primary", merchant: "Zgroupvendor", primary: gm, daysAgo: 11 },
  { id: "f1-group-secondary", account: CHEQUING, amount: 100, name: "Zgroup Secondary", merchant: "Zgroupvendor", primary: gm, daysAgo: 11 },
];

type CondSpec = Partial<
  Pick<
    import("@prisma/client").VendorCondition,
    | "nameOp" | "nameValue" | "merchantOp" | "merchantValue"
    | "accountId" | "paymentChannel" | "plaidPrimary" | "plaidDetailed"
  >
> & { amountMin?: number; amountMax?: number };
type VendorSpec = { name: string; priority: number; conditions: CondSpec[] };

// One vendor per operator (unique priority). conf-high/conf-low deliberately
// overlap on f1-conflict; check-analysis flips their priorities and breaks the
// overlap to exercise the conflict lifecycle.
const MATCH_VENDORS: VendorSpec[] = [
  { name: "conf-high", priority: 10, conditions: [{ nameOp: "contains", nameValue: "zconflict" }] },
  { name: "conf-low", priority: 20, conditions: [{ merchantOp: "contains", merchantValue: "zconflictm" }] },
  { name: "probe-name-contains", priority: 101, conditions: [{ nameOp: "contains", nameValue: "znamecontains" }] },
  { name: "probe-name-equals", priority: 102, conditions: [{ nameOp: "equals", nameValue: "znameequals" }] },
  { name: "probe-name-starts", priority: 103, conditions: [{ nameOp: "starts_with", nameValue: "znamestarts" }] },
  { name: "probe-name-regex", priority: 104, conditions: [{ nameOp: "regex", nameValue: "^znameregex [0-9]+$" }] },
  { name: "probe-merch-contains", priority: 105, conditions: [{ merchantOp: "contains", merchantValue: "zmerchcontains" }] },
  { name: "probe-merch-regex", priority: 106, conditions: [{ merchantOp: "regex", merchantValue: "zmerchregex[0-9]{2}" }] },
  { name: "probe-amount", priority: 107, conditions: [{ nameOp: "contains", nameValue: "zamount", amountMin: 50, amountMax: 100 }] },
  { name: "probe-account", priority: 108, conditions: [{ nameOp: "contains", nameValue: "zaccount", accountId: SAVINGS }] },
  { name: "probe-channel", priority: 109, conditions: [{ nameOp: "contains", nameValue: "zchannel", paymentChannel: "in store" }] },
  { name: "probe-primary", priority: 110, conditions: [{ nameOp: "contains", nameValue: "zprimary", plaidPrimary: "ENTERTAINMENT" }] },
  { name: "probe-detailed", priority: 111, conditions: [{ nameOp: "contains", nameValue: "zdetailed", plaidDetailed: "GENERAL_SERVICES_MEMBERSHIP" }] },
];

// Upsert vendors + rows idempotently (delete/recreate rows so re-seed converges).
async function seedVendors(): Promise<void> {
  // Clear priorities first so a re-seed over a reordered DB (check-analysis flips
  // conf-high/conf-low) can reassign the target ints without a @@unique collision.
  await prisma.vendor.updateMany({
    where: { userId: USER_ID, name: { in: MATCH_VENDORS.map((v) => v.name) } },
    data: { priority: null },
  });
  for (const v of MATCH_VENDORS) {
    const vendor = await prisma.vendor.upsert({
      where: { userId_name: { userId: USER_ID, name: v.name } },
      create: { userId: USER_ID, name: v.name, priority: v.priority },
      update: { priority: v.priority },
    });
    await prisma.vendorCondition.deleteMany({ where: { vendorId: vendor.id } });
    await prisma.vendorCondition.createMany({
      data: v.conditions.map((c, i) => ({ vendorId: vendor.id, order: i, ...c })),
    });
  }
}

// Idempotent manual merge (F1's net-≠0 group test): skip if a leg is already grouped.
async function ensureManualMerge(legIds: string[]): Promise<void> {
  const existing = await prisma.mergeGroupLeg.findFirst({
    where: { transactionId: { in: legIds } },
  });
  if (existing) return;
  await createMergeGroup(USER_ID, legIds, { status: "confirmed" });
}

// --- Upserts ----------------------------------------------------------------

async function upsertTxn(f: Fx): Promise<void> {
  const category = f.primary
    ? JSON.stringify({ primary: f.primary, detailed: f.detailed ?? `${f.primary}_OTHER`, confidence_level: "HIGH" })
    : null;
  const predictedCategory = f.primary ? humanize(f.primary) : null;
  // Mirror sync: ensure a per-user category row exists (budget 0).
  if (predictedCategory) {
    await prisma.transactionCategory.upsert({
      where: { userId_name: { userId: USER_ID, name: predictedCategory } },
      create: { userId: USER_ID, name: predictedCategory },
      update: {},
    });
  }
  const fields = {
    amount: f.amount,
    isoCurrencyCode: CURRENCY,
    category,
    datetime: daysAgo(f.daysAgo),
    name: f.name,
    merchantName: f.merchant,
    paymentChannel: f.channel ?? "online",
    pending: f.pending ?? false,
    pendingTransactionId: f.replaces ?? null,
    predictedCategory,
  };
  await prisma.plaidTransaction.upsert({
    where: { transactionId: f.id },
    create: { transactionId: f.id, accountId: f.account, ...fields },
    update: fields,
  });
}

async function seedBase(): Promise<void> {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  await prisma.user.upsert({
    where: { id: USER_ID },
    create: { id: USER_ID, email: EMAIL, passwordHash, emailVerified: now, subscriptionStatus: "active" },
    update: { email: EMAIL, passwordHash, emailVerified: now, subscriptionStatus: "active" },
  });

  await prisma.plaidInstitution.upsert({
    where: { institutionId: INST_ID },
    create: { institutionId: INST_ID, name: "Demo Bank" },
    update: { name: "Demo Bank" },
  });

  // ponytail: accessToken is a placeholder — the demo never calls Plaid.
  await prisma.plaidItem.upsert({
    where: { itemId: ITEM_ID },
    create: { itemId: ITEM_ID, userId: USER_ID, institutionId: INST_ID, accessToken: "demo-no-plaid", lastForceRefreshed: now },
    update: { userId: USER_ID, institutionId: INST_ID },
  });

  for (const [accountId, name, subtype] of [
    [CHEQUING, "Demo Chequing", "checking"],
    [SAVINGS, "Demo Savings", "savings"],
  ] as const) {
    await prisma.plaidAccount.upsert({
      where: { accountId },
      create: { accountId, itemId: ITEM_ID, name, accountType: "depository", accountSubtype: subtype, isoCurrencyCode: CURRENCY, current: 2500 },
      update: { name, itemId: ITEM_ID, isoCurrencyCode: CURRENCY },
    });
  }
  // V2 retired the approval model: the analyzer no longer upserts Vendor rows and
  // unusual_amount fires for every vendor (identity = normalized string until F1).
}

async function main(): Promise<void> {
  const phase2 = process.argv.includes("--phase2");
  await seedBase();
  for (const f of [...PHASE1, ...MATCH_FIXTURES]) await upsertTxn(f);
  if (phase2) {
    for (const f of PHASE2) await upsertTxn(f);
  }
  await seedVendors(); // F1: vendors + condition rows (before analyze so rematch sees them)
  await ensureManualMerge(["f1-group-primary", "f1-group-secondary"]); // net-≠0 group
  await analyzeUser(USER_ID);

  console.log(`\n  Demo user seeded${phase2 ? " (phase 2)" : ""}:`);
  console.log(`    email:    ${EMAIL}`);
  console.log(`    password: ${PASSWORD}`);
  console.log(`    login:    http://localhost:5300/login\n`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
