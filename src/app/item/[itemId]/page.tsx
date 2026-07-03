import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { effectiveTransactions } from "@/lib/analysis/effective";
import { getLocale } from "@/lib/i18n/server";
import ItemDetail from "@/components/ItemDetail";
import type { Txn } from "@/components/TransactionTable";

export const dynamic = "force-dynamic";

export default async function ItemPage({ params }: { params: { itemId: string } }) {
  const user = await requireUser();
  if (!user.emailVerified) redirect("/verify");

  const item = await prisma.plaidItem.findUnique({
    where: { itemId: params.itemId },
    include: {
      institution: true,
      accounts: { include: { transactions: true }, orderBy: { name: "asc" } },
    },
  });
  if (!item || item.userId !== user.id) notFound();

  const rawTxns = item.accounts.flatMap((a) => a.transactions);
  const itemTxnIds = new Set(rawTxns.map((t) => t.transactionId));

  // Groups touching this item collapse their legs into one synthetic row (FR3).
  // Legs must not also render individually; pending txns are never legs.
  const groups = (await effectiveTransactions(user.id)).filter(
    (e) => e.isGroup && e.legs.some((l) => itemTxnIds.has(l.id))
  );
  const legIds = new Set(groups.flatMap((g) => g.legs.map((l) => l.id)));

  const individual: Txn[] = rawTxns
    .filter((t) => !legIds.has(t.transactionId))
    .map((t) => ({
      transaction_id: t.transactionId,
      name: t.name,
      merchant_name: t.merchantName,
      amount: Number(t.amount),
      currency_code: t.isoCurrencyCode,
      datetime: t.datetime.toISOString(),
      last_updated: t.lastUpdated.toISOString(),
      predicted_category: t.predictedCategory,
      pending: t.pending,
    }));

  const groupRows: Txn[] = groups.map((g) => ({
    transaction_id: g.id,
    name: g.title,
    merchant_name: g.vendorName || null,
    amount: g.amount, // netAmount, Plaid convention; net-0 → 0
    currency_code: g.currency,
    datetime: g.date.toISOString(),
    last_updated: g.date.toISOString(),
    predicted_category: g.categoryName,
    pending: false,
    is_group: true,
    leg_count: g.legs.length,
  }));

  const transactions = [...individual, ...groupRows].sort(
    (a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime()
  );

  const accounts = item.accounts.map((a) => ({
    account_id: a.accountId,
    name: a.name,
    current: a.current == null ? null : Number(a.current),
    currency_code: a.isoCurrencyCode,
    last_updated: a.lastUpdated.toISOString(),
    transaction_count: a.transactions.length,
  }));

  return (
    <ItemDetail
      name={item.institution.name}
      lastUpdated={item.lastUpdated.toISOString()}
      accounts={accounts}
      transactions={transactions}
      locale={await getLocale(user)}
    />
  );
}
