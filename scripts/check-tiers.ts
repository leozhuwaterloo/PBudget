// FR10 quality gate — asserts the Free/Pro/Max connection-tier limits, downgrade
// read-only ordering, and the webhook price-id -> User.plan mapping against a
// throwaway user in the dev SQLite DB. Deterministic, no network (PlaidItems are
// inserted directly; the webhook event is a hand-built object). Run: npm run check:tiers
import assert from "assert";
import type Stripe from "stripe";
import { prisma } from "../src/lib/db";
import {
  limitFor,
  entitledConnections,
  enforceEntitlement,
  countConnections,
  canAddConnection,
  canSyncItem,
  upgradeCTA,
  applyWebhookEvent,
} from "../src/lib/stripe";

const USER = "tier-test-user";
const INST = "tier-test-inst";
const CUSTOMER = "cus_tiertest";
process.env.STRIPE_PRICE_PRO = "price_test_pro";
process.env.STRIPE_PRICE_MAX = "price_test_max";

async function setPlan(plan: string): Promise<void> {
  await prisma.user.update({ where: { id: USER }, data: { plan } });
}
function user() {
  return prisma.user.findUniqueOrThrow({ where: { id: USER } });
}
async function addItem(itemId: string, daysAgo: number): Promise<void> {
  await prisma.plaidItem.create({
    data: {
      itemId,
      userId: USER,
      institutionId: INST,
      accessToken: "enc",
      createdAt: new Date(Date.now() - daysAgo * 86400000),
      lastForceRefreshed: new Date(),
    },
  });
}

// A hand-built subscription webhook event (no network).
function subEvent(type: string, priceId: string | undefined, status: string): Stripe.Event {
  return {
    type,
    data: {
      object: {
        id: "sub_test",
        customer: CUSTOMER,
        status,
        items: { data: priceId ? [{ price: { id: priceId } }] : [] },
      },
    },
  } as unknown as Stripe.Event;
}

async function main(): Promise<void> {
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.plaidInstitution.deleteMany({ where: { institutionId: INST } });
  await prisma.plaidInstitution.create({ data: { institutionId: INST, name: "Test Bank" } });
  await prisma.user.create({
    data: { id: USER, email: `${USER}@t.local`, passwordHash: "x", stripeCustomerId: CUSTOMER },
  });

  // --- Limits are per plan -------------------------------------------------
  assert.equal(limitFor("free"), 1, "free = 1");
  assert.equal(limitFor("pro"), 5, "pro = 5");
  assert.equal(limitFor("max"), 20, "max = 20");
  assert.equal(limitFor("bogus"), 1, "unknown plan falls back to free");

  // --- Free user: 1 connection allowed, 2nd blocked -----------------------
  // With 0 items a free user may add their first connection (no subscription).
  assert.deepEqual(await canAddConnection(await user()), { ok: true }, "free may add 1st connection");

  await addItem("itm-a", 30); // oldest — the one free connection
  assert.deepEqual(
    await canSyncItem(await user(), "itm-a"),
    { ok: true },
    "free syncs its 1 connection with no subscription"
  );
  // Now at the free limit: a 2nd connection is blocked.
  assert.deepEqual(
    await canAddConnection(await user()),
    { ok: false, used: 1 },
    "free may NOT add a 2nd connection"
  );

  await addItem("itm-b", 10); // newer, over the free limit (simulates a downgrade)
  assert.deepEqual(
    await canAddConnection(await user()),
    { ok: false, used: 2 },
    "over-limit free user still blocked from adding"
  );

  // Downgrade read-only: oldest syncs, newer is 402'd.
  assert.deepEqual(await canSyncItem(await user(), "itm-a"), { ok: true }, "oldest keeps syncing");
  const excess = await canSyncItem(await user(), "itm-b");
  assert.deepEqual(excess, { ok: false, used: 2 }, "excess item is read-only");

  // --- Upgrade CTA payload shape ------------------------------------------
  const cta = upgradeCTA("free", 2);
  assert.deepEqual(
    cta,
    { error: cta.error, code: "connection_limit", plan: "free", limit: 1, used: 2, upgradeTo: "pro" },
    "CTA payload carries plan/limit/used/next-tier"
  );
  assert.equal(upgradeCTA("pro", 5).upgradeTo, "max", "pro upgrades to max");
  assert.equal(upgradeCTA("max", 20).upgradeTo, null, "max has no upgrade");

  // --- Webhook: price id -> plan ------------------------------------------
  await applyWebhookEvent(subEvent("customer.subscription.updated", "price_test_pro", "active"));
  assert.equal((await user()).plan, "pro", "active Pro price -> plan pro");

  // Pro now lifts the gate: both connections sync, a 3rd is addable.
  assert.deepEqual(await canSyncItem(await user(), "itm-b"), { ok: true }, "pro syncs 2nd connection");
  assert.deepEqual(await canAddConnection(await user()), { ok: true }, "pro may add more connections");

  await applyWebhookEvent(subEvent("customer.subscription.updated", "price_test_max", "trialing"));
  assert.equal((await user()).plan, "max", "trialing Max price -> plan max");

  // Non-active status never grants a paid plan.
  await applyWebhookEvent(subEvent("customer.subscription.updated", "price_test_pro", "past_due"));
  assert.equal((await user()).plan, "free", "past_due -> free");

  // Re-grant, then a delete event falls back to free.
  await applyWebhookEvent(subEvent("customer.subscription.updated", "price_test_pro", "active"));
  assert.equal((await user()).plan, "pro", "re-granted pro");
  await applyWebhookEvent(subEvent("customer.subscription.deleted", "price_test_pro", "active"));
  assert.equal((await user()).plan, "free", "cancellation -> free");

  // Unknown price never maps to a paid plan.
  await applyWebhookEvent(subEvent("customer.subscription.updated", "price_unknown", "active"));
  assert.equal((await user()).plan, "free", "unknown price -> free");

  // --- Expiry: trial ended / no sub -> connections REMOVED, data PRESERVED --
  const EXP = "tier-expired-user";
  await prisma.transactionFlag.deleteMany({ where: { userId: EXP } });
  await prisma.user.deleteMany({ where: { id: EXP } });
  await prisma.user.create({
    data: { id: EXP, email: `${EXP}@t.local`, passwordHash: "x", createdAt: new Date(Date.now() - 40 * 86400000) },
  });
  const expUser = () => prisma.user.findUniqueOrThrow({ where: { id: EXP } });
  assert.equal(entitledConnections(await expUser()), 0, "expired free trial (no sub) is entitled to 0 connections");

  // One connection with an account + a transaction behind it.
  await prisma.plaidItem.create({ data: { itemId: "exp-itm", userId: EXP, institutionId: INST, accessToken: "enc", lastForceRefreshed: new Date() } });
  await prisma.plaidAccount.create({ data: { accountId: "exp-acct", itemId: "exp-itm", name: "Chq", accountType: "depository" } });
  await prisma.plaidTransaction.create({
    data: { transactionId: "exp-txn", accountId: "exp-acct", amount: 10, isoCurrencyCode: "CAD",
      datetime: new Date(), name: "Coffee", paymentChannel: "online", pending: false },
  });

  const removed = await enforceEntitlement(await expUser());
  assert.equal(removed, 1, "expiry removes the over-entitlement connection");
  const gone = await prisma.plaidItem.findUniqueOrThrow({ where: { itemId: "exp-itm" } });
  assert.ok(gone.disconnectedAt !== null && gone.accessToken === "", "connection soft-deleted: disconnected + token cleared");
  assert.ok(await prisma.plaidAccount.findUnique({ where: { accountId: "exp-acct" } }), "account data is PRESERVED");
  assert.ok(await prisma.plaidTransaction.findUnique({ where: { transactionId: "exp-txn" } }), "transaction data is PRESERVED");
  assert.equal(await countConnections(EXP), 0, "removed connection no longer counts toward usage");
  assert.deepEqual(await canAddConnection(await expUser()), { ok: false, used: 0 }, "expired user must subscribe before adding a connection");
  assert.equal(await enforceEntitlement(await expUser()), 0, "enforceEntitlement is idempotent (no live items left)");

  // --- Cleanup -------------------------------------------------------------
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.user.deleteMany({ where: { id: EXP } });
  await prisma.plaidInstitution.deleteMany({ where: { institutionId: INST } });
  console.log("\n  ✓ tiers: limits, entitlement, expiry-removal (data preserved), and webhook plan mapping all pass\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
