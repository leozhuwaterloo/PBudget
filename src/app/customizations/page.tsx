import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import Customizations from "@/components/Customizations";

export const dynamic = "force-dynamic";

// F9→F10→F11 serially own this page: categories & budgets, mappings, vendors, billing.
// The client shell owns all fetching; this server component just gates the session.
export default async function CustomizationsPage() {
  const user = await requireUser();
  if (!user.emailVerified) redirect("/verify");
  return <Customizations />;
}
