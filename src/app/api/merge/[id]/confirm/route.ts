import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { prisma } from "@/lib/db";

// POST /api/merge/[id]/confirm — promote an auto group to confirmed (FR3/FR4): an
// auto group is a pending review item until confirmed or dissolved. Flags don't
// change (an auto group is already an effective item, so it was already evaluated).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;

  const group = await prisma.mergeGroup.findFirst({ where: { id: params.id, userId: g.user!.id } });
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (group.status === "auto") {
    await prisma.mergeGroup.update({ where: { id: group.id }, data: { status: "confirmed" } });
  }
  return NextResponse.json({ group: { id: group.id, status: "confirmed" } });
}
