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
  plaidCategoryName,
  CategoryError,
} from "../src/lib/categories";

const USER = "cat-test-user";
const EXCLUDED = ["Income", "Transfer", "Other Income", "Ignore"].sort();

async function reset(): Promise<void> {
  // Categories/vendors/conditions cascade via their User FK. TransactionSplit and
  // MergeGroup carry a bare userId (no relation), so they DON'T — clear them first,
  // else a leftover split's globally-unique parentTransactionId collides on re-run.
  await prisma.transactionSplit.deleteMany({ where: { userId: USER } });
  await prisma.mergeGroup.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.user.create({ data: { id: USER, email: `${USER}@t.local`, passwordHash: "x" } });
}

async function main(): Promise<void> {
  await reset();

  // --- Plaid primary → app category (transfers collapse) -------------------
  assert.equal(plaidCategoryName("TRANSFER_IN"), "Transfer", "TRANSFER_IN → Transfer");
  assert.equal(plaidCategoryName("TRANSFER_OUT"), "Transfer", "TRANSFER_OUT → Transfer");
  assert.equal(plaidCategoryName("FOOD_AND_DRINK"), "Food And Drink", "other primaries humanized");

  // --- Seeding -------------------------------------------------------------
  await ensureDefaultCategories(USER);
  let cats = await prisma.transactionCategory.findMany({ where: { userId: USER } });
  assert.equal(cats.length, 22, "22 defaults (no separate Transfer In/Out)");
  const excluded = cats.filter((c) => c.excludeFromTotals).map((c) => c.name).sort();
  assert.deepEqual(excluded, EXCLUDED, "exactly the 4 exclude-from-totals rows");

  // Idempotency + never overwrites user edits: edit a row, re-seed, expect no change.
  const grocery = cats.find((c) => c.name === "Grocery")!;
  await prisma.transactionCategory.update({ where: { id: grocery.id }, data: { budget: 500 } });
  await prisma.transactionCategory.update({
    where: { id: cats.find((c) => c.name === "Income")!.id },
    data: { excludeFromTotals: false }, // user un-excludes Income
  });
  await ensureDefaultCategories(USER); // second run
  cats = await prisma.transactionCategory.findMany({ where: { userId: USER } });
  assert.equal(cats.length, 22, "re-seed adds nothing");
  assert.equal(Number(cats.find((c) => c.name === "Grocery")!.budget), 500, "budget edit preserved");
  assert.equal(cats.find((c) => c.name === "Income")!.excludeFromTotals, false, "flag edit preserved");

  // --- Rename cascade ------------------------------------------------------
  // Reference "Grocery" from all four cascade sites (vendor, condition, split
  // part, merge group).
  const vendor = await prisma.vendor.create({ data: { userId: USER, name: "V1", categoryName: "Grocery", priority: 1 } });
  await prisma.vendorCondition.create({ data: { vendorId: vendor.id, order: 0, categoryName: "Grocery", nameOp: "equals", nameValue: "x" } });
  const split = await prisma.transactionSplit.create({ data: { userId: USER, parentTransactionId: "cat-test-ptxn-1" } });
  await prisma.splitPart.create({ data: { splitId: split.id, amount: 100, categoryName: "Grocery" } });
  const mg = await prisma.mergeGroup.create({ data: { userId: USER, status: "confirmed", title: "g", categoryName: "Grocery", date: new Date(), netAmount: 0 } });
  // refCount counts only user-authored refs (vendor + condition + split); the
  // merge group's derived label is excluded, but rename still keeps it coherent.
  assert.equal(await categoryRefCount(USER, "Grocery"), 3, "3 user-authored references before rename");

  await updateCategory(USER, grocery.id, { name: "Groceries" });
  assert.equal(await categoryRefCount(USER, "Grocery"), 0, "no references remain under old name");
  assert.equal(await categoryRefCount(USER, "Groceries"), 3, "all user-authored references moved to new name");
  assert.equal((await prisma.mergeGroup.findUnique({ where: { id: mg.id } }))!.categoryName, "Groceries", "merge-group label also renamed");
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

  // Remove every user-authored reference, but LEAVE the merge group referencing
  // "Groceries" — it must not block the delete (that was the unactionable dead-end).
  await prisma.vendor.updateMany({ where: { userId: USER, categoryName: "Groceries" }, data: { categoryName: null } });
  await prisma.vendorCondition.updateMany({ where: { vendorId: vendor.id, categoryName: "Groceries" }, data: { categoryName: null } });
  await prisma.splitPart.updateMany({ where: { splitId: split.id, categoryName: "Groceries" }, data: { categoryName: null } });
  assert.equal(await categoryRefCount(USER, "Groceries"), 0, "user-authored references cleared (merge group still points at it)");

  await deleteCategory(USER, grocery.id);
  assert.equal(await prisma.transactionCategory.findUnique({ where: { id: grocery.id } }), null, "category deleted despite merge-group reference");
  assert.equal((await prisma.mergeGroup.findUnique({ where: { id: mg.id } }))!.categoryName, null, "merge-group cached label nulled on delete");

  // Budgets on OTHER categories are untouched by the delete.
  const survivors = await prisma.transactionCategory.count({ where: { userId: USER } });
  assert.equal(survivors, 21, "only the one category removed");

  // --- Subcategories (2-level tree) ---------------------------------------
  const food = await prisma.transactionCategory.create({ data: { userId: USER, name: "Food" } });
  const dining = await prisma.transactionCategory.create({ data: { userId: USER, name: "Dining" } });
  const parentOf = async (id: string) =>
    (await prisma.transactionCategory.findUnique({ where: { id } }))!.parentName;

  await updateCategory(USER, dining.id, { parentName: "Food" });
  assert.equal(await parentOf(dining.id), "Food", "child nested under parent");

  // Invalid parents are all rejected (self, unknown, a child → >2 levels).
  await assert.rejects(() => updateCategory(USER, food.id, { parentName: "Food" }), /own parent/, "self-parent rejected");
  await assert.rejects(() => updateCategory(USER, food.id, { parentName: "Nope" }), /No category named/, "unknown parent rejected");
  await assert.rejects(() => updateCategory(USER, food.id, { parentName: "Dining" }), /two levels|subcategory/, "nesting under a child rejected");
  // Food has a child, so it can't itself become a child.
  await prisma.transactionCategory.create({ data: { userId: USER, name: "Snacks" } });
  await assert.rejects(() => updateCategory(USER, food.id, { parentName: "Snacks" }), /subcategories/, "a parent can't become a child");

  // Renaming the parent cascades to the child's parentName pointer.
  await updateCategory(USER, food.id, { name: "Meals" });
  assert.equal(await parentOf(dining.id), "Meals", "rename cascades to child parentName");

  // Deleting the parent reparents its children to top level (no orphan pointer).
  await deleteCategory(USER, food.id);
  assert.equal(await parentOf(dining.id), null, "child reparented to top level on parent delete");

  await prisma.user.deleteMany({ where: { id: USER } });
  console.log("\n  ✓ FR4 categories: seeding, rename cascade, delete rejection, subcategories all pass\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
