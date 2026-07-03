import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n";
import ResendButton from "@/components/ResendButton";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams?.token;
  const locale = await getLocale();

  if (token) {
    const row = await prisma.emailVerificationToken.findUnique({ where: { token } });
    if (row && row.expiresAt > new Date()) {
      await prisma.user.update({ where: { id: row.userId }, data: { emailVerified: new Date() } });
      await prisma.emailVerificationToken.deleteMany({ where: { userId: row.userId } });
      return (
        <div className="card" style={{ maxWidth: 480, margin: "40px auto" }}>
          <h1>{t(locale, "verify.verifiedTitle")}</h1>
          <p className="muted">{t(locale, "verify.verifiedBody")}</p>
          <Link className="btn btn-primary" href="/dashboard">{t(locale, "verify.goDashboard")}</Link>
        </div>
      );
    }
    return (
      <div className="card" style={{ maxWidth: 480, margin: "40px auto" }}>
        <h1>{t(locale, "verify.invalidTitle")}</h1>
        <p className="muted">{t(locale, "verify.invalidBody")}</p>
        <ResendButton />
      </div>
    );
  }

  const user = await getSessionUser();
  if (user?.emailVerified) {
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
      <p className="muted">
        {t(locale, "verify.body", { email: user?.email ?? t(locale, "verify.yourInbox") })}
      </p>
      <ResendButton />
    </div>
  );
}
