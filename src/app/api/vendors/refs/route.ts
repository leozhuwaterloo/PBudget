import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { plaidPrimary, plaidDetailed, plaidConfidence } from "@/lib/analysis/vendor";

export const dynamic = "force-dynamic";

// GET /api/vendors/refs — reference data the vendor builder's condition rows need
// (F10): the user's PlaidAccounts for the account picker, and the Plaid
// primary/detailed enum values actually seen in their transactions so the
// primary/detailed pickers offer real, matchable options (matching is exact —
// see match.ts). Scoped under /api/vendors, which F3/F10 own.
export async function GET() {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  const accounts = await prisma.plaidAccount.findMany({
    where: { item: { userId } },
    select: { accountId: true, name: true, accountSubtype: true },
    orderBy: { name: "asc" },
  });

  // Distinct Plaid primary/detailed observed on posted txns (category JSON text).
  const txns = await prisma.plaidTransaction.findMany({
    where: { pending: false, account: { item: { userId } } },
    select: { category: true },
  });
  const primaries = new Set<string>();
  const detaileds = new Set<string>();
  const confidences = new Set<string>();
  for (const t of txns) {
    const p = plaidPrimary(t.category);
    if (p) primaries.add(p);
    const d = plaidDetailed(t.category);
    if (d) detaileds.add(d);
    const c = plaidConfidence(t.category);
    if (c) confidences.add(c);
  }

  return NextResponse.json({
    accounts: accounts.map((a) => ({ accountId: a.accountId, name: a.name, subtype: a.accountSubtype })),
    plaidPrimaries: [...primaries].sort(),
    plaidDetaileds: [...detaileds].sort(),
    plaidConfidences: [...confidences].sort(),
  });
}
