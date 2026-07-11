import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { searchCatalog } from "@/lib/catalog/vendors";

export const dynamic = "force-dynamic";

// GET /api/catalog?q= — the vendor catalog (FR2), optionally filtered by a
// case-insensitive substring of the display name. Static authored data, so the
// full entry (match conditions + category rules + default category) is returned
// for preview.
export async function GET(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;

  const q = new URL(req.url).searchParams.get("q") ?? "";
  const entries = searchCatalog(q).map((e) => ({
    slug: e.slug,
    name: e.name,
    link: e.link,
    icon: e.icon ?? null,
    categoryName: e.categoryName,
    matchConditions: e.matchConditions,
    categoryRules: e.categoryRules,
  }));
  return NextResponse.json({ entries });
}
