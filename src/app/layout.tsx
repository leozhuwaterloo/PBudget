import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/context";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import LogoutButton from "@/components/LogoutButton";

export const metadata: Metadata = {
  title: "PBudget",
  description: "Personal budgeting backed by Plaid",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const locale = await getLocale(user);
  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale}>
          <nav className={user ? "nav nav-side" : "nav"}>
            <Link href="/" className="brand">PBudget</Link>
            {user ? (
              <>
                <Link href="/dashboard">{t(locale, "nav.dashboard")}</Link>
                <Link href="/review">{t(locale, "nav.review")}</Link>
                <Link href="/accounts">{t(locale, "nav.accounts")}</Link>
                <Link href="/vendors">{t(locale, "cust.nav.vendors")}</Link>
                <Link href="/customizations">{t(locale, "nav.customizations")}</Link>
                <div className="spacer" />
                <LogoutButton />
              </>
            ) : (
              <>
                <div className="spacer" />
                <Link href="/login">{t(locale, "nav.login")}</Link>
                <Link href="/signup">{t(locale, "nav.signup")}</Link>
              </>
            )}
            <LanguageSwitcher />
          </nav>
          <main className={user ? "main main-side" : "main"}>{children}</main>
        </I18nProvider>
      </body>
    </html>
  );
}
