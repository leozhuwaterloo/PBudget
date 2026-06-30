import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import ItemDetail from "@/components/ItemDetail";

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

  const accounts = item.accounts.map((a) => ({
    account_id: a.accountId,
    name: a.name,
    current: a.current == null ? null : Number(a.current),
    currency_code: a.isoCurrencyCode,
    last_updated: a.lastUpdated.toISOString(),
    transactions: a.transactions
      .slice()
      .sort((x, y) => new Date(y.datetime).getTime() - new Date(x.datetime).getTime())
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
      })),
  }));

  return (
    <ItemDetail
      name={item.institution.name}
      lastUpdated={item.lastUpdated.toISOString()}
      accounts={accounts}
    />
  );
}
