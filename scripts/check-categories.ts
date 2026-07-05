// FR4 quality gate — asserts seeding idempotency, rename cascade, and delete
// rejection against a throwaway user in the dev SQLite DB. Deterministic, no
// network. Run: npm run check:categories
import assert from "assert";
import { prisma } from "../src/lib/db";
import {
  ensureDefaultCategories,
  updateCategory,
  deleteCategory,
  categoryRefCount,
  CategoryError,
} from "../src/lib/categories";

const USER = "cat-test-user";
const EXCLUDED = ["Income", "Transfer In", "Transfer Out", "Transfer", "Other Income"].sort();

async function reset(): Promise<void> {
  // Cascades to categories/vendors/conditions/splits/parts via FK onDelete.
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.user.create({ data: { id: USER, email: `${USER}@t.local`, passwordHash: "x" } });
}

async function main(): Promise<void> {
  await reset();

  // --- Seeding -------------------------------------------------------------
  await ensureDefaultCategories(USER);
  let cats = await prisma.transactionCategory.findMany({ where: { userId: USER } });
  assert.equal(cats.length, 20, "18 defaults + Transfer In/Out");
  const excluded = cats.filter((c) => c.excludeFromTotals).map((c) => c.name).sort();
  assert.deepEqual(excluded, EXCLUDED, "exactly the 5 exclude-from-totals rows");

  // Idempotency + never overwrites user edits: edit a row, re-seed, expect no change.
  const grocery = cats.find((c) => c.name === "Grocery")!;
  await prisma.transactionCategory.update({ where: { id: grocery.id }, data: { budget: 500 } });
  await prisma.transactionCategory.update({
    where: { id: cats.find((c) => c.name === "Income")!.id },
    data: { excludeFromTotals: false }, // user un-excludes Income
  });
  await ensureDefaultCategories(USER); // second run
  cats = await prisma.transactionCategory.findMany({ where: { userId: USER } });
  assert.equal(cats.length, 20, "re-seed adds nothing");
  assert.equal(Number(cats.find((c) => c.name === "Grocery")!.budget), 500, "budget edit preserved");
  assert.equal(cats.find((c) => c.name === "Income")!.excludeFromTotals, false, "flag edit preserved");

  // --- Rename cascade ------------------------------------------------------
  // Reference "Grocery" from all four cascade sites.
  await prisma.categoryMapping.create({ data: { userId: USER, plaidPrimary: "FOOD_AND_DRINK", categoryName: "Grocery" } });
  const vendor = await prisma.vendor.create({ data: { userId: USER, name: "V1", categoryName: "Grocery", priority: 1 } });
  await prisma.vendorCondition.create({ data: { vendorId: vendor.id, order: 0, categoryName: "Grocery", nameOp: "equals", nameValue: "x" } });
  const split = await prisma.transactionSplit.create({ data: { userId: USER, parentTransactionId: "ptxn-1" } });
  await prisma.splitPart.create({ data: { splitId: split.id, amount: 100, categoryName: "Grocery" } });
  assert.equal(await categoryRefCount(USER, "Grocery"), 4, "4 references before rename");

  await updateCategory(USER, grocery.id, { name: "Groceries" });
  assert.equal(await categoryRefCount(USER, "Grocery"), 0, "no references remain under old name");
  assert.equal(await categoryRefCount(USER, "Groceries"), 4, "all references moved to new name");
  const renamed = await prisma.transactionCategory.findUnique({ where: { id: grocery.id } });
  assert.equal(renamed!.name, "Groceries", "category row renamed");
  assert.equal(Number(renamed!.budget), 500, "budget survives rename");

  // Renaming into an existing name is rejected by the unique constraint (P2002).
  await assert.rejects(
    () => updateCategory(USER, grocery.id, { name: "Restaurant" }),
    /Unique constraint|P2002/,
    "rename collision rejected"
  );

  // --- Delete rejection then success --------------------------------------
  await assert.rejects(
    () => deleteCategory(USER, grocery.id),
    (e: unknown) => e instanceof CategoryError && e.status === 409,
    "delete rejected while referenced"
  );

  // Remove every reference, then delete succeeds.
  await prisma.categoryMapping.deleteMany({ where: { userId: USER, categoryName: "Groceries" } });
  await prisma.vendor.updateMany({ where: { userId: USER, categoryName: "Groceries" }, data: { categoryName: null } });
  await prisma.vendorCondition.updateMany({ where: { vendorId: vendor.id, categoryName: "Groceries" }, data: { categoryName: null } });
  await prisma.splitPart.updateMany({ where: { splitId: split.id, categoryName: "Groceries" }, data: { categoryName: null } });
  assert.equal(await categoryRefCount(USER, "Groceries"), 0, "references cleared");

  await deleteCategory(USER, grocery.id);
  assert.equal(await prisma.transactionCategory.findUnique({ where: { id: grocery.id } }), null, "category deleted");

  // Budgets on OTHER categories are untouched by the delete.
  const survivors = await prisma.transactionCategory.count({ where: { userId: USER } });
  assert.equal(survivors, 19, "only the one category removed");

  await prisma.user.deleteMany({ where: { id: USER } });
  console.log("\n  ✓ FR4 categories: seeding, rename cascade, delete rejection all pass\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
