import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { dismissFlag } from "@/lib/review";

// POST /api/flags/[id]/dismiss — dismiss a flag (permanent per FR4/criterion 16).
// Works for txn- and group-level flags; the analyzer never reopens a dismissed
// flag, so this is the only step needed. Idempotent. Queue flags (unmatched_vendor
// + vendor_conflict) cannot be dismissed (they clear only by resolution) —
// dismissFlag rejects them.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;

  const result = await dismissFlag(g.user!.id, params.id);
  if (result === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (result === "forbidden")
    return NextResponse.json(
      { error: "queue items cannot be dismissed — they clear only by resolution" },
      { status: 422 }
    );
  return NextResponse.json({ ok: true });
}
