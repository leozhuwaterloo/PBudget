import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { dissolveGroup } from "@/lib/analysis/merge";

// POST /api/merge/[id]/dissolve — break a group back into its legs (FR3). The lib
// remembers the leg set so auto-match never recreates it, then re-runs the
// analyzer to re-flag the freed legs (dismissed flags stay dismissed).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;

  const group = await prisma.mergeGroup.findFirst({ where: { id: params.id, userId: g.user!.id } });
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await dissolveGroup(g.user!.id, group.id);
  return NextResponse.json({ ok: true });
}
