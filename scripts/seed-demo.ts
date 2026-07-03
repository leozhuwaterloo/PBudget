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

// --- Upserts ----------------------------------------------------------------

async function upsertTxn(f: Fx): Promise<void> {
  const category = f.primary
    ? JSON.stringify({ primary: f.primary, detailed: `${f.primary}_OTHER`, confidence_level: "HIGH" })
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
    paymentChannel: "online",
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

  // Vendor A is seeded already approved (the only non-default vendor state); the
  // analyzer (F1) upserts the rest as pending on its first run.
  await prisma.vendor.upsert({
    where: { userId_name: { userId: USER_ID, name: "vendor a" } },
    create: { userId: USER_ID, name: "vendor a", status: "approved", decidedAt: now },
    update: { status: "approved", decidedAt: now },
  });
}

async function main(): Promise<void> {
  const phase2 = process.argv.includes("--phase2");
  await seedBase();
  for (const f of PHASE1) await upsertTxn(f);
  if (phase2) {
    for (const f of PHASE2) await upsertTxn(f);
  }
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
