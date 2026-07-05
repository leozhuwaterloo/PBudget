// FR2 catalog quality gate — asserts the authored catalog's shape and the
// instantiate → rematch path against a throwaway user in the dev SQLite DB.
// Deterministic, no network. Run: npm run check:catalog
import assert from "assert";
import { prisma } from "../src/lib/db";
import { CATALOG, searchCatalog, findCatalogEntry } from "../src/lib/catalog/vendors";
import { BRAND_ICONS } from "../src/lib/catalog/icons";
import { instantiateCatalogEntry } from "../src/lib/catalog/instantiate";
import { rematchUser } from "../src/lib/analysis/match";
import { DEFAULT_CATEGORIES } from "../src/lib/categories";
import { RULES } from "../src/lib/analysis/constants";

const USER = "catalog-test-user";
const INST = "catalog-test-inst";
const ITEM = "catalog-test-item";
const ACCT = "catalog-test-acct";
const TXN = "catalog-test-tim-hortons";

const SEEDED = new Set<string>([...DEFAULT_CATEGORIES, "Transfer In", "Transfer Out"]);
const BUCKET_SLUGS = ["self-personal-transfers", "general-bank", "general-spending"];

async function reset(): Promise<void> {
  await prisma.transactionFlag.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.plaidInstitution.deleteMany({ where: { institutionId: INST } });
  await prisma.user.create({ data: { id: USER, email: `${USER}@t.local`, passwordHash: "x", emailVerified: new Date() } });
  await prisma.plaidInstitution.create({ data: { institutionId: INST, name: "Catalog Bank" } });
  await prisma.plaidItem.create({ data: { itemId: ITEM, userId: USER, institutionId: INST, accessToken: "x", lastForceRefreshed: new Date() } });
  await prisma.plaidAccount.create({ data: { accountId: ACCT, itemId: ITEM, name: "Chequing", accountType: "depository" } });
  await prisma.plaidTransaction.create({
    data: {
      transactionId: TXN, accountId: ACCT, amount: 4.75,
      category: JSON.stringify({ primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_RESTAURANT" }),
      datetime: new Date(), name: "TIM HORTONS #1234", merchantName: "Tim Hortons",
      paymentChannel: "in store", pending: false,
    },
  });
}

async function flag(rule: string): Promise<{ status: string } | null> {
  return prisma.transactionFlag.findUnique({ where: { rule_transactionId: { rule, transactionId: TXN } } });
}

async function main(): Promise<void> {
  // --- Static shape --------------------------------------------------------
  const merchants = CATALOG.filter((e) => !BUCKET_SLUGS.includes(e.slug));
  assert.ok(merchants.length >= 100, `≥100 merchant entries (got ${merchants.length})`);
  for (const s of BUCKET_SLUGS) assert.ok(findCatalogEntry(s), `bucket present: ${s}`);

  for (const e of CATALOG) {
    assert.ok(e.conditions.length >= 1, `${e.slug} has ≥1 condition`);
    for (const c of e.conditions) {
      assert.ok(SEEDED.has(c.categoryName), `${e.slug} row category "${c.categoryName}" is seeded`);
      const hasField = c.nameOp || c.merchantOp || c.paymentChannel || c.plaidPrimary || c.plaidDetailed || c.amountMin != null || c.amountMax != null;
      assert.ok(hasField, `${e.slug} row has ≥1 match field`);
    }
    if (e.icon) assert.ok(BRAND_ICONS[e.icon], `${e.slug} icon "${e.icon}" is bundled`);
  }

  // --- Text search ---------------------------------------------------------
  assert.ok(searchCatalog("tim").some((e) => e.slug === "tim-hortons"), "search 'tim' finds Tim Hortons");
  assert.ok(searchCatalog("costco").some((e) => e.slug === "costco"), "search 'costco' finds Costco");
  assert.equal(searchCatalog("").length, CATALOG.length, "empty query returns whole catalog");
  assert.equal(searchCatalog("zzzznope").length, 0, "no match returns empty");

  // --- Instantiate → rematch (the core behaviour) --------------------------
  await reset();

  // Before: an unmatched posted txn opens an unmatched_vendor queue item.
  await rematchUser(USER);
  let txn = await prisma.plaidTransaction.findUnique({ where: { transactionId: TXN } });
  assert.equal(txn!.vendorId, null, "txn starts unmatched");
  assert.equal((await flag(RULES.unmatchedVendor))?.status, "open", "unmatched_vendor open before instantiate");

  // Instantiate Tim Hortons (no bundled icon → letter avatar).
  const tim = await instantiateCatalogEntry(USER, "tim-hortons");
  const timVendor = await prisma.vendor.findUnique({ where: { id: tim.id }, include: { conditions: true } });
  assert.equal(timVendor!.name, "Tim Hortons", "vendor named from entry");
  assert.equal(timVendor!.icon, null, "Tim Hortons falls back to letter avatar");
  assert.equal(timVendor!.categoryName, "Restaurant", "vendor default category copied");
  assert.equal(timVendor!.conditions.length, 1, "one condition row copied");
  assert.equal(timVendor!.conditions[0].categoryName, "Restaurant", "row category copied");
  assert.equal(timVendor!.conditions[0].merchantValue, "Tim Hortons", "row merchant copied");
  assert.equal(timVendor!.conditions[0].paymentChannel, "in store", "row channel copied");

  // After: vendorId materialized on the matching txn, queue item closed.
  txn = await prisma.plaidTransaction.findUnique({ where: { transactionId: TXN } });
  assert.equal(txn!.vendorId, tim.id, "matching txn now points at the new vendor");
  assert.equal((await flag(RULES.unmatchedVendor))?.status, "resolved", "unmatched_vendor closed after instantiate");

  // Second instantiate (an icon'd entry) appends at LOWER priority (higher int).
  const sbucks = await instantiateCatalogEntry(USER, "starbucks");
  const sbVendor = await prisma.vendor.findUnique({ where: { id: sbucks.id } });
  assert.equal(sbVendor!.icon, "starbucks", "Starbucks keeps its bundled icon");
  assert.ok(sbVendor!.priority! > timVendor!.priority!, "appended at lower priority (higher int)");

  // Re-instantiate Tim Hortons → suffixed name, does not collide.
  const tim2 = await instantiateCatalogEntry(USER, "tim-hortons");
  assert.equal(tim2.name, "Tim Hortons (2)", "re-instantiate suffixes the name");

  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.plaidInstitution.deleteMany({ where: { institutionId: INST } });

  console.log(`  OK — ${CATALOG.length} entries (${merchants.length} merchants + ${BUCKET_SLUGS.length} buckets), instantiate + rematch verified.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
