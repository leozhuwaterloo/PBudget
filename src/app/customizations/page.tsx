import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// F0 stub. F9→F10→F11 serially own this page: categories, mappings, vendors, billing.
export default async function CustomizationsPage() {
  const user = await requireUser();
  if (!user.emailVerified) redirect("/verify");
  const locale = await getLocale(user);
  return (
    <div>
      <h1>{t(locale, "customizations.title")}</h1>
      <p className="muted">{t(locale, "customizations.stub")}</p>
    </div>
  );
}
