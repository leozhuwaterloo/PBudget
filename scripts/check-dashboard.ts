// FR7 quality gate — asserts the Dashboard aggregate against a throwaway user in
// the dev SQLite DB: monthly-trend + top-vendors honor excludeFromTotals, spend
// buckets by month, budget-vs-actual pairs the selected month, review tiles count
// open flags/auto-groups, and the month param moves (b)/(d) but not (a)/(c).
// Deterministic, no network. Run: npm run check:dashboard
import assert from "assert";
import { prisma } from "../src/lib/db";
import { dashboardData } from "../src/lib/dashboard";

const USER = "dash-test-user";
const INST = "dash-test-inst";
const ITEM = "dash-test-item";
const ACCT = "dash-test-acct";

// Two calendar months inside the trailing-12 window, derived from "now" so the
// check is date-independent. monthA = current month; monthB = 3 months back.
const now = new Date();
const mk = (back: number) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 15, 12));
  return { key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, date: d };
};
const A = mk(0);
const B = mk(3);

// TransactionFlag / MergeGroup carry a bare userId with no cascade, so they must
// be cleared explicitly — a user delete alone orphans them.
async function clear(): Promise<void> {
  await prisma.transactionFlag.deleteMany({ where: { userId: USER } });
  await prisma.mergeGroup.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.plaidInstitution.deleteMany({ where: { institutionId: INST } });
}

async function reset(): Promise<void> {
  await clear();
  await prisma.user.create({ data: { id: USER, email: `${USER}@t.local`, passwordHash: "x" } });
  await prisma.plaidInstitution.create({ data: { institutionId: INST, name: "Test Bank" } });
  await prisma.plaidItem.create({ data: { itemId: ITEM, userId: USER, institutionId: INST, accessToken: "x", lastForceRefreshed: now } });
  await prisma.plaidAccount.create({
    data: { accountId: ACCT, itemId: ITEM, name: "Chq", accountType: "depository", isoCurrencyCode: "CAD" },
  });
}

async function txn(id: string, amount: number, primary: string, date: Date, name: string): Promise<void> {
  await prisma.plaidTransaction.create({
    data: {
      transactionId: id, accountId: ACCT, amount, isoCurrencyCode: "CAD", datetime: date,
      name, merchantName: name, pending: false, paymentChannel: "online",
      category: JSON.stringify({ primary, detailed: `${primary}_OTHER`, confidence_level: "HIGH" }),
      predictedCategory: primary,
    },
  });
}

async function main(): Promise<void> {
  await reset();

  // Categories: a spend category (budget 50) + an excluded Income category. Names
  // must equal the humanized Plaid primary so the read-time waterfall resolves to
  // them (no vendors/mappings). FOOD_AND_DRINK → "Food And Drink"; INCOME → "Income".
  await prisma.transactionCategory.createMany({
    data: [
      { userId: USER, name: "Food And Drink", budget: 50, excludeFromTotals: false },
      { userId: USER, name: "Income", budget: 0, excludeFromTotals: true },
    ],
  });

  // monthA: $100 food (counts) + $200 income inflow (excluded). monthB: $40 food.
  await txn("t-food-a", 100, "FOOD_AND_DRINK", A.date, "Cafe A");
  await txn("t-income-a", -200, "INCOME", A.date, "Payroll");
  await txn("t-food-b", 40, "FOOD_AND_DRINK", B.date, "Cafe A");

  // Review tiles: one open flag per queue/suspicion rule + one auto merge group.
  // The group's date is far in the past so it only moves the pending counter.
  await prisma.transactionFlag.createMany({
    data: [
      { userId: USER, rule: "unmatched_vendor", transactionId: "t-food-a", status: "open" },
      { userId: USER, rule: "vendor_conflict", transactionId: "t-income-a", status: "open" },
      { userId: USER, rule: "unusual_amount", transactionId: "t-food-b", status: "open" },
      { userId: USER, rule: "duplicate_charge", transactionId: "t-food-a", status: "dismissed" }, // not counted
    ],
  });
  await prisma.mergeGroup.create({
    data: { userId: USER, status: "auto", title: "Pending", date: new Date(Date.UTC(2000, 0, 1)), netAmount: 5, currency: "CAD" },
  });

  // --- (a) trend + (d) vendors honor excludeFromTotals, bucket by month --------
  const a = await dashboardData(USER, A.key);
  const trendA = a.trend.find((t) => t.month === A.key)!.spend;
  const trendB = a.trend.find((t) => t.month === B.key)!.spend;
  assert.equal(trendA, 100, "monthA trend excludes income, sums food");
  assert.equal(trendB, 40, "monthB trend buckets separately");
  assert.equal(a.trend.length, 12, "trend is a fixed 12-month window");
  assert.equal(a.vendors.reduce((s, v) => s + v.spend, 0), 100, "monthA vendors exclude income");
  assert.ok(!a.vendors.some((v) => v.name === "Payroll"), "excluded-category vendor absent from top vendors");

  // --- (b) budget vs actual pairs the selected month --------------------------
  const food = a.budget.find((r) => r.name === "Food And Drink")!;
  assert.equal(food.actual, 100, "budget-vs-actual actual = monthA food spend");
  assert.equal(food.budget, 50, "budget-vs-actual carries the category budget");

  // --- (c) review counts = open flags by rule + auto groups -------------------
  assert.deepEqual(a.review, { unmatched: 1, conflicts: 1, suspicion: 1, pending: 1 }, "review tile counts");

  // --- excludeFromTotals is read-time: toggling moves spend retroactively ------
  await prisma.transactionCategory.updateMany({ where: { userId: USER, name: "Food And Drink" }, data: { excludeFromTotals: true } });
  const excl = await dashboardData(USER, A.key);
  assert.equal(excl.trend.find((t) => t.month === A.key)!.spend, 0, "excluding Food empties monthA trend");
  assert.equal(excl.vendors.length, 0, "excluding Food empties top vendors");
  await prisma.transactionCategory.updateMany({ where: { userId: USER, name: "Food And Drink" }, data: { excludeFromTotals: false } });

  // --- month param moves (b)/(d) only; (a)/(c) are fixed windows --------------
  const b = await dashboardData(USER, B.key);
  assert.deepEqual(b.trend, a.trend, "trend unchanged across month selection");
  assert.deepEqual(b.review, a.review, "review unchanged across month selection");
  assert.equal(b.budget.find((r) => r.name === "Food And Drink")!.actual, 40, "budget-vs-actual follows the selected month");
  assert.equal(b.vendors.reduce((s, v) => s + v.spend, 0), 40, "top vendors follow the selected month");

  await clear();
  console.log("✓ check:dashboard passed");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
