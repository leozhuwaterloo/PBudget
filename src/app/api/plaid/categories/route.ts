import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { prisma } from "@/lib/db";

// Set the monthly budget for one of the user's categories.
export async function PATCH(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const { name, budget } = await req.json().catch(() => ({}));
  if (typeof name !== "string" || !name) {
    return NextResponse.json({ error: "Missing category name" }, { status: 400 });
  }
  const b = Number(budget);
  if (!Number.isFinite(b) || b < 0) {
    return NextResponse.json({ error: "Budget must be a non-negative number" }, { status: 400 });
  }
  const cat = await prisma.transactionCategory.upsert({
    where: { userId_name: { userId: g.user!.id, name } },
    create: { userId: g.user!.id, name, budget: b },
    update: { budget: b },
  });
  return NextResponse.json({ name: cat.name, budget: Number(cat.budget) });
}
