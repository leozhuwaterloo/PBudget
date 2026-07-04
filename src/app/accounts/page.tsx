import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// F0 stub. F8 owns this page: connections + per-account raw transaction browser.
export default async function AccountsPage() {
  const user = await requireUser();
  if (!user.emailVerified) redirect("/verify");
  const locale = await getLocale(user);
  return (
    <div>
      <h1>{t(locale, "accounts.title")}</h1>
      <p className="muted">{t(locale, "accounts.stub")}</p>
    </div>
  );
}
