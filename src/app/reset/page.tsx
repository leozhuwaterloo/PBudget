import Link from "next/link";
import { prisma } from "@/lib/db";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n";
import ResetForm from "@/components/ResetForm";

export default async function ResetPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams?.token;
  const locale = await getLocale();

  const row = token
    ? await prisma.passwordResetToken.findUnique({ where: { token } })
    : null;

  if (!row || row.expiresAt < new Date()) {
    return (
      <div className="auth card">
        <h1>{t(locale, "reset.invalidTitle")}</h1>
        <p className="muted">{t(locale, "reset.invalidBody")}</p>
        <p className="muted" style={{ marginTop: 16 }}>
          <Link href="/forgot">{t(locale, "reset.requestNew")}</Link>
        </p>
      </div>
    );
  }

  return <ResetForm token={token!} />;
}
