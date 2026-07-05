import Stripe from "stripe";
import type { User } from "@prisma/client";
import { prisma } from "./db";

// Billing model (FR10): tiers priced per Plaid CONNECTION (a PlaidItem is one
// bank login, NOT one account). Free = 1 connection (no card, no subscription),
// Pro ($5/mo) = 5, Max ($15/mo) = 20. The two flat prices are created manually
// in Stripe and referenced by env (STRIPE_PRICE_PRO / STRIPE_PRICE_MAX, seeded
// in Vault by F15). The webhook maps a subscription's price id -> User.plan; the
// connection limit is the ONLY billing gate (the global subscription gate is gone).

export type Plan = "free" | "pro" | "max";
export type Tier = "pro" | "max";

export const TIER_LIMITS: Record<Plan, number> = { free: 1, pro: 5, max: 20 };

// Connection limit for a plan string (unknown/legacy -> free).
export function limitFor(plan: string): number {
  return TIER_LIMITS[plan as Plan] ?? TIER_LIMITS.free;
}

// The tier a user could upgrade to next (null at the top).
export function nextTier(plan: string): Tier | null {
  return plan === "free" ? "pro" : plan === "pro" ? "max" : null;
}

let _stripe: Stripe | null = null;
export function stripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  _stripe = new Stripe(key);
  return _stripe;
}

const ACTIVE = new Set(["active", "trialing"]);
export function isSubscriptionActive(user: User): boolean {
  return !!user.subscriptionStatus && ACTIVE.has(user.subscriptionStatus);
}

// Env price id for a paid tier.
function tierPriceId(tier: Tier): string {
  const id = tier === "max" ? process.env.STRIPE_PRICE_MAX : process.env.STRIPE_PRICE_PRO;
  if (!id) throw new Error(`Stripe price for tier "${tier}" is not configured`);
  return id;
}

// price id -> plan mapping, read from env each call so tests can set it.
function priceToPlan(priceId: string | undefined): Plan | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_MAX) return "max";
  return null;
}

// The plan a subscription grants: only active/trialing with a known price is paid.
export function planForSubscription(priceId: string | undefined, status: string): Plan {
  if (!ACTIVE.has(status)) return "free";
  return priceToPlan(priceId) ?? "free";
}

// ---- Connection counting / enforcement -----------------------------------

// A connection is a PlaidItem (one bank login). This is the metered unit.
export function countConnections(userId: string): Promise<number> {
  return prisma.plaidItem.count({ where: { userId } });
}

// Legacy: per-account count, still read by the old /billing page (deleted in F14).
export function countManagedAccounts(userId: string): Promise<number> {
  return prisma.plaidAccount.count({ where: { item: { userId } } });
}

// Structured 402 payload the UI turns into an upgrade CTA.
export interface UpgradeCTA {
  error: string;
  code: "connection_limit";
  plan: Plan;
  limit: number;
  used: number;
  upgradeTo: Tier | null;
}
export function upgradeCTA(plan: string, used: number): UpgradeCTA {
  const p = (plan as Plan) in TIER_LIMITS ? (plan as Plan) : "free";
  return {
    error: "You've reached your plan's Plaid connection limit.",
    code: "connection_limit",
    plan: p,
    limit: TIER_LIMITS[p],
    used,
    upgradeTo: nextTier(p),
  };
}

// May the user add a NEW connection (link token / first exchange of a new item)?
export async function canAddConnection(
  user: User
): Promise<{ ok: true } | { ok: false; used: number }> {
  const used = await countConnections(user.id);
  return used < limitFor(user.plan) ? { ok: true } : { ok: false, used };
}

// Pure rank check: items are ordered by createdAt asc; the first `limit` sync.
export function itemSyncAllowed(orderedItemIds: string[], itemId: string, plan: string): boolean {
  const rank = orderedItemIds.indexOf(itemId);
  return rank >= 0 && rank < limitFor(plan);
}

// May this EXISTING item sync? On downgrade the oldest `limit` items keep
// syncing; excess items are read-only until upgrade or disconnect.
export async function canSyncItem(
  user: User,
  itemId: string
): Promise<{ ok: true } | { ok: false; used: number }> {
  const items = await prisma.plaidItem.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { itemId: true },
  });
  const ok = itemSyncAllowed(items.map((i) => i.itemId), itemId, user.plan);
  return ok ? { ok: true } : { ok: false, used: items.length };
}

// ---- Stripe plumbing -----------------------------------------------------

async function getOrCreateCustomer(user: User): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe().customers.create({
    email: user.email,
    metadata: { userId: user.id },
  });
  await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

// Checkout is for the FIRST subscription only; tier switches / cancel / payment
// go through the billing portal.
export async function createCheckoutSession(user: User, tier: Tier): Promise<string> {
  if (isSubscriptionActive(user)) {
    throw new Error("Already subscribed — use the billing portal to switch tiers");
  }
  const priceId = tierPriceId(tier);
  const customer = await getOrCreateCustomer(user);
  const base = process.env.APP_URL || "http://localhost:5300";
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${base}/customizations?billing=success`,
    cancel_url: `${base}/customizations?billing=cancelled`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

export async function createPortalSession(user: User): Promise<string> {
  if (!user.stripeCustomerId) throw new Error("No Stripe customer for user");
  const base = process.env.APP_URL || "http://localhost:5300";
  const session = await stripe().billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${base}/customizations`,
  });
  return session.url;
}

// Apply a Stripe webhook event to our User row. The subscription's price id maps
// to User.plan; anything but active/trialing falls back to free.
export async function applyWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      // Records the customer/subscription ids; the plan is set by the
      // subscription.created/updated event (which carries the price id).
      const s = event.data.object as Stripe.Checkout.Session;
      const userId = s.client_reference_id;
      if (userId && s.subscription) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            stripeCustomerId: (s.customer as string) ?? undefined,
            stripeSubscriptionId: s.subscription as string,
          },
        });
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const user = await prisma.user.findFirst({
        where: { stripeCustomerId: sub.customer as string },
      });
      if (!user) break;
      const status = event.type === "customer.subscription.deleted" ? "canceled" : sub.status;
      const plan = planForSubscription(sub.items.data[0]?.price?.id, status);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          stripeSubscriptionId: sub.id,
          subscriptionStatus: status,
          plan,
        },
      });
      break;
    }
  }
}
