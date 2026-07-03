import { NextResponse } from "next/server";
import { gate, num } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { normalizeVendor } from "@/lib/analysis/vendor";
import { RULES } from "@/lib/analysis/constants";

// GET /api/flags?day=YYYY-MM-DD|month=YYYY-MM
// Open flags grouped by rule + auto merge-groups pending confirmation (newest
// first), plus counters {today, thisMonth, totalOpen} = open flags + status-auto
// groups counted by txn/group date (FR5). day/month filters the LISTED entries;
// counters are always absolute (today / this-month / all-open).

// UTC calendar boundaries so the YYYY-MM-DD / YYYY-MM params parse consistently.
const dayRange = (d: Date) => {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
};
const monthRange = (d: Date) => {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
};
const inRange = (date: Date, r: { start: Date; end: Date } | null) =>
  !r || (date >= r.start && date < r.end);

type FlagEntry =
  | { id: string; rule: string; level: "transaction"; transactionId: string; vendor: string; name: string; amount: number | null; currency: string | null; date: Date }
  | { id: string; rule: string; level: "group"; mergeGroupId: string; vendor: string | null; title: string; amount: number | null; currency: string | null; date: Date };

export async function GET(req: Request) {
  const g = await gate({ verified: true, subscribed: true });
  if (g.error) return g.error;
  const userId = g.user!.id;

  const { searchParams } = new URL(req.url);
  const day = searchParams.get("day");
  const month = searchParams.get("month");
  let filter: { start: Date; end: Date } | null = null;
  if (day) {
    const d = new Date(`${day}T00:00:00Z`);
    if (isNaN(d.getTime())) return NextResponse.json({ error: "Invalid day" }, { status: 400 });
    filter = dayRange(d);
  } else if (month) {
    const d = new Date(`${month}-01T00:00:00Z`);
    if (isNaN(d.getTime())) return NextResponse.json({ error: "Invalid month" }, { status: 400 });
    filter = monthRange(d);
  }

  const openFlags = await prisma.transactionFlag.findMany({ where: { userId, status: "open" } });
  const autoGroups = await prisma.mergeGroup.findMany({
    where: { userId, status: "auto" },
    include: { legs: true },
  });

  // Load the targets the flags/groups point at, in bulk, to render each entry.
  const txnIds = new Set<string>(openFlags.flatMap((f) => (f.transactionId ? [f.transactionId] : [])));
  autoGroups.forEach((grp) => grp.legs.forEach((l) => txnIds.add(l.transactionId)));
  const groupIds = openFlags.flatMap((f) => (f.mergeGroupId ? [f.mergeGroupId] : []));
  const txns = await prisma.plaidTransaction.findMany({
    where: { transactionId: { in: [...txnIds] } },
  });
  const groups = await prisma.mergeGroup.findMany({ where: { id: { in: groupIds } } });
  const txnMap = new Map(txns.map((t) => [t.transactionId, t]));
  const groupMap = new Map(groups.map((gr) => [gr.id, gr]));

  // Build one entry per open flag (skip any whose target vanished — data safety).
  const flagEntries: FlagEntry[] = openFlags.flatMap((f): FlagEntry[] => {
    if (f.transactionId) {
      const t = txnMap.get(f.transactionId);
      if (!t) return [];
      return [{
        id: f.id, rule: f.rule, level: "transaction" as const,
        transactionId: t.transactionId, vendor: normalizeVendor(t.merchantName, t.name),
        name: t.name, amount: num(t.amount), currency: t.isoCurrencyCode, date: t.datetime,
      }];
    }
    const grp = groupMap.get(f.mergeGroupId!);
    if (!grp) return [];
    return [{
      id: f.id, rule: f.rule, level: "group" as const,
      mergeGroupId: grp.id, vendor: grp.vendorName, title: grp.title,
      amount: num(grp.netAmount), currency: grp.currency, date: grp.date,
    }];
  });

  const pendingGroups = autoGroups.map((grp) => ({
    id: grp.id, title: grp.title, vendor: grp.vendorName,
    amount: num(grp.netAmount), currency: grp.currency, date: grp.date,
    legs: grp.legs.map((l) => {
      const t = txnMap.get(l.transactionId);
      return { transactionId: l.transactionId, name: t?.name ?? null, amount: t ? num(t.amount) : null };
    }),
  }));

  // Counters (absolute): each open flag + each auto group, by its own date.
  const now = new Date();
  const today = dayRange(now);
  const thisMonth = monthRange(now);
  const allDates = [...flagEntries.map((e) => e.date), ...pendingGroups.map((p) => p.date)];
  const counters = {
    today: allDates.filter((d) => inRange(d, today)).length,
    thisMonth: allDates.filter((d) => inRange(d, thisMonth)).length,
    totalOpen: allDates.length,
  };

  // Display lists: apply the day/month filter, newest transaction/group first.
  const byDateDesc = (a: { date: Date }, b: { date: Date }) => b.date.getTime() - a.date.getTime();
  const flagsByRule: Record<string, FlagEntry[]> = {};
  for (const rule of Object.values(RULES)) flagsByRule[rule] = [];
  for (const e of flagEntries.filter((x) => inRange(x.date, filter)).sort(byDateDesc)) {
    (flagsByRule[e.rule] ??= []).push(e);
  }

  return NextResponse.json({
    counters,
    flagsByRule,
    pendingGroups: pendingGroups.filter((p) => inRange(p.date, filter)).sort(byDateDesc),
  });
}
