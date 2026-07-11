// FR2 catalog quality gate — asserts the catalog's shape (generated merchants +
// authored buckets, two-stage conditions, embedded icons) and the instantiate →
// rematch path against a throwaway user in the dev SQLite DB. Run: npm run check:catalog
import assert from "assert";
import { prisma } from "../src/lib/db";
import { CATALOG, searchCatalog, findCatalogEntry } from "../src/lib/catalog/vendors";
import { instantiateCatalogEntry } from "../src/lib/catalog/instantiate";
import { rematchUser } from "../src/lib/analysis/match";
import { RULES } from "../src/lib/analysis/constants";

const USER = "catalog-test-user";
const INST = "catalog-test-inst";
const ITEM = "catalog-test-item";
const ACCT = "catalog-test-acct";
const TXN = "catalog-test-tim-hortons";

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
    const rows = [...e.matchConditions, ...e.categoryRules];
    assert.ok(rows.length >= 1, `${e.slug} has ≥1 condition`);
    assert.ok(e.categoryName, `${e.slug} has a default category`);
    for (const c of rows) {
      const hasField = c.nameOp || c.merchantOp || c.paymentChannel || c.plaidPrimary || c.plaidDetailed || c.amountMin != null || c.amountMax != null;
      assert.ok(hasField, `${e.slug} row has ≥1 match field`);
    }
    for (const c of e.categoryRules) assert.ok(c.categoryName, `${e.slug} category rule carries a category`);
    if (e.icon) assert.ok(e.icon.startsWith("data:"), `${e.slug} icon is an embedded data URI`);
  }
  assert.ok(CATALOG.some((e) => e.icon), "at least some entries embed an icon");

  // --- Text search ---------------------------------------------------------
  assert.ok(searchCatalog("tim").some((e) => e.slug === "tim-hortons"), "search 'tim' finds Tim Hortons");
  assert.ok(searchCatalog("costco").some((e) => e.slug === "costco"), "search 'costco' finds Costco");
  assert.equal(searchCatalog("").length, CATALOG.length, "empty query returns whole catalog");
  assert.equal(searchCatalog("zzzznope").length, 0, "no match returns empty");

  // --- Instantiate → rematch (the core behaviour) --------------------------
  await reset();
  await rematchUser(USER);
  let txn = await prisma.plaidTransaction.findUnique({ where: { transactionId: TXN } });
  assert.equal(txn!.vendorId, null, "txn starts unmatched");
  assert.equal((await flag(RULES.unmatchedVendor))?.status, "open", "unmatched_vendor open before instantiate");

  // Instantiate Tim Hortons (an icon'd entry from the generated catalog).
  const timEntry = findCatalogEntry("tim-hortons")!;
  const tim = await instantiateCatalogEntry(USER, "tim-hortons");
  const timVendor = await prisma.vendor.findUnique({ where: { id: tim.id }, include: { conditions: true } });
  assert.equal(timVendor!.name, "Tim Hortons", "vendor named from entry");
  assert.equal(timVendor!.categoryName, timEntry.categoryName, "vendor default category copied from entry");
  assert.ok(timVendor!.conditions.length >= 1, "≥1 condition row copied");
  assert.ok(timVendor!.conditions.some((c) => c.merchantValue === "Tim Hortons"), "the merchant condition copied");
  // Its custom category was ensured to exist for this user.
  assert.ok(await prisma.transactionCategory.findUnique({ where: { userId_name: { userId: USER, name: timEntry.categoryName! } } }), "entry's category ensured for the user");
  // The embedded icon (data URI) is carried onto the vendor.
  assert.ok(timVendor!.icon?.startsWith("data:"), "embedded icon copied onto the vendor");

  // After: vendorId materialized on the matching txn, queue item closed.
  txn = await prisma.plaidTransaction.findUnique({ where: { transactionId: TXN } });
  assert.equal(txn!.vendorId, tim.id, "matching txn now points at the new vendor");
  assert.equal((await flag(RULES.unmatchedVendor))?.status, "resolved", "unmatched_vendor closed after instantiate");

  // A bucket has no embedded icon and no link → letter avatar (icon null), no network,
  // and appends at LOWER priority (higher int).
  const bucket = findCatalogEntry("general-spending")!;
  const inst = await instantiateCatalogEntry(USER, bucket.slug);
  const instVendor = await prisma.vendor.findUnique({ where: { id: inst.id } });
  assert.equal(instVendor!.icon, null, "no icon + no link → letter avatar (icon null)");
  assert.ok(instVendor!.priority! > timVendor!.priority!, "appended at lower priority (higher int)");

  // Re-instantiate Tim Hortons → suffixed name, does not collide.
  const tim2 = await instantiateCatalogEntry(USER, "tim-hortons");
  assert.equal(tim2.name, "Tim Hortons (2)", "re-instantiate suffixes the name");

  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.plaidInstitution.deleteMany({ where: { institutionId: INST } });

  console.log(`  OK — ${CATALOG.length} entries (${merchants.length} merchants + ${BUCKET_SLUGS.length} buckets, ${CATALOG.filter((e) => e.icon).length} with icons), instantiate + rematch verified.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
