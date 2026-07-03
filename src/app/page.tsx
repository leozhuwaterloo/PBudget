import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import Landing from "@/components/Landing";

export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");
  const locale = await getLocale(user);
  return <Landing locale={locale} />;
}
