import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { CatalogError } from "@/lib/catalog/instantiate";
import { adoptVendor } from "@/lib/catalog/share";

export const dynamic = "force-dynamic";

// POST /api/catalog/instantiate { vendorId, mode: "clone" | "link" } — adopt a
// shared rule into the user's own vendor list, then rematch. clone = independent
// editable copy; link = a re-syncable snapshot that remembers its source.
export async function POST(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;

  const body = (await req.json().catch(() => null)) as { vendorId?: unknown; mode?: unknown } | null;
  const vendorId = typeof body?.vendorId === "string" ? body.vendorId : "";
  const mode = body?.mode === "link" ? "link" : "clone";
  if (!vendorId) return NextResponse.json({ error: "vendorId required" }, { status: 400 });

  try {
    const { claimed, ...vendor } = await adoptVendor(g.user!.id, vendorId, mode);
    return NextResponse.json({ vendor, claimed });
  } catch (e) {
    if (e instanceof CatalogError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
