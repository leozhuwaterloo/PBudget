import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { SplitError, createSplit, replaceSplit, deleteSplit, serializeSplit } from "@/lib/splits";

export const dynamic = "force-dynamic";

// Manual splits write API (FR5). Auth via gate() only — no subscription gating
// (FR10). Keyed by parentTransactionId in the body (one split per transaction).
// POST creates, PUT replaces the parts, DELETE unsplits. Merge/split mutual
// exclusion (a merge leg can't be split) is enforced in the lib.

const fail = (e: unknown): NextResponse => {
  if (e instanceof SplitError) return NextResponse.json({ error: e.message }, { status: e.status });
  throw e;
};
const readParent = (body: unknown): unknown => (body as { parentTransactionId?: unknown })?.parentTransactionId;
const readParts = (body: unknown): unknown => (body as { parts?: unknown })?.parts;

// POST — split a parent into N ≥ 2 parts. Body: { parentTransactionId, parts }.
export async function POST(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const body = await req.json().catch(() => null);
  try {
    const split = await createSplit(g.user!.id, readParent(body), readParts(body));
    return NextResponse.json({ split: serializeSplit(split) }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

// PUT — replace the parts. Body: { parentTransactionId, parts }.
export async function PUT(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const body = await req.json().catch(() => null);
  try {
    const split = await replaceSplit(g.user!.id, readParent(body), readParts(body));
    return NextResponse.json({ split: serializeSplit(split) });
  } catch (e) {
    return fail(e);
  }
}

// DELETE — unsplit. Body: { parentTransactionId }.
export async function DELETE(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const body = await req.json().catch(() => null);
  try {
    await deleteSplit(g.user!.id, readParent(body));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
