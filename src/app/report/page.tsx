import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { effectiveTransactions } from "@/lib/analysis/effective";
import Report from "@/components/Report";

export const dynamic = "force-dynamic";

// FR6 monthly report. All spend/cash-flow numbers are computed over
// effectiveTransactions (F3), so merge groups collapse to one entry at their net
// (net-0 groups contribute 0) and categories resolve at read time — a remap moves
// historical spend. Flag counts are joined to transaction/group date here so the
// client can bucket them by month (FR5/FR6). Month arithmetic lives client-side in
// <Report>; we hand it the full set once and it filters — no per-month refetch.
export default async function ReportPage() {
  const user = await requireUser();
  if (!user.emailVerified) redirect("/verify");

  const [entries, flags, groups] = await Promise.all([
    effectiveTransactions(user.id),
    prisma.transactionFlag.findMany({ where: { userId: user.id } }),
    prisma.mergeGroup.findMany({ where: { userId: user.id }, select: { id: true, date: true } }),
  ]);

  // A flag's date = its transaction's date, or its group's date (FR5).
  const txnIds = flags.map((f) => f.transactionId).filter((x): x is string => !!x);
  const txns = await prisma.plaidTransaction.findMany({
    where: { transactionId: { in: txnIds } },
    select: { transactionId: true, datetime: true },
  });
  const txnDate = new Map(txns.map((t) => [t.transactionId, t.datetime]));
  const groupDate = new Map(groups.map((g) => [g.id, g.date]));

  const flagRows = flags.flatMap((f) => {
    const date = f.transactionId ? txnDate.get(f.transactionId) : groupDate.get(f.mergeGroupId!);
    return date ? [{ status: f.status, date: date.toISOString() }] : [];
  });

  const entryRows = entries.map((e) => ({
    isGroup: e.isGroup,
    title: e.title,
    category: e.categoryName ?? "Uncategorized",
    date: e.date.toISOString(),
    amount: e.amount, // Plaid convention: + = outflow
    currency: e.currency,
  }));

  // Default month = current month in UTC (matches the flags API's UTC boundaries).
  const now = new Date();
  const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  return <Report entries={entryRows} flags={flagRows} defaultMonth={defaultMonth} />;
}
