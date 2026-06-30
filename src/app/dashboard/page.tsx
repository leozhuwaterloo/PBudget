import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isSubscriptionActive } from "@/lib/stripe";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  if (!user.emailVerified) redirect("/verify");

  const items = await prisma.plaidItem.findMany({
    where: { userId: user.id },
    include: { institution: true, _count: { select: { accounts: true } } },
    orderBy: { lastUpdated: "desc" },
  });

  const data = items.map((i) => ({
    itemId: i.itemId,
    name: i.institution.name,
    lastUpdated: i.lastUpdated.toISOString(),
    accounts: i._count.accounts,
  }));

  return <Dashboard items={data} subscribed={isSubscriptionActive(user)} />;
}
