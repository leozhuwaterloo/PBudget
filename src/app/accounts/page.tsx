import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLocale } from "@/lib/i18n/server";
import { canAddConnection, entitledConnections, upgradeCTA } from "@/lib/stripe";
import Accounts from "@/components/Accounts";

export const dynamic = "force-dynamic";

// F8 owns /accounts. Replaces the F0 stub; absorbs the old dashboard items table
// and /item/[itemId]. Per-item connections + a per-account raw transaction browser.
export default async function AccountsPage() {
  const user = await requireUser();
  if (!user.emailVerified) redirect("/verify");

  // createdAt asc = the FR10 sync-priority order: the first `limit` items keep
  // syncing after a downgrade; the rest are read-only.
  const items = await prisma.plaidItem.findMany({
    where: { userId: user.id },
    include: {
      institution: true,
      accounts: {
        // name is encrypted at rest → can't ORDER BY it in SQL; sort in JS below
        // (the db.ts extension has decrypted it to plaintext by the time we read).
        include: { _count: { select: { transactions: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  for (const i of items) i.accounts.sort((a, b) => a.name.localeCompare(b.name));
  // Only LIVE connections rank toward the entitlement; the first `entitlement` sync.
  const entitlement = entitledConnections(user);
  const liveOrderedIds = items.filter((i) => !i.disconnectedAt).map((i) => i.itemId);

  const data = items.map((i) => {
    const disconnected = !!i.disconnectedAt;
    const rank = liveOrderedIds.indexOf(i.itemId);
    return {
    itemId: i.itemId,
    institutionName: i.institution.name,
    institutionLogo: i.institution.logo,
    lastUpdated: i.lastUpdated.toISOString(),
    disconnected,
    syncAllowed: !disconnected && rank >= 0 && rank < entitlement,
    accounts: i.accounts.map((a) => ({
      accountId: a.accountId,
      name: a.name,
      current: a.current == null ? null : Number(a.current),
      currency: a.isoCurrencyCode,
      transactionCount: a._count.transactions,
    })),
    };
  });

  const add = await canAddConnection(user);
  const connect = add.ok
    ? { canAdd: true as const, cta: null }
    : { canAdd: false as const, cta: upgradeCTA(user.plan, add.used) };

  return (
    <Accounts
      items={data}
      connect={connect}
      plan={user.plan}
      limit={Number.isFinite(entitlement) ? entitlement : 0}
      locale={await getLocale(user)}
    />
  );
}
