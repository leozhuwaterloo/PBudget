import Stripe from "stripe";
import type { User } from "@prisma/client";
import { prisma } from "./db";
import { removeConnection } from "./plaid";

// Billing model: tiers priced per Plaid CONNECTION (a PlaidItem is one bank login,
// NOT one account). Free = a 1-month TRIAL of 1 connection (no card). Pro ($5/mo) = 5,
// Max ($10/mo) = 20. The two flat prices are created manually in Stripe and referenced
// by env (STRIPE_PRICE_PRO / STRIPE_PRICE_MAX, seeded in Vault). The webhook maps a
// subscription's price id -> User.plan. When entitlement drops (trial ended, or a paid
// sub lapses/cancels), connections over the new entitlement are REMOVED — the Plaid link
// is revoked but the accounts + transactions are preserved (see enforceEntitlement).

export type Plan = "free" | "pro" | "max";
export type Tier = "pro" | "max";

export const TIER_LIMITS: Record<Plan, number> = { free: 1, pro: 5, max: 20 };

// Display-only monthly USD price per tier (the actual charge is the Stripe price).
export const TIER_PRICES: Record<Plan, number> = { free: 0, pro: 5, max: 10 };

// The free tier is a time-boxed trial of 1 connection, measured from signup.
export const TRIAL_DAYS = 30;
const DAY = 86400000;

// When a user's free trial ends (signup + TRIAL_DAYS).
export function trialEndsAt(user: Pick<User, "createdAt">): Date {
  return new Date(user.createdAt.getTime() + TRIAL_DAYS * DAY);
}
// Is the user still inside their free trial window?
export function trialActive(user: Pick<User, "createdAt">): boolean {
  return trialEndsAt(user).getTime() > Date.now();
}

// Connection limit for a plan string (unknown/legacy -> free).
export function limitFor(plan: string): number {
  return TIER_LIMITS[plan as Plan] ?? TIER_LIMITS.free;
}

// How many live Plaid connections this user is entitled to right now:
//   admin            -> unlimited (no subscription needed)
//   active paid sub  -> the tier limit (pro 5 / max 20)
//   free, in trial   -> 1
//   otherwise        -> 0 (trial ended / sub lapsed -> excess connections are removed)
export function entitledConnections(user: Pick<User, "plan" | "isAdmin" | "subscriptionStatus" | "createdAt">): number {
  if (user.isAdmin) return Infinity;
  if (user.subscriptionStatus && ACTIVE.has(user.subscriptionStatus)) return limitFor(user.plan);
  return trialActive(user) ? TIER_LIMITS.free : 0;
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

// A connection is a LIVE PlaidItem (one bank login). Removed (disconnectedAt set)
// items are excluded — they no longer sync and don't count toward the entitlement.
export function countConnections(userId: string): Promise<number> {
  return prisma.plaidItem.count({ where: { userId, disconnectedAt: null } });
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
  return used < entitledConnections(user) ? { ok: true } : { ok: false, used };
}

// May this EXISTING item sync? A removed (disconnected) item never syncs; among the
// live items ordered by createdAt asc, the first `entitledConnections` may sync.
export async function canSyncItem(
  user: User,
  itemId: string
): Promise<{ ok: true } | { ok: false; used: number }> {
  const items = await prisma.plaidItem.findMany({
    where: { userId: user.id, disconnectedAt: null },
    orderBy: { createdAt: "asc" },
    select: { itemId: true },
  });
  const rank = items.findIndex((i) => i.itemId === itemId);
  const ok = rank >= 0 && rank < entitledConnections(user);
  return ok ? { ok: true } : { ok: false, used: items.length };
}

// Remove any LIVE connections beyond the user's current entitlement (oldest kept).
// Called when entitlement can drop: the Stripe webhook (sub lapsed/canceled) and a
// lazy check in the request guard (free trial elapsed). Each removed connection has
// its Plaid link revoked + token cleared, but its accounts + transactions are KEPT.
// Returns the number of connections removed. Idempotent (no-op when within limit).
export async function enforceEntitlement(
  user: Pick<User, "id" | "plan" | "isAdmin" | "subscriptionStatus" | "createdAt">
): Promise<number> {
  const limit = entitledConnections(user);
  if (limit === Infinity) return 0;
  const live = await prisma.plaidItem.findMany({
    where: { userId: user.id, disconnectedAt: null },
    orderBy: { createdAt: "asc" },
    select: { itemId: true, accessToken: true },
  });
  const excess = live.slice(limit); // keep the oldest `limit`, remove the rest
  for (const item of excess) await removeConnection(item.itemId, item.accessToken);
  return excess.length;
}

// Shared entitlement writer used by EVERY billing source (the Stripe webhook AND
// native store IAP). Sets the plan + subscription status — the only two fields that
// grant connections — then reaps any connections now over the new entitlement.
// `extra` carries the source-specific linkage ids (stripe sub id / IAP store token).
export async function setUserTier(
  userId: string,
  plan: Plan,
  subscriptionStatus: string,
  extra: Partial<
    Pick<
      User,
      "stripeSubscriptionId" | "iapPlatform" | "iapProductId" | "iapOriginalTxnId" | "iapPurchaseToken"
    >
  > = {}
): Promise<void> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { plan, subscriptionStatus, ...extra },
  });
  await enforceEntitlement(updated);
}

// ---- Billing summary (F11) ------------------------------------------------

// What the /customizations billing section renders: current tier, live
// connection usage (PlaidItem count), subscription state, and the tier table.
export interface BillingSummary {
  plan: Plan;
  used: number;
  limit: number; // current entitlement (live connections allowed right now)
  admin: boolean;
  active: boolean; // has an active/trialing PAID subscription
  hasCustomer: boolean;
  onTrial: boolean; // free tier, still inside the 1-month trial window
  trialEndsAt: string | null; // ISO; null for admins / paid subscribers
  trialDaysLeft: number | null;
  tiers: { id: Plan; price: number; limit: number }[];
}
export async function billingSummary(user: User): Promise<BillingSummary> {
  const plan = (user.plan as Plan) in TIER_LIMITS ? (user.plan as Plan) : "free";
  const active = isSubscriptionActive(user);
  const onTrial = !user.isAdmin && !active && trialActive(user);
  const showTrial = !user.isAdmin && !active; // trial matters only for unpaid non-admins
  const ends = trialEndsAt(user);
  const limit = entitledConnections(user);
  return {
    plan,
    used: await countConnections(user.id),
    limit: limit === Infinity ? -1 : limit, // -1 = unlimited (admin); UI renders ∞
    admin: user.isAdmin,
    active,
    hasCustomer: !!user.stripeCustomerId,
    onTrial,
    trialEndsAt: showTrial ? ends.toISOString() : null,
    trialDaysLeft: showTrial ? Math.max(0, Math.ceil((ends.getTime() - Date.now()) / DAY)) : null,
    tiers: (["free", "pro", "max"] as Plan[]).map((id) => ({
      id,
      price: TIER_PRICES[id],
      limit: TIER_LIMITS[id],
    })),
  };
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
    success_url: `${base}/customizations?billing=success#billing`,
    cancel_url: `${base}/customizations?billing=cancelled#billing`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

export async function createPortalSession(user: User): Promise<string> {
  if (!user.stripeCustomerId) throw new Error("No Stripe customer for user");
  const base = process.env.APP_URL || "http://localhost:5300";
  const session = await stripe().billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${base}/customizations#billing`,
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
      // setUserTier also reaps connections now over the limit (lapsed/canceled/downgraded).
      await setUserTier(user.id, plan, status, { stripeSubscriptionId: sub.id });
      break;
    }
  }
}
