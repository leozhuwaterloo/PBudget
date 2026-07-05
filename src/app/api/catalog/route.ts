import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { searchCatalog } from "@/lib/catalog/vendors";

export const dynamic = "force-dynamic";

// GET /api/catalog?q= — the vendor catalog (FR2), optionally filtered by a
// case-insensitive substring of the display name. Static authored data, so the
// full entry (rows + suggested categories + icon slug) is returned for preview.
export async function GET(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;

  const q = new URL(req.url).searchParams.get("q") ?? "";
  const entries = searchCatalog(q).map((e) => ({
    slug: e.slug,
    name: e.name,
    icon: e.icon,
    categoryName: e.categoryName,
    conditions: e.conditions,
  }));
  return NextResponse.json({ entries });
}
