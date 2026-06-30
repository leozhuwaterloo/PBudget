import { NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { getSessionUser } from "./auth";
import { isSubscriptionActive } from "./stripe";

// Gate an API route. Returns { user } on success or { error: Response } to return.
export async function gate(
  opts: { verified?: boolean; subscribed?: boolean } = {}
): Promise<{ user?: User; error?: NextResponse }> {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (opts.verified && !user.emailVerified) {
    return { error: NextResponse.json({ error: "Verify your email first" }, { status: 403 }) };
  }
  if (opts.subscribed && !isSubscriptionActive(user)) {
    return { error: NextResponse.json({ error: "An active subscription is required" }, { status: 402 }) };
  }
  return { user };
}

// Prisma Decimal -> number | null for JSON responses.
export const num = (d: unknown): number | null => (d == null ? null : Number(d));
