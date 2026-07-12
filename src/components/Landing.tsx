import Link from "next/link";
import { t, type Locale } from "@/lib/i18n";
import styles from "./Landing.module.css";

// The self-balancing ledger. Logged-out home page; the hero statement animates
// raw bank descriptors into a reconciled, categorized ledger — the product in
// one glance. Copy is i18n'd (landing.* keys); the demo statement's payees and
// amounts are illustrative Plaid-shaped data, kept inline like the real app.

export default function Landing({ locale }: { locale: Locale }) {
  const tr = (k: string, p?: Record<string, string | number>) => t(locale, k, p);

  return (
    <div className={styles.page}>
      <StructuredData />

      {/* Hero ---------------------------------------------------------- */}
      <section className={styles.hero}>
        <div className={styles.heroText}>
          <p className={styles.eyebrow}>{tr("landing.eyebrow")}</p>
          <h1
            className={styles.display}
            dangerouslySetInnerHTML={{ __html: tr("landing.h1") }}
          />
          <p className={styles.lede}>{tr("landing.sub")}</p>
          <div className={styles.actions}>
            <Link href="/signup" className={`btn btn-primary ${styles.cta}`}>
              {tr("landing.ctaPrimary")}
            </Link>
            <Link href="/login" className={`btn ${styles.cta}`}>
              {tr("landing.ctaSecondary")}
            </Link>
          </div>
          <p className={styles.trust}>{tr("landing.trust")}</p>
          <p className={styles.trust} style={{ marginTop: 4 }}>
            <Link href="/terms">{tr("auth.termsLink")}</Link> · {tr("terms.p3")}
          </p>
        </div>

        <Statement tr={tr} />
      </section>

      {/* How it works — a real ordered sequence ------------------------ */}
      <section className={styles.section}>
        <p className={styles.sectionEyebrow}>{tr("landing.stepsEyebrow")}</p>
        <h2 className={styles.sectionTitle}>{tr("landing.stepsTitle")}</h2>
        <div className={styles.steps}>
          {[1, 2, 3].map((n) => (
            <div key={n} className={styles.step}>
              <div className={styles.stepNum}>{String(n).padStart(2, "0")}</div>
              <h3 className={styles.stepTitle}>{tr(`landing.step${n}.title`)}</h3>
              <p className={styles.stepBody}>{tr(`landing.step${n}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features ------------------------------------------------------- */}
      <section className={styles.section}>
        <p className={styles.sectionEyebrow}>{tr("landing.featuresEyebrow")}</p>
        <h2 className={styles.sectionTitle}>{tr("landing.featuresTitle")}</h2>
        <div className={styles.features}>
          {["cat", "merge", "audit", "report"].map((f) => (
            <div key={f} className={styles.feature}>
              <h3 className={styles.featTitle}>{tr(`landing.feat.${f}.title`)}</h3>
              <p className={styles.featBody}>{tr(`landing.feat.${f}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Precision band ------------------------------------------------- */}
      <section className={styles.precision}>
        <div>
          <p className={styles.sectionEyebrow}>{tr("landing.precisionEyebrow")}</p>
          <h2 className={styles.precisionTitle}>{tr("landing.precisionTitle")}</h2>
          <p className={styles.precisionBody}>{tr("landing.precisionBody")}</p>
          <p className={styles.precisionBilingual}>{tr("landing.bilingual")}</p>
        </div>
        <div className={styles.proof}>
          <div className={styles.proofRow}>
            <span>{tr("report.moneyIn")}</span>
            <b>+3,200.00</b>
          </div>
          <div className={styles.proofRow}>
            <span>{tr("report.moneyOut")}</span>
            <b>−1,847.35</b>
          </div>
          <div className={styles.proofRow}>
            <span>{tr("report.net")}</span>
            <b className={styles.proofNet}>+1,352.65</b>
          </div>
        </div>
      </section>

      {/* Final CTA ------------------------------------------------------ */}
      <section className={styles.final}>
        <h2 className={styles.finalTitle}>{tr("landing.finalTitle")}</h2>
        <p className={styles.finalBody}>{tr("landing.finalBody")}</p>
        <Link
          href="/signup"
          className={`btn btn-primary ${styles.cta}`}
          style={{ padding: "13px 30px", fontSize: 16 }}
        >
          {tr("landing.finalCta")}
        </Link>
      </section>

      <footer className={styles.foot}>
        <span>{tr("landing.footer")}</span>
        <span>
          <Link href="/login">{tr("nav.login")}</Link> · <Link href="/signup">{tr("nav.signup")}</Link> · <Link href="/terms">{tr("auth.termsLink")}</Link> · <Link href="/privacy">{tr("privacy.title")}</Link>
        </span>
      </footer>
    </div>
  );
}

// Machine-readable facts for search + generative engines (GEO). SoftwareApplication
// carries the product + pricing; FAQPage answers the questions LLMs get asked about
// a budgeting app, so they can cite PBudget accurately. Pricing mirrors TIER_LIMITS /
// TIER_PRICES in lib/stripe.ts (CAD) — keep in sync if tiers change.
function StructuredData() {
  const site = process.env.APP_URL || "https://pbudget.ppvnx.com";
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${site}/#org`,
        name: "PBudget",
        url: site,
        logo: `${site}/icon.png`,
      },
      {
        "@type": "SoftwareApplication",
        name: "PBudget",
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web, Android",
        url: site,
        description:
          "PBudget connects to your bank accounts through Plaid, then automatically categorizes, merges, and reconciles every transaction into a monthly budget ledger. Fully bilingual in English and Simplified Chinese.",
        inLanguage: ["en", "zh"],
        publisher: { "@id": `${site}/#org` },
        offers: [
          { "@type": "Offer", name: "Free trial", price: "0", priceCurrency: "CAD", description: "1 bank connection, free for the first month" },
          { "@type": "Offer", name: "Pro", price: "3", priceCurrency: "CAD", description: "Up to 6 bank connections, billed monthly" },
          { "@type": "Offer", name: "Max", price: "10", priceCurrency: "CAD", description: "Up to 20 bank connections, billed monthly" },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "What is PBudget?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "PBudget is a personal budgeting app that links to your bank accounts through Plaid and automatically categorizes, merges, and reconciles every transaction into a monthly ledger you can budget against — no manual import needed.",
            },
          },
          {
            "@type": "Question",
            name: "How much does PBudget cost?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "PBudget is free for the first month with one bank connection. After that it is $3 per month for up to 6 bank connections, or $10 per month for up to 20 (CAD).",
            },
          },
          {
            "@type": "Question",
            name: "Is PBudget secure?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Bank connections are handled by Plaid, so PBudget never sees your banking credentials. Your account and transaction data is encrypted at rest.",
            },
          },
          {
            "@type": "Question",
            name: "How does PBudget categorize transactions?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Each transaction is matched against your vendor rules. Write a rule once and every matching charge sorts itself across past and future months; anything unmatched, duplicated, or unusual lands in a review queue.",
            },
          },
          {
            "@type": "Question",
            name: "Does PBudget support languages other than English?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Yes. PBudget has a fully bilingual interface in English and Simplified Chinese (简体中文).",
            },
          },
        ],
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}

// Illustrative statement: raw descriptor → resolved, categorized line. Shows
// categorization, a merged refund, a flagged vendor, and posted income.
function Statement({ tr }: { tr: (k: string, p?: Record<string, string | number>) => string }) {
  return (
    <div className={styles.statement} aria-hidden="true">
      <div className={styles.stmtHead}>
        <span className={styles.stmtTitle}>{tr("landing.stmt.title")}</span>
        <span className={styles.stmtCaption}>PBudget · {tr("landing.stmt.caption")}</span>
      </div>
      <div className={styles.stmtRows}>
        <div className={styles.stmtRow} style={{ "--i": 0 } as React.CSSProperties}>
          <span className={styles.raw}>SQ *BLUE BOTTLE 0393</span>
          <span>
            <span className={styles.payee}>Blue Bottle Coffee</span>
            <span className={styles.tag}>Coffee</span>
          </span>
          <span className={styles.amt}>6.75</span>
        </div>

        <div className={styles.stmtRow} style={{ "--i": 1 } as React.CSSProperties}>
          <span className={styles.raw}>AMZN Mktp US*RT4G8L2</span>
          <span>
            <span className={styles.payee}>Amazon</span>
            <span className={styles.tag}>Shopping</span>
          </span>
          <span className={styles.amt}>42.10</span>
        </div>

        <div className={`${styles.stmtRow} ${styles.merged}`} style={{ "--i": 2 } as React.CSSProperties}>
          <span className={styles.raw}>UBER *TRIP&nbsp;&nbsp;+&nbsp;&nbsp;UBER *TRIP refund</span>
          <span>
            <span className={styles.payee}>Uber</span>
            <span className={styles.tag}>{tr("review.mergedGroup")}</span>
          </span>
          <span className={styles.amt}>18.40</span>
          <span className={styles.mergeNote}>24.90 − 6.50 · {tr("txn.groupBadge", { n: 2 })}</span>
        </div>

        <div className={`${styles.stmtRow} ${styles.flagged}`} style={{ "--i": 3 } as React.CSSProperties}>
          <span className={styles.raw}>SP GENERIC*STOREXYZ</span>
          <span>
            <span className={styles.payee}>STOREXYZ</span>
            <span className={styles.flagBadge}>{tr("rule.unmatched_vendor")}</span>
          </span>
          <span className={styles.amt}>89.00</span>
        </div>

        <div className={styles.stmtRow} style={{ "--i": 4 } as React.CSSProperties}>
          <span className={styles.raw}>PAYROLL ACME CORP</span>
          <span>
            <span className={styles.payee}>Acme Corp</span>
            <span className={styles.tag}>Income</span>
          </span>
          <span className={`${styles.amt} ${styles.amtIn}`}>+3,200.00</span>
        </div>
      </div>
      <div className={styles.stmtTotal}>
        <span className={styles.totalLabel}>{tr("report.net")}</span>
        <span className={styles.reconciled}>+1,352.65 · {tr("landing.stmt.reconciled")} ✓</span>
      </div>
    </div>
  );
}
