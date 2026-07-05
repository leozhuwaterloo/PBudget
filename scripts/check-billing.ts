// F11 quality gate — asserts the /customizations billing summary: current tier,
// live connection usage (PlaidItem count), subscription state, and the tier table
// with prices. Deterministic, no network (rows inserted directly). Run:
//   npm run check:billing
import assert from "assert";
import { prisma } from "../src/lib/db";
import { billingSummary } from "../src/lib/stripe";

const USER = "billing-test-user";
const INST = "billing-test-inst";

function user() {
  return prisma.user.findUniqueOrThrow({ where: { id: USER } });
}
async function addItem(itemId: string): Promise<void> {
  await prisma.plaidItem.create({
    data: {
      itemId,
      userId: USER,
      institutionId: INST,
      accessToken: "enc",
      lastForceRefreshed: new Date(),
    },
  });
}

async function main(): Promise<void> {
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.plaidInstitution.deleteMany({ where: { institutionId: INST } });
  await prisma.plaidInstitution.create({ data: { institutionId: INST, name: "Test Bank" } });
  await prisma.user.create({ data: { id: USER, email: `${USER}@t.local`, passwordHash: "x" } });

  // --- Fresh free user: Free tier, 0 of 1 used, no subscription, no customer ---
  let s = await billingSummary(await user());
  assert.equal(s.plan, "free", "new user is on the free plan");
  assert.equal(s.used, 0, "no connections yet");
  assert.equal(s.limit, 1, "free limit is 1");
  assert.equal(s.active, false, "no active subscription");
  assert.equal(s.hasCustomer, false, "no stripe customer");
  // Tier table carries prices + limits (the static product facts the UI renders).
  assert.deepEqual(
    s.tiers,
    [
      { id: "free", price: 0, limit: 1 },
      { id: "pro", price: 5, limit: 5 },
      { id: "max", price: 15, limit: 20 },
    ],
    "tier table lists free/pro/max with prices and connection limits"
  );
  // A free, non-subscribed user is the Checkout case (no active sub); the UI
  // offers Subscribe on the paid tiers and shows no portal link.
  assert.ok(!s.active && !s.hasCustomer, "free user: Checkout offered, no portal");

  // --- Usage tracks PlaidItem count ---------------------------------------
  await addItem("itm-1");
  await addItem("itm-2");
  await addItem("itm-3");
  s = await billingSummary(await user());
  assert.equal(s.used, 3, "usage equals the user's PlaidItem count");

  // --- Pro user with an active subscription: portal, not Checkout ----------
  await prisma.user.update({
    where: { id: USER },
    data: { plan: "pro", subscriptionStatus: "active", stripeCustomerId: "cus_billingtest" },
  });
  s = await billingSummary(await user());
  assert.equal(s.plan, "pro", "plan reflects the pro subscription");
  assert.equal(s.limit, 5, "pro limit is 5");
  assert.equal(s.active, true, "subscription is active");
  assert.equal(s.hasCustomer, true, "has a stripe customer");
  // active + hasCustomer → the UI shows the portal management link and no Checkout.
  assert.ok(s.active && s.hasCustomer, "pro user: portal management link, no Checkout");

  // --- Cleanup -------------------------------------------------------------
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.plaidInstitution.deleteMany({ where: { institutionId: INST } });
  console.log("\n  ✓ F11 billing: tier, usage=PlaidItem count, subscription state, tier table all pass\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
