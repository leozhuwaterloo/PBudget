import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { prisma } from "@/lib/db";

// POST /api/flags/[id]/dismiss — dismiss a flag (permanent per FR4/criterion 16).
// Works for txn- and group-level flags; the analyzer never reopens a dismissed
// flag, so this is the only step needed. Idempotent.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;

  const flag = await prisma.transactionFlag.findFirst({
    where: { id: params.id, userId: g.user!.id },
  });
  if (!flag) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.transactionFlag.update({
    where: { id: flag.id },
    data: { status: "dismissed", resolvedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
