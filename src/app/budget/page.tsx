import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Budget from "@/components/Budget";

export const dynamic = "force-dynamic";

export default async function BudgetPage() {
  const user = await requireUser();
  if (!user.emailVerified) redirect("/verify");

  const [txns, categories] = await Promise.all([
    prisma.plaidTransaction.findMany({
      where: { account: { item: { userId: user.id } } },
      include: { account: { include: { item: { include: { institution: true } } } } },
    }),
    prisma.transactionCategory.findMany({ where: { userId: user.id } }),
  ]);

  // Drop pending transactions superseded by a posted one (ports get_transactions filter).
  const pendingIds = new Set(txns.map((t) => t.pendingTransactionId).filter(Boolean) as string[]);
  const visible = txns.filter((t) => !t.pending || !pendingIds.has(t.transactionId));

  const transactions = visible.map((t) => ({
    transaction_id: t.transactionId,
    name: t.name,
    merchant_name: t.merchantName,
    item_name: t.account.item.institution.name,
    account_name: t.account.name,
    amount: Number(t.amount),
    currency_code: t.isoCurrencyCode,
    datetime: t.datetime.toISOString(),
    last_updated: t.lastUpdated.toISOString(),
    predicted_category: t.predictedCategory,
    pending: t.pending,
  }));

  return <Budget transactions={transactions} categories={categories.map((c) => ({ name: c.name, budget: Number(c.budget) }))} />;
}
