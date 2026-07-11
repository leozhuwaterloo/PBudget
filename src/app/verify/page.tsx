import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n";
import VerifyForm from "@/components/VerifyForm";

export default async function VerifyPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const locale = await getLocale(user);

  if (user.emailVerified) {
    return (
      <div className="card" style={{ maxWidth: 480, margin: "40px auto" }}>
        <h1>{t(locale, "verify.alreadyTitle")}</h1>
        <Link className="btn btn-primary" href="/dashboard">{t(locale, "verify.goDashboard")}</Link>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 480, margin: "40px auto" }}>
      <h1>{t(locale, "verify.title")}</h1>
      <p className="muted">{t(locale, "verify.body", { email: user.email })}</p>
      <VerifyForm />
    </div>
  );
}
