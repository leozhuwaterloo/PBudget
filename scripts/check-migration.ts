// FR11 / AC12 quality gate — asserts the legacy-vendor migration against a throwaway
// user in the dev SQLite DB: approved vendors become V2 vendors whose equals-rows keep
// their historical transactions matched, pending/rejected vendors and unknown_vendor
// flags are deleted, and a SECOND run is a byte-for-byte no-op. Deterministic, no
// network. Run: npm run check:migration
import assert from "assert";
import { prisma } from "../src/lib/db";
import { migrateUser, rowsForKey } from "./migrate-vendors-v2";

const USER = "vmig-test-user";
const INST = "vmig-test-inst";
const ITEM = "vmig-test-item";
const ACCT = "vmig-test-acct";
const day = (n: number) => new Date(Date.UTC(2025, 0, n));

async function cleanup(): Promise<void> {
  // Vendors/flags/txns cascade off the user; institution is separate.
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.plaidInstitution.deleteMany({ where: { institutionId: INST } });
}

async function seed(): Promise<void> {
  await cleanup();
  await prisma.plaidInstitution.create({ data: { institutionId: INST, name: "Test Bank" } });
  await prisma.user.create({ data: { id: USER, email: `${USER}@t.local`, passwordHash: "x" } });
  await prisma.plaidItem.create({
    data: { itemId: ITEM, userId: USER, institutionId: INST, accessToken: "enc", lastForceRefreshed: day(1) },
  });
  await prisma.plaidAccount.create({
    data: { accountId: ACCT, itemId: ITEM, name: "Chequing", accountType: "depository" },
  });

  // Historical transactions. Tim Hortons appears with the key coming from BOTH fields
  // (one via merchant, one via a merchant-less name); Costco only via merchant; the
  // rejected vendor's txn will resurface unmatched.
  const txn = (id: string, name: string, merchant: string | null) =>
    prisma.plaidTransaction.create({
      data: {
        transactionId: id, accountId: ACCT, amount: 10, datetime: day(2),
        name, merchantName: merchant, paymentChannel: "online", pending: false,
      },
    });
  await txn("vmig-tim-merch", "TIM HORTONS #123", "Tim Hortons"); // key from merchant
  await txn("vmig-tim-name", "Tim Hortons", null); // key from name
  await txn("vmig-costco", "COSTCO WHOLESALE", "Costco"); // key from merchant
  await txn("vmig-rejected", "REJECTED CO", "Rejected Co"); // resurfaces unmatched

  // Legacy vendors (the deprecated status/decidedAt model). Names are the normalized
  // `merchantName ?? name` keys, as the old analyzer stored them. Costco decided
  // BEFORE Tim Hortons, so priority ordering (decidedAt asc) must put Costco first.
  const legacy = (name: string, status: string, decidedAt: Date | null) =>
    prisma.vendor.create({ data: { userId: USER, name, status, decidedAt, priority: null } });
  await legacy("tim hortons", "approved", day(10));
  await legacy("costco", "approved", day(5));
  await legacy("pending co", "pending", day(8));
  await legacy("rejected co", "rejected", day(9));

  // unknown_vendor flags (superseded by the queue): one open, one dismissed.
  await prisma.transactionFlag.create({ data: { userId: USER, rule: "unknown_vendor", transactionId: "vmig-tim-merch", status: "open" } });
  await prisma.transactionFlag.create({ data: { userId: USER, rule: "unknown_vendor", transactionId: "vmig-costco", status: "dismissed" } });
}

// A stable, order-independent snapshot of everything the migration touches.
async function snapshot(): Promise<string> {
  const vendors = await prisma.vendor.findMany({
    where: { userId: USER },
    include: { conditions: { orderBy: { order: "asc" } } },
    orderBy: { name: "asc" },
  });
  const txns = await prisma.plaidTransaction.findMany({
    where: { accountId: ACCT }, select: { transactionId: true, vendorId: true }, orderBy: { transactionId: "asc" },
  });
  const flags = await prisma.transactionFlag.findMany({
    where: { userId: USER }, orderBy: [{ rule: "asc" }, { transactionId: "asc" }],
    select: { id: true, rule: true, transactionId: true, status: true },
  });
  return JSON.stringify({ vendors, txns, flags });
}

const vendorByName = (name: string) =>
  prisma.vendor.findFirst({ where: { userId: USER, name }, include: { conditions: { orderBy: { order: "asc" } } } });
const vendorIdOf = async (transactionId: string) =>
  (await prisma.plaidTransaction.findUnique({ where: { transactionId } }))?.vendorId ?? null;
const openFlag = (transactionId: string, rule: string) =>
  prisma.transactionFlag.findFirst({ where: { transactionId, rule, status: "open" } });

async function main(): Promise<void> {
  console.log("\nChecking legacy vendor migration:");

  // rowsForKey unit coverage: both origins -> two rows; single origin -> one row.
  const both = rowsForKey("tim hortons", [
    { name: "TIM HORTONS #123", merchantName: "Tim Hortons" },
    { name: "Tim Hortons", merchantName: null },
  ]);
  assert.equal(both.length, 2, "rowsForKey: both origins -> merchant + name rows");
  assert.ok(both.some((r) => r.merchantOp === "equals" && r.merchantValue === "tim hortons"), "rowsForKey: merchant equals row");
  assert.ok(both.some((r) => r.nameOp === "equals" && r.nameValue === "tim hortons"), "rowsForKey: name equals row");
  const one = rowsForKey("costco", [{ name: "COSTCO WHOLESALE", merchantName: "Costco" }]);
  assert.deepEqual(one, [{ order: 0, merchantOp: "equals", merchantValue: "costco" }], "rowsForKey: merchant-only origin -> one row");

  await seed();
  const res = await migrateUser(USER);
  assert.deepEqual(res, { approved: 2, dropped: 2, flags: 2 }, "migrate: 2 approved converted, 2 legacy dropped, 2 flags removed");

  // Approved vendors converted; priority follows decidedAt order (Costco < Tim).
  const costco = await vendorByName("costco");
  const tim = await vendorByName("tim hortons");
  assert.ok(costco && costco.priority === 1, "costco (earlier decidedAt) gets priority 1");
  assert.ok(tim && tim.priority === 2, "tim hortons (later decidedAt) gets priority 2");

  // Equals rows reproduce the legacy key from whichever field(s) it came from.
  assert.equal(costco!.conditions.length, 1, "costco: one equals row (merchant only)");
  assert.equal(tim!.conditions.length, 2, "tim: two equals rows (merchant + name)");

  // AC12: the historical transactions stay matched (vendorId set) with zero manual work.
  assert.equal(await vendorIdOf("vmig-tim-merch"), tim!.id, "tim merchant-origin txn matched");
  assert.equal(await vendorIdOf("vmig-tim-name"), tim!.id, "tim name-origin txn matched");
  assert.equal(await vendorIdOf("vmig-costco"), costco!.id, "costco txn matched");

  // Deprecated columns are LEFT in place (removal deferred until prod-confirmed).
  assert.equal(costco!.status, "approved", "converted vendor keeps its legacy status column");

  // pending/rejected dropped; their transactions resurface in the unmatched queue.
  assert.equal(await prisma.vendor.count({ where: { userId: USER, status: { in: ["pending", "rejected"] } } }), 0, "pending/rejected legacy vendors deleted");
  assert.equal(await vendorIdOf("vmig-rejected"), null, "dropped vendor's txn is now unmatched");
  assert.ok(await openFlag("vmig-rejected", "unmatched_vendor"), "dropped vendor's txn queued unmatched_vendor");

  // All unknown_vendor flags (open + dismissed) gone.
  assert.equal(await prisma.transactionFlag.count({ where: { userId: USER, rule: "unknown_vendor" } }), 0, "all unknown_vendor flags deleted");

  // Idempotency: a second run changes nothing, byte for byte (same rows, same ids).
  const before = await snapshot();
  const res2 = await migrateUser(USER);
  assert.deepEqual(res2, { approved: 2, dropped: 0, flags: 0 }, "re-run: nothing to drop or delete");
  assert.equal(await snapshot(), before, "re-run is a byte-for-byte no-op");

  await cleanup();
  console.log("\n  ✓ FR11 migration: approved->V2 (matched), pending/rejected dropped, unknown_vendor cleared, idempotent\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
