import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/context";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import LogoutButton from "@/components/LogoutButton";
import NavLink from "@/components/NavLink";
import UserIdBadge from "@/components/UserIdBadge";

// Small ledger-green wordmark badge — three ascending bars (savings growing).
function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
        <path d="M6 18V13M12 18V7M18 18v-8" />
      </svg>
    </span>
  );
}

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
            <Link href="/" className="brand"><BrandMark />PBudget</Link>
            {user ? (
              <>
                <NavLink href="/dashboard" label={t(locale, "nav.dashboard")} icon="dashboard" />
                <NavLink href="/review" label={t(locale, "nav.review")} icon="review" />
                <NavLink href="/accounts" label={t(locale, "nav.accounts")} icon="accounts" />
                <NavLink href="/vendors" label={t(locale, "cust.nav.vendors")} icon="vendors" />
                <NavLink href="/customizations" label={t(locale, "nav.customizations")} icon="customizations" />
                <div className="spacer" />
                <UserIdBadge id={user.id} />
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
