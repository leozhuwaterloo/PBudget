import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { CatalogError, instantiateCatalogEntry } from "@/lib/catalog/instantiate";

export const dynamic = "force-dynamic";

// POST /api/catalog/instantiate { slug } — one-time copy of a catalog entry into
// the user's own editable vendor (appended at lowest priority), then F1 rematch.
export async function POST(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;

  const body = (await req.json().catch(() => null)) as { slug?: unknown } | null;
  const slug = body?.slug;
  if (typeof slug !== "string" || !slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  try {
    const { claimed, ...vendor } = await instantiateCatalogEntry(g.user!.id, slug);
    return NextResponse.json({ vendor, claimed });
  } catch (e) {
    if (e instanceof CatalogError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
