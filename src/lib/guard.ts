import { NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { getSessionUser } from "./auth";

// Gate an API route. Returns { user } on success or { error: Response } to return.
// V2 (FR10) removed the global subscription gate: the Plaid-connection limit (F7)
// is the only billing enforcement, checked at link/exchange — not here.
export async function gate(
  opts: { verified?: boolean } = {}
): Promise<{ user?: User; error?: NextResponse }> {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (opts.verified && !user.emailVerified) {
    return { error: NextResponse.json({ error: "Verify your email first" }, { status: 403 }) };
  }
  return { user };
}

// Prisma Decimal -> number | null for JSON responses.
export const num = (d: unknown): number | null => (d == null ? null : Number(d));
