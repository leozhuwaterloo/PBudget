import "./globals.css";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/context";
import LanguageSwitcher from "@/components/LanguageSwitcher";
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

// Canonical/OG base is the deployed origin. APP_URL is set at runtime in prod,
// but robots/sitemap/canonicals bake at BUILD time (APP_URL unset in the Docker
// build) — so the fallback must be the prod origin, not localhost. Local dev
// still gets localhost via APP_URL in .env.
const SITE_URL = process.env.APP_URL || "https://pbudget.ppvnx.com";

// Native shell = fullscreen webview on notched phones. viewport-fit=cover exposes
// env(safe-area-inset-*) to the CSS; maximumScale/userScalable lock out pinch-zoom.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "PBudget — the personal budget ledger that balances itself",
    template: "%s · PBudget",
  },
  description:
    "PBudget links your bank accounts through Plaid, then automatically categorizes, merges, and reconciles every transaction into a monthly budget ledger you can trust. Free for a month; $3/mo for 6 bank connections, $10/mo for 20. English & 简体中文.",
  applicationName: "PBudget",
  keywords: [
    "personal budgeting app",
    "Plaid budgeting",
    "automatic transaction categorization",
    "bank reconciliation app",
    "monthly budget tracker",
    "expense tracker",
    "个人预算",
    "自动记账",
  ],
  authors: [{ name: "PBudget" }],
  creator: "PBudget",
  publisher: "PBudget",
  category: "finance",
  openGraph: {
    type: "website",
    siteName: "PBudget",
    title: "PBudget — the personal budget ledger that balances itself",
    description:
      "Link your banks through Plaid and PBudget sorts, merges, and reconciles every transaction into a monthly budget you can actually trust. Fully bilingual (English & 简体中文).",
    url: "/",
    locale: "en_US",
    alternateLocale: ["zh_CN"],
  },
  twitter: {
    card: "summary_large_image",
    title: "PBudget — the budget ledger that balances itself",
    description:
      "Automated personal bookkeeping: Plaid-linked accounts, auto-categorized and reconciled into a monthly budget ledger.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
  },
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
              </>
            ) : (
              <>
                <div className="spacer" />
                <Link href="/login">{t(locale, "nav.login")}</Link>
                <Link href="/signup">{t(locale, "nav.signup")}</Link>
                <LanguageSwitcher />
              </>
            )}
          </nav>
          <main className={user ? "main main-side" : "main"}>{children}</main>
          <a
            href="https://github.com/Ppvnx/PBudget"
            target="_blank"
            rel="noopener noreferrer"
            className={user ? "gh-fab gh-fab-side" : "gh-fab"}
            aria-label="PBudget on GitHub"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span>GitHub</span>
          </a>
        </I18nProvider>
      </body>
    </html>
  );
}
