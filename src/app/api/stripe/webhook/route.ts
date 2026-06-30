import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, applyWebhookEvent } from "@/lib/stripe";

// Raw body is required for signature verification.
export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 400 });
  }
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, sig, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  await applyWebhookEvent(event);
  return NextResponse.json({ received: true });
}
