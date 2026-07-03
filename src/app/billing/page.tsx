import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isSubscriptionActive, countManagedAccounts } from "@/lib/stripe";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n";
import BillingClient from "@/components/BillingClient";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const user = await requireUser();
  if (!user.emailVerified) redirect("/verify");

  const accounts = await countManagedAccounts(user.id);
  const active = isSubscriptionActive(user);
  const locale = await getLocale(user);

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <h1>{t(locale, "billing.title")}</h1>
      <p className="muted">{t(locale, "billing.subtitle")}</p>
      <table>
        <tbody>
          <tr>
            <td>{t(locale, "billing.status")}</td>
            <td><strong>{user.subscriptionStatus ?? t(locale, "billing.statusNone")}</strong></td>
          </tr>
          <tr>
            <td>{t(locale, "billing.managedAccounts")}</td>
            <td>{accounts}</td>
          </tr>
          <tr>
            <td>{t(locale, "billing.estimatedMonthly")}</td>
            <td>${Math.max(active ? accounts : 0, 0)}.00</td>
          </tr>
        </tbody>
      </table>
      <BillingClient active={active} hasCustomer={!!user.stripeCustomerId} />
    </div>
  );
}
