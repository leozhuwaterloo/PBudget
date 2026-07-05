import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import VendorBuilder from "@/components/VendorBuilder";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// Vendors split out of /customizations into its own page. Session gate mirrors
// the customizations page; VendorBuilder owns all fetching.
export default async function VendorsPage() {
  const user = await requireUser();
  if (!user.emailVerified) redirect("/verify");
  const locale = await getLocale(user);
  return (
    <div>
      <h1>{t(locale, "cust.nav.vendors")}</h1>
      <VendorBuilder />
    </div>
  );
}
