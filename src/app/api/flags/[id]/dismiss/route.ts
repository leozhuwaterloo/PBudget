import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { dismissFlag } from "@/lib/review";

// POST /api/flags/[id]/dismiss — dismiss a flag (permanent per FR4/criterion 16).
// Works for txn- and group-level flags; the analyzer never reopens a dismissed
// flag, so this is the only step needed. Idempotent. unmatched_vendor items
// cannot be dismissed (they clear only by matching) — dismissFlag rejects them.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;

  const result = await dismissFlag(g.user!.id, params.id);
  if (result === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (result === "forbidden")
    return NextResponse.json(
      { error: "unmatched_vendor items cannot be dismissed — they clear only by matching a vendor" },
      { status: 422 }
    );
  return NextResponse.json({ ok: true });
}
