// English UI-chrome dictionary (flat keys). NEVER put user data here (vendor /
// category / transaction names) or the product name "PBudget". zh.ts is typed
// against this object, so every key here must have a Chinese counterpart there.
const en = {
  // nav
  "nav.dashboard": "Dashboard",
  "nav.review": "Review",
  "nav.report": "Report",
  "nav.budget": "Budget",
  "nav.categories": "Categories",
  "nav.billing": "Billing",
  "nav.login": "Log in",
  "nav.signup": "Sign up",
  "nav.logout": "Log out",

  // common
  "common.loading": "Loading…",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.reset": "Reset",
  "common.subscribe": "Subscribe",
  "common.requestFailed": "Request failed",
  "common.genericError": "Something went wrong",

  // auth
  "auth.signupTitle": "Create your account",
  "auth.loginTitle": "Welcome back",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.showPassword": "Show password",
  "auth.hidePassword": "Hide password",
  "auth.haveAccount": "Already have an account?",
  "auth.newHere": "New here?",
  "auth.createAccount": "Create an account",
  "auth.forgotPassword": "Forgot your password?",

  // forgot / reset password
  "forgot.title": "Reset your password",
  "forgot.body": "Enter your email and we'll send you a link to set a new password.",
  "forgot.submit": "Send reset link",
  "forgot.sentTitle": "Check your inbox",
  "forgot.sentBody":
    "If that email is registered, a reset link is on its way. The link expires in 1 hour. (In local dev, it's printed to the server console.)",
  "reset.title": "Set a new password",
  "reset.newPassword": "New password",
  "reset.submit": "Update password",
  "reset.doneTitle": "Password updated ✓",
  "reset.doneBody": "You've been logged out everywhere. Log in with your new password.",
  "reset.invalidTitle": "Link invalid or expired",
  "reset.invalidBody": "Password reset links expire after 1 hour and can only be used once.",
  "reset.requestNew": "Request a new reset link",

  // verify
  "verify.verifiedTitle": "Email verified ✓",
  "verify.verifiedBody": "Your account is now active.",
  "verify.goDashboard": "Go to dashboard",
  "verify.invalidTitle": "Link invalid or expired",
  "verify.invalidBody": "Request a fresh verification link below.",
  "verify.alreadyTitle": "You're verified ✓",
  "verify.title": "Verify your email",
  "verify.body":
    "We sent a verification link to {email}. Click it to activate your account. (In local dev, the link is printed to the server console.)",
  "verify.yourInbox": "your inbox",

  // resend
  "resend.button": "Resend verification email",
  "resend.sent": "Verification email sent.",
  "resend.failed": "Could not send — are you logged in?",

  // dashboard
  "dashboard.title": "Your banks",
  "dashboard.bannerTitle": "Start your subscription",
  "dashboard.bannerBody":
    "— $1 per managed account / month. You need an active subscription to connect and sync accounts.",
  "dashboard.noBanks": "No banks connected yet.",
  "dashboard.colBank": "Bank",
  "dashboard.colAccounts": "Accounts",
  "dashboard.colLastUpdated": "Last updated",
  "dashboard.colActions": "Actions",
  "dashboard.sync": "Sync",
  "dashboard.reauth": "Re-auth",
  "dashboard.connect": "Connect a bank account",
  "dashboard.viewBudget": "View Budget Planning",

  // billing
  "billing.title": "Billing",
  "billing.subtitle": "$1 per managed account, per month.",
  "billing.status": "Status",
  "billing.statusNone": "none",
  "billing.managedAccounts": "Managed accounts",
  "billing.estimatedMonthly": "Estimated monthly",
  "billing.manage": "Manage billing",

  // item detail
  "item.updated": "Updated",
  "item.colAccount": "Account",
  "item.colCurrent": "Current",
  "item.colTransactions": "Transactions",
  "item.colLastUpdated": "Last updated",

  // transaction table fields + group badge
  "field.name": "Transaction Name",
  "field.merchant": "Merchant Name",
  "field.category": "Category",
  "field.amount": "Amount",
  "field.date": "Date",
  "field.lastUpdated": "Last Updated",
  "field.bank": "Bank",
  "field.account": "Account",
  "txn.groupBadge": "group · {n}",
  "txn.groupTooltip": "Merged group of {n} transactions",

  // budget
  "budget.title": "Budget Planning",
  "budget.empty": "No transactions yet — connect and sync a bank on the dashboard.",
  "budget.colMonth": "Month",
  "budget.colTotal": "Total (excl. income & transfers)",
  "budget.colCategory": "Category",
  "budget.colSpent": "Spent",
  "budget.colBudget": "Budget",
  "budget.colUsage": "Usage",
  "budget.colTransactions": "Transactions",
  "budget.na": "N/A",

  // report
  "report.title": "Monthly Report",
  "report.month": "Month",
  "report.noActivity": "No activity in this month.",
  "report.cashFlow": "Cash flow",
  "report.moneyIn": "Money in",
  "report.moneyOut": "Money out",
  "report.net": "Net",
  "report.flagsThisMonth": "Flags this month",
  "report.open": "Open",
  "report.resolved": "Resolved",
  "report.category": "Category",
  "report.spend": "Spend",
  "report.noSpend": "No categorized spend this month.",

  // review
  "review.title": "Review",
  "review.suspiciousToday": "Suspicious today",
  "review.thisMonth": "This month",
  "review.totalOpen": "Total open",
  "review.filter": "Filter",
  "review.allDates": "All dates",
  "review.byDay": "By day",
  "review.byMonth": "By month",
  "review.mergeTransactions": "Merge transactions…",
  "review.allClear": "All clear",
  "review.allClearBody": "No open flags and no groups awaiting confirmation.",
  "review.noMatch": "No flags match this filter.",
  "review.pendingGroups": "Auto-matched groups — pending confirmation ({n})",
  "review.colGroup": "Group",
  "review.colNet": "Net",
  "review.colDate": "Date",
  "review.colActions": "Actions",
  "review.colItem": "Item",
  "review.colAmount": "Amount",
  "review.confirm": "Confirm",
  "review.dissolve": "Dissolve",
  "review.mergedGroup": "Merged group",
  "review.approveVendor": "Approve vendor",
  "review.reject": "Reject",
  "review.merge": "Merge…",
  "review.dismiss": "Dismiss",

  // review — rule labels
  "rule.unknown_vendor": "Unknown vendor",
  "rule.unmatched_transfer": "Unmatched transfer",
  "rule.unusual_amount": "Unusual amount",
  "rule.duplicate_charge": "Duplicate charge",

  // review — vendor status (rendered uppercased via CSS; Chinese unaffected)
  "status.approved": "approved",
  "status.rejected": "rejected",
  "status.pending": "pending",

  // merge picker
  "merge.title": "Merge transactions",
  "merge.help": "Pick two or more posted transactions to merge into one group.",
  "merge.optionalTitle": "Optional group title",
  "merge.loading": "Loading candidates…",
  "merge.none": "No transactions available to merge.",
  "merge.mergeSelected": "Merge {n} selected",
  "merge.loadFailed": "Failed to load candidates",
  "merge.failed": "Merge failed",

  // category mapping
  "catmap.title": "Category Mapping",
  "catmap.help": "Rename any Plaid category to your own. Changes apply everywhere, including past months.",
  "catmap.loadFailed": "Failed to load categories.",
  "catmap.saveFailed": "Save failed.",
  "catmap.colPlaid": "Plaid category",
  "catmap.colYours": "Your category",
  "catmap.overridden": "overridden",

  // landing (logged-out home)
  "landing.eyebrow": "Automated personal bookkeeping",
  "landing.h1": "The ledger that <em>balances itself.</em>",
  "landing.sub":
    "PBudget connects to your banks through Plaid, then sorts, merges, and reconciles every transaction into a monthly ledger you can actually budget against.",
  "landing.ctaPrimary": "Create your ledger",
  "landing.ctaSecondary": "Sign in",
  "landing.trust": "Bank connections secured by Plaid · English & 简体中文",

  "landing.stmt.title": "This month",
  "landing.stmt.caption": "Statement",
  "landing.stmt.reconciled": "Reconciled",

  "landing.stepsEyebrow": "How it works",
  "landing.stepsTitle": "Three steps from raw feed to reconciled ledger.",
  "landing.step1.title": "Connect",
  "landing.step1.body":
    "Link your accounts through Plaid. Transactions flow in on their own — nothing to import by hand.",
  "landing.step2.title": "Reconcile",
  "landing.step2.body":
    "PBudget categorizes each charge, merges a refund or split into a single line, and flags anything that looks off for your review.",
  "landing.step3.title": "Budget",
  "landing.step3.body":
    "Track spend by category against your budget, month over month — with income and transfers kept out of the math.",

  "landing.featuresEyebrow": "What's inside",
  "landing.featuresTitle": "Bookkeeping that holds up to scrutiny.",
  "landing.feat.cat.title": "Automatic categorization",
  "landing.feat.cat.body":
    "Every transaction sorted the moment it arrives. Rename a category once and it applies everywhere, including past months.",
  "landing.feat.merge.title": "Merge groups",
  "landing.feat.merge.body":
    "A purchase and its refund, or a charge split across cards, collapse into one reconciled line — so your totals tell the truth.",
  "landing.feat.audit.title": "An auditor for your books",
  "landing.feat.audit.body":
    "Unknown vendors, duplicate charges, and unusual amounts get flagged. You approve or reject each one — the final say is yours.",
  "landing.feat.report.title": "Monthly report",
  "landing.feat.report.body":
    "Money in, money out, net. A clean cash-flow summary for every month, with any open flags surfaced up top.",

  "landing.precisionEyebrow": "Precision",
  "landing.precisionTitle": "Every figure ties out.",
  "landing.precisionBody":
    "Amounts align to the cent in tabular figures, the way a real ledger reads. Income and transfers never inflate your spending — what you see is what you actually spent.",
  "landing.bilingual": "Fully bilingual — 完整的简体中文界面。",

  "landing.finalTitle": "Open your ledger.",
  "landing.finalBody": "Free to explore. $1 per managed account, per month once you connect a bank.",
  "landing.finalCta": "Get started",
  "landing.footer": "PBudget — personal budgeting, backed by Plaid.",
};

export type Messages = typeof en;
export default en;
