// Gate for the incremental vendor rematch (the fast Save path). Asserts that editing
// one vendor only re-homes ITS OWN txns + the currently-unmatched ones, never steals
// from another vendor — and that a FULL rematch does reclaim them. Deterministic, no
// network; seeds a throwaway user's plaid graph in the dev SQLite DB.
// Run: npm run check:rematch
import assert from "assert";
import { prisma } from "../src/lib/db";
import { rematchUser, rematchAfterVendorChange } from "../src/lib/analysis/match";
import { RULES } from "../src/lib/analysis/constants";

const U = "rematch-test-user";
const ITEM = "rematch-item";
const ACCT = "rematch-acct";

async function reset(): Promise<void> {
  await prisma.plaidTransaction.deleteMany({ where: { accountId: ACCT } });
  await prisma.plaidAccount.deleteMany({ where: { accountId: ACCT } });
  await prisma.plaidItem.deleteMany({ where: { itemId: ITEM } });
  await prisma.user.deleteMany({ where: { id: U } });
  await prisma.user.create({ data: { id: U, email: `${U}@t.local`, passwordHash: "x" } });
  await prisma.plaidInstitution.upsert({ where: { institutionId: "rematch-ins" }, create: { institutionId: "rematch-ins", name: "Ins" }, update: {} });
  await prisma.plaidItem.create({ data: { itemId: ITEM, userId: U, institutionId: "rematch-ins", accessToken: "x", lastForceRefreshed: new Date() } });
  await prisma.plaidAccount.create({ data: { accountId: ACCT, itemId: ITEM, name: "Chk", accountType: "depository" } });
}

async function txn(id: string, name: string): Promise<void> {
  await prisma.plaidTransaction.create({
    data: { transactionId: id, accountId: ACCT, amount: 10, datetime: new Date(), name, paymentChannel: "online", pending: false },
  });
}

// A vendor with one "match" identity row (nameOp contains value) at a given priority.
async function vendor(name: string, priority: number, contains: string): Promise<string> {
  const v = await prisma.vendor.create({
    data: { userId: U, name, priority, conditions: { create: [{ role: "match", order: 0, nameOp: "contains", nameValue: contains }] } },
  });
  return v.id;
}
async function addMatchRow(vendorId: string, contains: string): Promise<void> {
  const n = await prisma.vendorCondition.count({ where: { vendorId } });
  await prisma.vendorCondition.create({ data: { vendorId, role: "match", order: n, nameOp: "contains", nameValue: contains } });
}
const vendorOf = async (id: string) => (await prisma.plaidTransaction.findUnique({ where: { transactionId: id } }))!.vendorId;
const flagOpen = async (transactionId: string) =>
  (await prisma.transactionFlag.findFirst({ where: { userId: U, rule: RULES.unmatchedVendor, transactionId } }))?.status === "open";

async function main(): Promise<void> {
  await reset();
  await txn("A", "STARBUCKS #123");
  await txn("B", "SHELL GAS 99");
  await txn("C", "RANDOM PURCHASE");

  // Vsb higher priority (0) than Vgas (1) — matters for the steal test below.
  const vsb = await vendor("Coffee", 0, "STARBUCKS");
  const vgas = await vendor("Gas", 1, "SHELL");

  // Full rematch is the baseline: A→Vsb, B→Vgas, C→unmatched (flag open).
  await rematchUser(U);
  assert.equal(await vendorOf("A"), vsb, "A matches Coffee");
  assert.equal(await vendorOf("B"), vgas, "B matches Gas");
  assert.equal(await vendorOf("C"), null, "C unmatched");
  assert.equal(await flagOpen("C"), true, "C has an open unmatched flag");

  // Broaden Coffee to also claim "RANDOM". Incremental candidates = Coffee's txns (A)
  // + unmatched (C). C gets claimed; its flag resolves. A stays.
  await addMatchRow(vsb, "RANDOM");
  await rematchAfterVendorChange(U, vsb);
  assert.equal(await vendorOf("C"), vsb, "incremental claims the newly-matching unmatched txn");
  assert.equal(await flagOpen("C"), false, "C's unmatched flag resolved");
  assert.equal(await vendorOf("A"), vsb, "A unchanged");

  // The scoping guarantee: broaden Coffee to ALSO match "SHELL". Coffee (pri 0) now
  // outranks Gas (pri 1) for B — but B is owned by Gas, so the INCREMENTAL pass must
  // NOT touch it (B isn't Coffee's txn and isn't unmatched).
  await addMatchRow(vsb, "SHELL");
  await rematchAfterVendorChange(U, vsb);
  assert.equal(await vendorOf("B"), vgas, "incremental leaves another vendor's txn alone (no steal)");

  // ...but a FULL rematch DOES reclaim it (Coffee wins by priority). This is the
  // Accounts → "Re-match all" escape hatch.
  await rematchUser(U);
  assert.equal(await vendorOf("B"), vsb, "full rematch re-resolves B to the higher-priority vendor");

  // Delete path: removing Gas leaves no dangling ids — its (now none) txns + unmatched
  // get re-homed. Delete Coffee instead: A/B/C are its txns, re-evaluated against Gas
  // only; none contain "SHELL"? B does → B→Gas; A/C match nothing → unmatched.
  await prisma.vendor.delete({ where: { id: vsb } });
  await rematchAfterVendorChange(U, vsb); // dangling vsb ids are the candidates
  assert.equal(await vendorOf("B"), vgas, "after deleting Coffee, B falls back to Gas");
  assert.equal(await vendorOf("A"), null, "A has no vendor left → unmatched");
  assert.equal(await flagOpen("A"), true, "A's unmatched flag reopened");

  await reset(); // leave the throwaway graph clean
  await prisma.user.deleteMany({ where: { id: U } });
  console.log("\n  ✓ incremental rematch: claim-unmatched, no-steal, full-refresh reclaim, delete re-home all pass\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
