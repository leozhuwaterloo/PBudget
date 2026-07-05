// FR5 manual splits acceptance gate (F5). Exercises the write side the routes call
// (src/lib/splits.ts) + the effective read model + merge/split mutual exclusion,
// against a throwaway user in the dev SQLite DB. Deterministic, no network, no dev
// server. Run: npm run check:splits
//
// Covers the card's acceptance points: split $100 → $60/$40 with two categories
// succeeds and the read model shows the two parts (their categories, no parent);
// sum≠parent / sign-mismatch / N<2 / splitting a merge leg / unknown category are
// each rejected 400; the split parent is excluded from merge candidates and a
// manual merge naming it throws; PUT replaces parts; DELETE restores the parent.
import { prisma } from "../src/lib/db";
import { SplitError, createSplit, replaceSplit, deleteSplit, splitParentIds } from "../src/lib/splits";
import { effectiveTransactions } from "../src/lib/analysis/effective";
import { createMergeGroup } from "../src/lib/analysis/merge";

const USER = "split-test-user";
const ITEM = "st-item";
const ACCT = "st-acct";
const ACCT2 = "st-acct2";
const HUNDRED = "st-txn-hundred"; // $100, ungrouped — the split target
const LEG_A = "st-txn-legA"; // in a merge group
const LEG_B = "st-txn-legB"; // in a merge group
const FREE = "st-txn-free"; // ungrouped, unsplit — merge counterpart

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
    check(e instanceof SplitError && e.status === 400, `${label}: rejected with 400`);
  }
}

async function reset(): Promise<void> {
  await prisma.transactionFlag.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } }); // cascades item→acct→txn, categories, splits
  await prisma.user.create({ data: { id: USER, email: `${USER}@t.local`, passwordHash: "x" } });
  for (const name of ["Grocery", "Restaurant"]) {
    await prisma.transactionCategory.create({ data: { userId: USER, name } });
  }
  await prisma.plaidInstitution.upsert({
    where: { institutionId: "st-inst" },
    create: { institutionId: "st-inst", name: "ST Bank" },
    update: {},
  });
  await prisma.plaidItem.create({
    data: { itemId: ITEM, userId: USER, institutionId: "st-inst", accessToken: "x", lastForceRefreshed: new Date("2026-01-01") },
  });
  for (const id of [ACCT, ACCT2]) {
    await prisma.plaidAccount.create({ data: { accountId: id, itemId: ITEM, name: "ST Chq", accountType: "depository" } });
  }
  const txn = (id: string, acct: string, amount: number, name: string) =>
    prisma.plaidTransaction.create({
      data: {
        transactionId: id, accountId: acct, amount, isoCurrencyCode: "CAD",
        category: JSON.stringify({ primary: "GENERAL_MERCHANDISE" }),
        datetime: new Date("2026-01-01"), name, merchantName: name, paymentChannel: "online", pending: false,
      },
    });
  await txn(HUNDRED, ACCT, 100, "Costco");
  await txn(LEG_A, ACCT, 50, "Xfer Out");
  await txn(LEG_B, ACCT2, -50, "Xfer In");
  await txn(FREE, ACCT, 12, "Kiosk");
  await createMergeGroup(USER, [LEG_A, LEG_B], { status: "confirmed" });
}

async function main(): Promise<void> {
  console.log("\nChecking F5 manual splits + merge/split exclusion:");
  await reset();

  // --- Split $100 into $60/$40 with two categories -------------------------
  await createSplit(USER, HUNDRED, [
    { amount: 60, label: "food", categoryName: "Grocery" },
    { amount: 40, label: "drink", categoryName: "Restaurant" },
  ]);
  let rows = await effectiveTransactions(USER);
  check(!rows.some((r) => r.id === HUNDRED), "read model: parent no longer appears as its own row");
  const parts = rows.filter((r) => r.parentId === HUNDRED);
  check(parts.length === 2, "read model: parent replaced by exactly 2 parts");
  check(
    parts.some((p) => p.amount === 60 && p.categoryName === "Grocery") &&
      parts.some((p) => p.amount === 40 && p.categoryName === "Restaurant"),
    "read model: parts carry their $60/Grocery and $40/Restaurant overrides"
  );
  check(parts.every((p) => p.vendorName === "costco"), "read model: parts inherit the parent vendor");

  // --- Validation: each bad split is a 400 ---------------------------------
  await reject400(() => replaceSplit(USER, HUNDRED, [{ amount: 60 }, { amount: 30 }]), "parts don't sum to parent");
  await reject400(() => replaceSplit(USER, HUNDRED, [{ amount: 120 }, { amount: -20 }]), "sign mismatch");
  await reject400(() => replaceSplit(USER, HUNDRED, [{ amount: 100 }]), "N < 2 parts");
  await reject400(
    () => replaceSplit(USER, HUNDRED, [{ amount: 60, categoryName: "Grocery" }, { amount: 40, categoryName: "Ghost" }]),
    "unknown category override"
  );
  await reject400(() => createSplit(USER, LEG_A, [{ amount: 25 }, { amount: 25 }]), "splitting a merge leg");

  // --- Merge/split mutual exclusion (split side) ---------------------------
  const parents = await splitParentIds(USER);
  check(parents.has(HUNDRED), "exclusion: split parent is in splitParentIds (drops from merge candidates)");
  check(!parents.has(FREE), "exclusion: an unsplit txn is not flagged as a split parent");
  // createMergeGroup (the shared primitive both auto-match and the manual route use)
  // rejects a leg set naming the split parent.
  let mergeRejected = false;
  try {
    await createMergeGroup(USER, [HUNDRED, FREE], { status: "confirmed" });
  } catch {
    mergeRejected = true;
  }
  check(mergeRejected, "exclusion: createMergeGroup rejects a split parent");

  // --- PUT replaces the parts wholesale ------------------------------------
  await replaceSplit(USER, HUNDRED, [{ amount: 70, label: "a" }, { amount: 30, label: "b" }]);
  rows = await effectiveTransactions(USER);
  const newParts = rows.filter((r) => r.parentId === HUNDRED).map((r) => r.amount).sort((x, y) => x - y);
  check(newParts.length === 2 && newParts[0] === 30 && newParts[1] === 70, "PUT: parts replaced with 30/70");

  // --- DELETE restores the parent ------------------------------------------
  await deleteSplit(USER, HUNDRED);
  rows = await effectiveTransactions(USER);
  const restored = rows.find((r) => r.id === HUNDRED);
  check(!!restored && restored.amount === 100, "DELETE: parent restored to the effective list at $100");
  check(!rows.some((r) => r.parentId === HUNDRED), "DELETE: no orphan part rows remain");

  await prisma.user.deleteMany({ where: { id: USER } });
  console.log(failures ? `\n✗ ${failures} check(s) failed\n` : "\n✓ all split checks passed\n");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
