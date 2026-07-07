// FR1 vendors CRUD acceptance gate (F3). Exercises the write side the routes call
// (src/lib/vendors.ts) against a throwaway user in the dev SQLite DB. Deterministic,
// no network, no dev server. Run: npm run check:vendors
//
// Covers the card's acceptance points: a new vendor matches a txn + auto-closes its
// unmatched_vendor row; a second overlapping vendor opens a vendor_conflict; reorder
// flips the winner; invalid regex / zero rows / no-field row / duplicate name are
// each rejected 400; deleting a vendor returns its txns to the unmatched queue.
import type { VendorCondition } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { rematchUser, matchesCondition } from "../src/lib/analysis/match";
import {
  VendorError,
  createVendor,
  deleteVendor,
  reorderVendors,
  listVendors,
} from "../src/lib/vendors";

const USER = "vendor-test-user";
const ITEM = "vt-item";
const ACCT = "vt-acct";
const OTHER_ACCT = "vt-acct-other-user"; // exists but belongs to nobody → account-existence probe
const TXN = "vt-txn-1";

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}
async function reject400(fn: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await fn();
    check(false, `${label}: rejected with 400`);
  } catch (e) {
    check(e instanceof VendorError && e.status === 400, `${label}: rejected with 400`);
  }
}

const openFlag = (rule: string) =>
  prisma.transactionFlag.findFirst({ where: { transactionId: TXN, rule, status: "open" } });
const anyFlag = (rule: string) =>
  prisma.transactionFlag.findFirst({ where: { transactionId: TXN, rule } });
const vendorIdOfTxn = async (): Promise<string | null> =>
  (await prisma.plaidTransaction.findUnique({ where: { transactionId: TXN } }))?.vendorId ?? null;

async function reset(): Promise<void> {
  await prisma.transactionFlag.deleteMany({ where: { userId: USER } }); // no FK cascade on user
  await prisma.user.deleteMany({ where: { id: USER } }); // cascades item→acct→txn, categories, vendors
  await prisma.user.create({ data: { id: USER, email: `${USER}@t.local`, passwordHash: "x" } });
  await prisma.transactionCategory.create({ data: { userId: USER, name: "Grocery" } });
  await prisma.plaidInstitution.upsert({
    where: { institutionId: "vt-inst" },
    create: { institutionId: "vt-inst", name: "VT Bank" },
    update: {},
  });
  await prisma.plaidItem.create({
    data: { itemId: ITEM, userId: USER, institutionId: "vt-inst", accessToken: "x", lastForceRefreshed: new Date("2026-01-01") },
  });
  await prisma.plaidAccount.create({ data: { accountId: ACCT, itemId: ITEM, name: "VT Chequing", accountType: "depository" } });
  await prisma.plaidTransaction.create({
    data: {
      transactionId: TXN, accountId: ACCT, amount: 42,
      category: JSON.stringify({ primary: "GENERAL_MERCHANDISE", detailed: "GENERAL_MERCHANDISE_OTHER" }),
      datetime: new Date("2026-01-01"), name: "Zebra Diner", merchantName: "Zebra Diner",
      paymentChannel: "online", pending: false,
    },
  });
}

async function main(): Promise<void> {
  console.log("\nChecking F3 vendors CRUD + reorder:");

  // Pure matcher: a plaidConfidence condition matches only when the txn's Plaid
  // confidence_level equals it (new FR1 field; parsed from the category JSON).
  {
    const cond = { plaidConfidence: "HIGH" } as unknown as VendorCondition;
    const txn = (level: string | null) => ({
      name: "x", merchantName: null, amount: 1, accountId: "a", paymentChannel: "online",
      category: level ? JSON.stringify({ primary: "P", detailed: "D", confidence_level: level }) : null,
    });
    check(matchesCondition(cond, txn("HIGH")), "plaidConfidence matches equal confidence_level");
    check(!matchesCondition(cond, txn("LOW")), "plaidConfidence rejects different confidence_level");
    check(!matchesCondition(cond, txn(null)), "plaidConfidence rejects txn with no confidence");
  }
  await reset();

  // Baseline: no vendors → the txn is unmatched and sits in the queue.
  await rematchUser(USER);
  check((await vendorIdOfTxn()) === null, "baseline: txn matches no vendor");
  check(!!(await openFlag("unmatched_vendor")), "baseline: unmatched_vendor open");

  // --- Create matches + auto-closes the queue row --------------------------
  const v1 = await createVendor(USER, {
    name: "Zebra",
    categoryName: "Grocery",
    matchConditions: [{ nameOp: "contains", nameValue: "zebra" }],
  });
  check((await vendorIdOfTxn()) === v1.id, "create: matching vendor claims the txn (vendorId set)");
  const um = await anyFlag("unmatched_vendor");
  check(!!um && um.status === "resolved", "create: unmatched_vendor auto-closes on match");
  check(v1.priority === 0, "create: first vendor appends at priority 0");

  // --- Second overlapping vendor opens a conflict --------------------------
  const v2 = await createVendor(USER, {
    name: "Zebra Alt",
    categoryName: "Grocery",
    matchConditions: [{ merchantOp: "contains", merchantValue: "zebra" }],
  });
  check(v2.priority === 1, "create: second vendor appends at priority 1 (end of order)");

  // --- listVendors pagination + search (opt-in; picker needs the unpaginated full) ---
  const full = await listVendors(USER); // no page → whole list (Review picker path)
  check(full.vendors.length === 2 && full.total === 2, "list: unpaginated returns every vendor");
  check(full.orderedIds.length === 2, "list: orderedIds spans the full priority order (for reorder across pages)");
  const searched = await listVendors(USER, { q: "alt" }); // case-insensitive name search
  check(
    searched.total === 1 && searched.vendors[0]?.name === "Zebra Alt" && searched.orderedIds.length === 2,
    "list: search narrows results but orderedIds stays the full set"
  );
  // Default-category filter: both vendors default to "Grocery", so it keeps both;
  // an unused category name drops all (proves the filter isn't a no-op).
  check((await listVendors(USER, { category: "Grocery" })).total === 2, "list: category filter keeps vendors with that default category");
  check((await listVendors(USER, { category: "Nope" })).total === 0, "list: category filter excludes vendors whose default category differs");
  // Incremental rematch leaves a txn already owned by v1 alone; the conflict over a
  // now-overlapping vendor surfaces on a full rematch (Accounts → "Re-match all").
  await rematchUser(USER);
  check((await vendorIdOfTxn()) === v1.id, "conflict: priority winner (v1) stays assigned");
  check(!!(await openFlag("vendor_conflict")), "conflict: vendor_conflict opens on multi-match");

  // --- Reorder flips the winner --------------------------------------------
  await reorderVendors(USER, [v2.id, v1.id]);
  check((await vendorIdOfTxn()) === v2.id, "reorder: flips the winner to v2");
  check(!!(await openFlag("vendor_conflict")), "reorder: conflict still open while both overlap");

  // Partial reorder list is rejected (must be the full priority-bearing set).
  await reject400(() => reorderVendors(USER, [v1.id]), "reorder partial list");

  // --- Validation: each bad save is a 400 ----------------------------------
  await reject400(
    () => createVendor(USER, { name: "Zebra", categoryName: "Grocery", matchConditions: [{ nameOp: "contains", nameValue: "x" }] }),
    "duplicate name"
  );
  await reject400(() => createVendor(USER, { name: "No Rows", matchConditions: [] }), "zero condition rows");
  await reject400(
    () => createVendor(USER, { name: "No Fields", matchConditions: [{ categoryName: "Grocery" }] }),
    "row with no matching field"
  );
  await reject400(
    () => createVendor(USER, { name: "Bad Regex", matchConditions: [{ nameOp: "regex", nameValue: "(" }] }),
    "invalid regex"
  );
  await reject400(
    () => createVendor(USER, { name: "Long Regex", matchConditions: [{ nameOp: "regex", nameValue: "a".repeat(201) }] }),
    "over-length regex"
  );
  await reject400(
    () => createVendor(USER, { name: "Bad Bounds", matchConditions: [{ amountMin: 100, amountMax: 10 }] }),
    "amountMin > amountMax"
  );
  await reject400(
    () => createVendor(USER, { name: "Ghost Cat", categoryRules: [{ nameOp: "contains", nameValue: "x", categoryName: "Nope" }] }),
    "unknown category"
  );
  await reject400(
    () => createVendor(USER, { name: "Ghost Acct", matchConditions: [{ accountId: OTHER_ACCT }] }),
    "account not owned by user"
  );

  // A no-name save is rejected too.
  await reject400(() => createVendor(USER, { matchConditions: [{ nameOp: "contains", nameValue: "x" }] }), "missing name");

  // Failed saves created no vendors: still exactly v1 + v2.
  check((await prisma.vendor.count({ where: { userId: USER } })) === 2, "rejected saves create no vendors");

  // --- Delete returns the txn to the unmatched queue -----------------------
  // v2 currently wins; deleting it hands the txn back to v1 and closes the conflict.
  await deleteVendor(USER, v2.id);
  check((await vendorIdOfTxn()) === v1.id, "delete v2: txn falls back to v1");
  const conf = await anyFlag("vendor_conflict");
  check(!!conf && conf.status === "resolved", "delete v2: conflict auto-closes (overlap gone)");

  // Deleting the last matching vendor returns the txn to the unmatched queue.
  await deleteVendor(USER, v1.id);
  check((await vendorIdOfTxn()) === null, "delete v1: txn is unmatched again");
  check(!!(await openFlag("unmatched_vendor")), "delete v1: unmatched_vendor reopens");

  // Cleanup.
  await prisma.transactionFlag.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED\n`);
    process.exit(1);
  }
  console.log("\nAll F3 vendors checks passed.\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
