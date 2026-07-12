// Read-only: confirm the demo review queue is populated but modest, and the
// dashboard has categorized spend. No PII (demo data is already anonymized).
import { prisma } from "../src/lib/db";
import { reviewData } from "../src/lib/review";
const DEMO = "demo-real-user";
(async () => {
  const u = await prisma.user.findUnique({ where: { email: "demo@ppvnx.com" } });
  console.log("demo user:", u?.id, "plan:", u?.plan, "verified:", !!u?.emailVerified);
  const txns = await prisma.plaidTransaction.count({ where: { account: { item: { userId: DEMO } } } });
  console.log("total demo txns:", txns);
  const r = await reviewData(DEMO);
  console.log("counters:", r.counters);
  console.log("unmatched queue:", r.unmatchedTotal);
  console.log("duplicate_charge rows:", (r.suspicion["duplicate_charge"] ?? []).length,
    "clusters:", new Set((r.suspicion["duplicate_charge"] ?? []).map((e) => e.dupGroupId)).size);
  console.log("unusual_amount rows:", (r.suspicion["unusual_amount"] ?? []).map((e) => `${e.name} $${e.amount}`));
  console.log("unmatched_transfer rows:", (r.suspicion["unmatched_transfer"] ?? []).length);
  console.log("sample unmatched merchants:", r.unmatched.slice(0, 6).map((x) => `${x.merchantName} $${x.amount}`));
  const cats = await prisma.transactionCategory.findMany({ where: { userId: DEMO }, select: { name: true } });
  console.log("categories:", cats.map((c) => c.name).sort());
})().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
