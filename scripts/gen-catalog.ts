// Generate the vendor catalog (src/lib/catalog/generated.json) from yuner25699's real
// vendors: name/link/category/conditions + their cached icon (data URI) when small
// enough to embed. Buckets are NOT here — vendors.ts keeps the 3 authored catch-alls.
// Run inside the pod; then kubectl cp /app/generated.json out to src/lib/catalog/.
import { writeFileSync } from "fs";
import { prisma } from "../src/lib/db";

const ICON_CAP = 8000; // bytes; skip bigger icons (fall back to a letter avatar)
const REAL_EMAIL = "yuner25699@gmail.com";

const num = (d: unknown) => (d == null ? undefined : Number(d));
const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== "")) as T;

(async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: REAL_EMAIL } });
  const vendors = await prisma.vendor.findMany({
    where: { userId: u.id },
    include: { conditions: { orderBy: { order: "asc" } } },
    orderBy: { priority: "asc" },
  });

  const cond = (c: (typeof vendors)[number]["conditions"][number], withCat: boolean) =>
    clean({
      order: c.order,
      categoryName: withCat ? c.categoryName : undefined,
      nameOp: c.nameOp ?? undefined, nameValue: c.nameValue ?? undefined,
      merchantOp: c.merchantOp ?? undefined, merchantValue: c.merchantValue ?? undefined,
      paymentChannel: c.paymentChannel ?? undefined,
      plaidPrimary: c.plaidPrimary ?? undefined, plaidDetailed: c.plaidDetailed ?? undefined,
      amountMin: num(c.amountMin), amountMax: num(c.amountMax),
    });

  let skipped = 0, iconsKept = 0, iconsDropped = 0;
  const entries = [];
  for (const v of vendors) {
    const catRules = v.conditions.filter((c) => c.role === "category");
    const categoryName = v.categoryName ?? catRules.find((c) => c.categoryName)?.categoryName ?? null;
    if (!categoryName) { skipped++; continue; } // catalog entries require a default category
    let icon: string | null = null;
    if (v.icon) { if (v.icon.length <= ICON_CAP) { icon = v.icon; iconsKept++; } else iconsDropped++; }
    entries.push({
      slug: v.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      name: v.name,
      link: v.link ?? null,
      icon,
      categoryName,
      matchConditions: v.conditions.filter((c) => c.role === "match").map((c) => cond(c, false)),
      categoryRules: catRules.map((c) => cond(c, true)),
    });
  }

  const path = "/app/generated.json";
  writeFileSync(path, JSON.stringify(entries, null, 0));
  const bytes = JSON.stringify(entries).length;
  console.log(`wrote ${entries.length} entries (skipped ${skipped} no-category), icons kept ${iconsKept} dropped ${iconsDropped} (>${ICON_CAP}B)`);
  console.log(`file ~${Math.round(bytes / 1024)} KB -> ${path}`);
})().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
