import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { restoreFlag } from "@/lib/review";

// POST /api/flags/[id]/restore — un-mark a marked-valid (dismissed) suspicion
// flag, reopening it. Inverse of dismiss; used by Customizations → Marked valid.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;

  const result = await restoreFlag(g.user!.id, params.id);
  if (result === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
