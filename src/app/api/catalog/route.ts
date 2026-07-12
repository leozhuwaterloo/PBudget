import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { browseCommunity } from "@/lib/catalog/share";

export const dynamic = "force-dynamic";

// GET /api/catalog?q=&userId= — browse community-shared vendor rules (everything a
// user shared + all of Admin's), filtered by a name substring and/or an owner user
// id. Returns { entries, adminUserId } — the full rows are included for preview.
export async function GET(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const userId = url.searchParams.get("userId") || undefined;
  return NextResponse.json(await browseCommunity(g.user!.id, { q, userId }));
}
