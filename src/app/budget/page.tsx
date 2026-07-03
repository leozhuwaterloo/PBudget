import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { effectiveTransactions } from "@/lib/analysis/effective";
import Budget from "@/components/Budget";
import type { Txn } from "@/components/TransactionTable";

export const dynamic = "force-dynamic";

export default async function BudgetPage() {
  const user = await requireUser();
  if (!user.emailVerified) redirect("/verify");

  // Merge-aware, mapping-aware source (F7/FR7): each merge group counts once at
  // its net under the group's (categoryFor-resolved) category, net-0 groups sum
  // to 0, and legs never appear individually. effectiveTransactions drops the
  // bank/account labels the drill-down shows, so re-attach them by txn id.
  const [effective, categories, rows] = await Promise.all([
    effectiveTransactions(user.id),
    prisma.transactionCategory.findMany({ where: { userId: user.id } }),
    prisma.plaidTransaction.findMany({
      where: { account: { item: { userId: user.id } } },
      select: {
        transactionId: true,
        merchantName: true,
        account: {
          select: { name: true, item: { select: { institution: { select: { name: true } } } } },
        },
      },
    }),
  ]);
  const detail = new Map(rows.map((r) => [r.transactionId, r]));

  // predicted_category carries the categoryFor-resolved category that Budget
  // groups on, so CategoryMapping overrides move spend here too.
  const transactions: Txn[] = effective.map((e) => {
    const d = e.isGroup ? undefined : detail.get(e.id);
    return {
      transaction_id: e.id,
      name: e.title,
      merchant_name: e.isGroup ? e.vendorName || null : d?.merchantName ?? null,
      item_name: d?.account.item.institution.name,
      account_name: d?.account.name,
      amount: e.amount,
      currency_code: e.currency,
      datetime: e.date.toISOString(),
      last_updated: e.date.toISOString(),
      predicted_category: e.categoryName,
      pending: false,
    };
  });

  return (
    <Budget
      transactions={transactions}
      categories={categories.map((c) => ({ name: c.name, budget: Number(c.budget) }))}
    />
  );
}
