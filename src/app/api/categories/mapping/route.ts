import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { plaidPrimary } from "@/lib/analysis/vendor";
import { humanize, categoryFor } from "@/lib/categories";

export const dynamic = "force-dynamic";

// GET /api/categories/mapping — every Plaid personal_finance_category primary the
// user has a transaction for, each with its effective category (CategoryMapping
// override or humanized default) and whether it's overridden. `categories` is the
// user's existing category names, for the free-text suggestions (FR6).
export async function GET() {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  const [txns, mappings, categories] = await Promise.all([
    prisma.plaidTransaction.findMany({
      where: { account: { item: { userId } } },
      select: { category: true },
    }),
    prisma.categoryMapping.findMany({ where: { userId } }),
    prisma.transactionCategory.findMany({
      where: { userId },
      select: { name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const overridden = new Set(mappings.map((m) => m.plaidPrimary));
  const primaries = [
    ...new Set(txns.map((t) => plaidPrimary(t.category)).filter((p): p is string => !!p)),
  ];

  const rows = primaries
    .map((p) => ({
      plaidPrimary: p,
      default: humanize(p),
      category: categoryFor(mappings, p),
      overridden: overridden.has(p),
    }))
    .sort((a, b) => a.default.localeCompare(b.default, "en", { sensitivity: "base" }));

  return NextResponse.json({ mappings: rows, categories: categories.map((c) => c.name) });
}

// PUT /api/categories/mapping — upsert (or clear) one primary→category override.
// Body: { plaidPrimary, categoryName }. A blank categoryName clears the override
// (revert to the humanized default). Setting one ensures its per-user
// TransactionCategory row exists (budget 0), the same upsert plaid.ts does at
// sync. Mapping applies at read time (categoryFor), so no backfill — /report and
// /budget move spend retroactively.
export async function PUT(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  const body = await req.json().catch(() => null);
  const primary = typeof body?.plaidPrimary === "string" ? body.plaidPrimary.trim() : "";
  const categoryName = typeof body?.categoryName === "string" ? body.categoryName.trim() : "";
  if (!primary) return NextResponse.json({ error: "plaidPrimary required" }, { status: 400 });

  if (!categoryName) {
    await prisma.categoryMapping.deleteMany({ where: { userId, plaidPrimary: primary } });
  } else {
    await prisma.transactionCategory.upsert({
      where: { userId_name: { userId, name: categoryName } },
      create: { userId, name: categoryName },
      update: {},
    });
    await prisma.categoryMapping.upsert({
      where: { userId_plaidPrimary: { userId, plaidPrimary: primary } },
      create: { userId, plaidPrimary: primary, categoryName },
      update: { categoryName },
    });
  }

  return NextResponse.json({
    plaidPrimary: primary,
    default: humanize(primary),
    category: categoryName || humanize(primary),
    overridden: !!categoryName,
  });
}
