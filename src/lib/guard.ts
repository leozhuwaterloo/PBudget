import { NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { getSessionUser } from "./auth";
import { isSubscriptionActive, trialActive, enforceEntitlement } from "./stripe";

// Gate an API route. Returns { user } on success or { error: Response } to return.
// The Plaid-connection entitlement is the only billing enforcement: checked at
// link/exchange, and reaped here (lazily) when a free trial has elapsed.
export async function gate(
  opts: { verified?: boolean } = {}
): Promise<{ user?: User; error?: NextResponse }> {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (opts.verified && !user.emailVerified) {
    return { error: NextResponse.json({ error: "Verify your email first" }, { status: 403 }) };
  }
  // Lazy expiry reaper (no cron): a free trial that has ended with no active paid sub
  // is entitled to 0 connections — remove any that linger (data preserved). Cheap in
  // the common case: admins / active subs / in-trial users short-circuit before any
  // query, and once reaped there are no live items left so it's a single empty read.
  if (!user.isAdmin && !isSubscriptionActive(user) && !trialActive(user)) {
    try { await enforceEntitlement(user); } catch { /* billing reap is best-effort; never block the request */ }
  }
  return { user };
}

// Prisma Decimal -> number | null for JSON responses.
export const num = (d: unknown): number | null => (d == null ? null : Number(d));
