import { NextResponse } from "next/server";
import { gate, num } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { createMergeGroup } from "@/lib/analysis/merge";
import { analyzeUser } from "@/lib/analysis/analyze";
import { splitParentIds } from "@/lib/splits";

// GET /api/merge — all confirmed merge groups (the "Merged groups" tab in
// Customizations). Pending/auto groups stay in Review's confirmation queue.
export async function GET() {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  const groups = await prisma.mergeGroup.findMany({
    where: { userId, status: "confirmed" },
    include: { legs: true },
    orderBy: { date: "desc" },
  });
  const legIds = groups.flatMap((grp) => grp.legs.map((l) => l.transactionId));
  const txns = await prisma.plaidTransaction.findMany({
    where: { transactionId: { in: legIds } },
    select: { transactionId: true, name: true, amount: true },
  });
  const txnById = new Map(txns.map((tx) => [tx.transactionId, tx]));

  return NextResponse.json({
    groups: groups.map((grp) => ({
      id: grp.id,
      title: grp.title,
      vendor: grp.vendorName,
      amount: num(grp.netAmount),
      currency: grp.currency,
      date: grp.date,
      legs: grp.legs.map((l) => {
        const tx = txnById.get(l.transactionId);
        return { transactionId: l.transactionId, name: tx?.name ?? null, amount: tx ? num(tx.amount) : null };
      }),
    })),
  });
}

// POST /api/merge — manual N-way merge (FR3). Body: { transactionIds: string[] }.
// Validate N≥2, all posted, single currency (a mixed-currency sum is undefined),
// none already grouped; then createMergeGroup(status:"confirmed") — manual merges
// are born confirmed — and re-run the analyzer so the group is evaluated per the
// suspicion rules (transfer rule never fires on groups).
export async function POST(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  const body = await req.json().catch(() => ({}));
  const ids = [...new Set(Array.isArray(body.transactionIds) ? body.transactionIds : [])].filter(
    (x): x is string => typeof x === "string"
  );
  if (ids.length < 2) {
    return NextResponse.json({ error: "Select at least 2 transactions to merge" }, { status: 400 });
  }

  const txns = await prisma.plaidTransaction.findMany({
    where: { transactionId: { in: ids }, account: { item: { userId } } },
  });
  if (txns.length !== ids.length) {
    return NextResponse.json({ error: "Unknown transaction" }, { status: 400 });
  }
  if (txns.some((t) => t.pending)) {
    return NextResponse.json({ error: "All transactions must be posted" }, { status: 400 });
  }
  if (new Set(txns.map((t) => t.isoCurrencyCode)).size > 1) {
    return NextResponse.json({ error: "All transactions must share one currency" }, { status: 400 });
  }
  const grouped = await prisma.mergeGroupLeg.findMany({ where: { transactionId: { in: ids } } });
  if (grouped.length > 0) {
    return NextResponse.json({ error: "Some transactions are already in a group" }, { status: 400 });
  }
  // Merge/split mutual exclusion (FR5): a split parent can't be merged — unsplit first.
  const splitParents = await splitParentIds(userId);
  if (ids.some((id) => splitParents.has(id))) {
    return NextResponse.json({ error: "A split transaction cannot be merged; unsplit it first" }, { status: 400 });
  }

  const group = await createMergeGroup(userId, ids, { status: "confirmed" });
  await analyzeUser(userId); // evaluate the new group per the merge rules

  return NextResponse.json(
    {
      group: {
        id: group.id,
        status: group.status,
        title: group.title,
        vendorName: group.vendorName,
        categoryName: group.categoryName,
        date: group.date,
        netAmount: num(group.netAmount),
        currency: group.currency,
        legs: ids,
      },
    },
    { status: 201 }
  );
}
