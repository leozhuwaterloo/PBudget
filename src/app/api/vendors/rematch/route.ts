import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { rematchUser } from "@/lib/analysis/match";

export const dynamic = "force-dynamic";

// FULL re-match of every posted transaction against all vendors (F1). The vendor
// Save button only touches the edited vendor's + unmatched txns (incremental, fast);
// this is the manual "re-resolve everything" escape hatch — e.g. after broadening a
// vendor so it should reclaim txns currently held by a catch-all bucket. Surfaced on
// the Accounts page. Still one bounded pass (batched writes), not per-txn queries.
export async function POST() {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  await rematchUser(g.user!.id);
  return NextResponse.json({ ok: true });
}
