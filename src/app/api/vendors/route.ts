import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import {
  VendorError,
  listVendors,
  createVendor,
  updateVendor,
  deleteVendor,
} from "@/lib/vendors";

export const dynamic = "force-dynamic";

// V2 vendors CRUD (F3, FR1). Auth via gate() only — no subscription gating (FR10).
// Every mutation rematches (in the lib) so vendorId + the unmatched/conflict
// queues update live. The reorder endpoint lives at ./reorder.

const fail = (e: unknown): NextResponse => {
  if (e instanceof VendorError) return NextResponse.json({ error: e.message }, { status: e.status });
  throw e;
};
const readId = (body: unknown): string =>
  typeof (body as { id?: unknown })?.id === "string" ? (body as { id: string }).id : "";

// GET — the user's vendors with ordered condition rows, priority-ascending.
export async function GET() {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  return NextResponse.json({ vendors: await listVendors(g.user!.id) });
}

// POST — create. Body: { name, icon?, categoryName?, conditions: [...] }.
export async function POST(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const body = await req.json().catch(() => null);
  try {
    return NextResponse.json(await createVendor(g.user!.id, body ?? {}), { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

// PATCH — edit. Body: { id, name, icon?, categoryName?, conditions: [...] }.
// Rows are replaced wholesale.
export async function PATCH(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const body = await req.json().catch(() => null);
  const id = readId(body);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    return NextResponse.json(await updateVendor(g.user!.id, id, body));
  } catch (e) {
    return fail(e);
  }
}

// DELETE — body { id }.
export async function DELETE(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const body = await req.json().catch(() => null);
  const id = readId(body);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await deleteVendor(g.user!.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
