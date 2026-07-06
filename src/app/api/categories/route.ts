import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { gate, num } from "@/lib/guard";
import { prisma } from "@/lib/db";
import {
  CategoryError,
  deleteCategory,
  ensureDefaultCategories,
  updateCategory,
  validateParent,
} from "@/lib/categories";
import type { TransactionCategory } from "@prisma/client";

export const dynamic = "force-dynamic";

// FR4 category CRUD. Auth via gate() only — no subscription gating.

const serialize = (c: TransactionCategory) => ({
  id: c.id,
  name: c.name,
  budget: num(c.budget),
  excludeFromTotals: c.excludeFromTotals,
  parentName: c.parentName,
});

// undefined = not provided (leave as-is), null = clear to top-level, string = set parent.
function readParent(body: unknown): string | null | undefined {
  const b = body as { parentName?: unknown } | null;
  if (!b || !("parentName" in b)) return undefined;
  if (b.parentName == null) return null;
  return typeof b.parentName === "string" && b.parentName.trim() ? b.parentName.trim() : null;
}

// Returns trimmed name (≤100 chars) or null if absent/invalid.
function readName(body: unknown): string | null {
  const raw = (body as { name?: unknown } | null)?.name;
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  return name.length >= 1 && name.length <= 100 ? name : null;
}

// undefined = not provided, null = provided but invalid (→ 400), number = valid.
function readBudget(body: unknown): number | null | undefined {
  const b = body as { budget?: unknown } | null;
  if (!b || !("budget" in b) || b.budget == null) return undefined;
  const n = Number(b.budget);
  return isFinite(n) && n >= 0 ? n : null;
}

// GET /api/categories — the user's categories (lazily seeding the defaults for
// existing users first). { categories: [{ id, name, budget, excludeFromTotals }] }.
export async function GET() {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  await ensureDefaultCategories(userId);
  const categories = await prisma.transactionCategory.findMany({
    where: { userId },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ categories: categories.map(serialize) });
}

// POST /api/categories — create a category. Body: { name, budget?, excludeFromTotals? }.
export async function POST(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  const body = await req.json().catch(() => null);
  const name = readName(body);
  if (!name) return NextResponse.json({ error: "Name must be 1–100 characters" }, { status: 400 });
  const budget = readBudget(body);
  if (budget === null) return NextResponse.json({ error: "budget must be a number ≥ 0" }, { status: 400 });
  const excludeFromTotals = (body as { excludeFromTotals?: unknown })?.excludeFromTotals === true;

  try {
    const parentName = await validateParent(userId, null, readParent(body) ?? null);
    const cat = await prisma.transactionCategory.create({
      data: { userId, name, budget: budget ?? 0, excludeFromTotals, parentName },
    });
    return NextResponse.json(serialize(cat), { status: 201 });
  } catch (e) {
    if (e instanceof CategoryError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 });
    }
    throw e;
  }
}

// PATCH /api/categories — rename / set budget / toggle excludeFromTotals.
// Body: { id, name?, budget?, excludeFromTotals? }. A rename cascades to every
// referencing row (mapping, vendor default, condition, split part).
export async function PATCH(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  const body = await req.json().catch(() => null);
  const id = typeof (body as { id?: unknown })?.id === "string" ? (body as { id: string }).id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const patch: { name?: string; budget?: number; excludeFromTotals?: boolean; parentName?: string | null } = {};
  if ((body as { name?: unknown })?.name !== undefined) {
    const name = readName(body);
    if (!name) return NextResponse.json({ error: "Name must be 1–100 characters" }, { status: 400 });
    patch.name = name;
  }
  const budget = readBudget(body);
  if (budget === null) return NextResponse.json({ error: "budget must be a number ≥ 0" }, { status: 400 });
  if (budget !== undefined) patch.budget = budget;
  if (typeof (body as { excludeFromTotals?: unknown })?.excludeFromTotals === "boolean") {
    patch.excludeFromTotals = (body as { excludeFromTotals: boolean }).excludeFromTotals;
  }
  const parentName = readParent(body);
  if (parentName !== undefined) patch.parentName = parentName;

  try {
    const cat = await updateCategory(userId, id, patch);
    return NextResponse.json(serialize(cat));
  } catch (e) {
    if (e instanceof CategoryError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 });
    }
    throw e;
  }
}

// DELETE /api/categories — body { id }. Rejected (409) while the category name is
// still referenced by any mapping/vendor/condition/split-part row.
export async function DELETE(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  const body = await req.json().catch(() => null);
  const id = typeof (body as { id?: unknown })?.id === "string" ? (body as { id: string }).id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    await deleteCategory(userId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof CategoryError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
