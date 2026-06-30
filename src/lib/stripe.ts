import Stripe from "stripe";
import type { User } from "@prisma/client";
import { prisma } from "./db";

// Billing model: $1 / managed Plaid account / month. We keep a single
// subscription per user whose quantity == the number of accounts they manage.

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

export function countManagedAccounts(userId: string): Promise<number> {
  return prisma.plaidAccount.count({ where: { item: { userId } } });
}

async function getOrCreateCustomer(user: User): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe().customers.create({
    email: user.email,
    metadata: { userId: user.id },
  });
  await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

export async function createCheckoutSession(user: User): Promise<string> {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) throw new Error("STRIPE_PRICE_ID is not set");
  const customer = await getOrCreateCustomer(user);
  const accounts = await countManagedAccounts(user.id);
  const base = process.env.APP_URL || "http://localhost:5300";
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    line_items: [{ price: priceId, quantity: Math.max(1, accounts) }],
    success_url: `${base}/dashboard?billing=success`,
    cancel_url: `${base}/billing?billing=cancelled`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

export async function createPortalSession(user: User): Promise<string> {
  if (!user.stripeCustomerId) throw new Error("No Stripe customer for user");
  const base = process.env.APP_URL || "http://localhost:5300";
  const session = await stripe().billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${base}/billing`,
  });
  return session.url;
}

// Keep subscription quantity in sync with the user's account count. Call after
// linking / syncing / removing accounts. No-op if there's no active subscription.
export async function reconcileQuantity(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.stripeSubscriptionId || !isSubscriptionActive(user)) return;
  const sub = await stripe().subscriptions.retrieve(user.stripeSubscriptionId);
  const item = sub.items.data[0];
  if (!item) return;
  const quantity = Math.max(1, await countManagedAccounts(userId));
  if (item.quantity === quantity) return;
  await stripe().subscriptions.update(user.stripeSubscriptionId, {
    items: [{ id: item.id, quantity }],
    proration_behavior: "create_prorations",
  });
}

// Apply a Stripe webhook event to our User row.
export async function applyWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      const userId = s.client_reference_id;
      if (userId && s.subscription) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            stripeCustomerId: (s.customer as string) ?? undefined,
            stripeSubscriptionId: s.subscription as string,
            subscriptionStatus: "active",
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
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            stripeSubscriptionId: sub.id,
            subscriptionStatus: event.type === "customer.subscription.deleted" ? "canceled" : sub.status,
          },
        });
      }
      break;
    }
  }
}
