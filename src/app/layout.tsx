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
    "PBudget links your bank accounts through Plaid, then automatically categorizes, merges, and reconciles every transaction into a monthly budget ledger you can trust. Free for a month; $5/mo for 6 bank connections, $10/mo for 20. English & 简体中文.",
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
        </I18nProvider>
      </body>
    </html>
  );
}
