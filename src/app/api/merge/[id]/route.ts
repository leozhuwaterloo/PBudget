import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { prisma } from "@/lib/db";

// PATCH /api/merge/[id] — retitle a group (the only user-editable field).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await gate({ verified: true, subscribed: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  const group = await prisma.mergeGroup.findFirst({ where: { id: params.id, userId } });
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.mergeGroup.update({
    where: { id: group.id },
    data: { title },
  });
  return NextResponse.json({ group: { id: updated.id, title: updated.title } });
}
