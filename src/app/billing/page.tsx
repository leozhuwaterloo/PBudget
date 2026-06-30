import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isSubscriptionActive, countManagedAccounts } from "@/lib/stripe";
import BillingClient from "@/components/BillingClient";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const user = await requireUser();
  if (!user.emailVerified) redirect("/verify");

  const accounts = await countManagedAccounts(user.id);
  const active = isSubscriptionActive(user);

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <h1>Billing</h1>
      <p className="muted">$1 per managed account, per month.</p>
      <table>
        <tbody>
          <tr>
            <td>Status</td>
            <td><strong>{user.subscriptionStatus ?? "none"}</strong></td>
          </tr>
          <tr>
            <td>Managed accounts</td>
            <td>{accounts}</td>
          </tr>
          <tr>
            <td>Estimated monthly</td>
            <td>${Math.max(active ? accounts : 0, 0)}.00</td>
          </tr>
        </tbody>
      </table>
      <BillingClient active={active} hasCustomer={!!user.stripeCustomerId} />
    </div>
  );
}
