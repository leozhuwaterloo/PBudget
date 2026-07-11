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
