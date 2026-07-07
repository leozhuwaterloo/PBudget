import { NextResponse } from "next/server";
import { gate, num } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { normalizeVendor } from "@/lib/analysis/vendor";

export const dynamic = "force-dynamic";

// GET /api/flags/dismissed — suspicion flags the user marked valid (status
// "dismissed"), newest first, with their target txn/group rendered. Backs the
// Customizations → "Marked valid" tab (the inverse view of Review's suspicion queue).
type Entry = {
  id: string;
  rule: string;
  level: "transaction" | "group";
  vendor: string | null;
  name: string; // txn name or group title
  amount: number | null;
  currency: string | null;
  date: Date;
};

export async function GET() {
  const g = await gate({ verified: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  const flags = await prisma.transactionFlag.findMany({ where: { userId, status: "dismissed" } });
  const txnIds = flags.flatMap((f) => (f.transactionId ? [f.transactionId] : []));
  const groupIds = flags.flatMap((f) => (f.mergeGroupId ? [f.mergeGroupId] : []));
  const txns = await prisma.plaidTransaction.findMany({ where: { transactionId: { in: txnIds } } });
  const groups = await prisma.mergeGroup.findMany({ where: { id: { in: groupIds } } });
  const txnMap = new Map(txns.map((t) => [t.transactionId, t]));
  const groupMap = new Map(groups.map((gr) => [gr.id, gr]));

  const entries: Entry[] = flags.flatMap((f): Entry[] => {
    if (f.transactionId) {
      const t = txnMap.get(f.transactionId);
      if (!t) return [];
      return [{
        id: f.id, rule: f.rule, level: "transaction",
        vendor: normalizeVendor(t.merchantName, t.name), name: t.name,
        amount: num(t.amount), currency: t.isoCurrencyCode, date: t.datetime,
      }];
    }
    const grp = groupMap.get(f.mergeGroupId!);
    if (!grp) return [];
    return [{
      id: f.id, rule: f.rule, level: "group",
      vendor: grp.vendorName, name: grp.title,
      amount: num(grp.netAmount), currency: grp.currency, date: grp.date,
    }];
  });
  entries.sort((a, b) => b.date.getTime() - a.date.getTime());

  return NextResponse.json({ flags: entries });
}
