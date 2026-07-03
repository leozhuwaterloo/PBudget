# PRD — PlaidBudget Transaction Analyzer (sb-51)

## Problem

Synced bank transactions are trusted blindly today: nothing in PlaidBudget tells the
user "this charge is from a vendor you've never dealt with", "this e-transfer never
arrived in your other account", or "you were charged twice". Transfers between the
user's own accounts also pollute spend totals, inflating budget numbers. The user
wants every transaction to be **accounted for**: either it goes to a vendor they know,
or it is one half of a transfer between their own accounts — anything else is
suspicious and must be explicitly reviewed. Additionally, the transaction history and
category data from the old Portfolio Django app must be moved into this app so
analysis starts with full history.

## Users

Existing PlaidBudget account holders (today: a single power user, the owner) who have
linked one or more banks via Plaid and want an auditor-style review loop over their
daily transactions plus a trustworthy monthly category report. No new user types.

## Existing system

This extends the standalone PlaidBudget app (Next.js 14 App Router + React 18 +
Prisma 6, SQLite dev / Postgres prod, port 5300):

- **Sync**: `src/lib/plaid.ts` pulls 180 days of transactions per item on demand
  (`/api/plaid/item/sync`), upserting `PlaidInstitution/PlaidItem/PlaidAccount/PlaidTransaction`.
  Analysis hooks in here.
- **Categories**: per-user `TransactionCategory` rows (name + budget) are auto-seeded
  from Plaid's `personal_finance_category.primary`; `PlaidTransaction.predictedCategory`
  holds the derived name. The old Portfolio app had the same shape
  (`PlaidTransactionMeta.predicted_category` → `TransactionCategory`) — the analyzer
  keeps this Plaid-category→user-category mapping approach.
- **UI**: dashboard, `/budget` (monthly spend per category vs budget), item detail,
  shared `TransactionTable` component.
- **Auth/billing/email**: session auth with email verification, Stripe
  $1/account/month gate, nodemailer — all reused as-is, unchanged.
- **Deploy**: `Setups/config/k8s/plaidbudget/plaidbudget.yaml` exists; one pod via
  `make deploy run=plaidbudget`, Vault-injected secrets, `postgres-ai` database.
- **Old data**: the Portfolio Django app's `plaid_*`, `transactioncategory`, and
  `plaidtransactionmeta` tables live in Postgres on leodb2 (Vault:
  `secret/db/postgres/portfolio`); its Plaid access tokens are Fernet-encrypted (key
  recoverable from Portfolio git history — flagged for rotation post-migration).

## MVP scope

**FR1 — Analysis at sync.** Every transaction sync runs the analyzer over new/updated
transactions and persists findings (flags) per transaction. On the first run, all
existing history (180 days synced + migrated data) is analyzed — nothing is
grandfathered in; the initial backlog is worked down vendor-by-vendor (user-confirmed).
Rules (all four in v1):
1. **Unknown vendor** — the transaction's vendor (normalized `merchantName`, falling
   back to `name`) is not on the user's approved-vendor list. Transactions that are
   half of a linked transfer pair (FR3) are attributed to the built-in vendor
   **Self** (implicitly approved), so this rule never fires on them.
2. **Unmatched transfer** — a transfer-like transaction (Plaid category
   `TRANSFER_IN`/`TRANSFER_OUT` or e-transfer-style name) with no linked counterpart.
3. **Unusual amount** — an approved vendor charging ≥ 3× its historical median
   (needs ≥ 3 prior transactions from that vendor).
4. **Duplicate charge** — same vendor + same **signed** amount within a 3-day
   window (a charge and its refund have opposite signs and do not pair). **Both**
   transactions in the window are flagged; each is dismissed individually (FR4).

Two exemptions apply across all four rules: (a) transactions in a linked transfer
pair (FR3) are exempt from **every** rule — a linked pair is accounted for by
definition, and its equal-amount legs would otherwise false-flag as duplicates;
(b) the analyzer runs on **posted transactions only** — pending transactions are
skipped and analyzed once they post (sync stores a pending row and its posted
replacement under different Plaid IDs, so analyzing both would false-flag every
pending→posted pair as a duplicate).

**FR2 — Vendor review queue.** Every distinct vendor starts *pending*. From the
review page the user can **approve** (clears all open unknown-vendor flags for that
vendor, past and future) or **reject** (vendor stays untrusted; its existing open
flags remain until dismissed per-transaction per FR4, and each of its future
transactions keeps getting flagged). Vendor decisions persist per user.

**FR3 — Transfer auto-match + confirm.** The analyzer auto-pairs opposite-sign,
equal-amount (same currency) transactions across two different accounts of the same
user within a 4-day window into a *linked pair* (status `auto`). No transfer-like
category is required to auto-pair (user decision, review round 3); the compensating
control is that **every auto-linked pair is itself an open review item** on
`/review` until the user confirms or unlinks it. The user can
**confirm** or **unlink** a pair from the review page; unlinking reverts both sides
from vendor **Self** to their raw vendor and re-runs all four rules on them —
transfer-like sides get unmatched-transfer flags, sides from unapproved vendors get
unknown-vendor flags, and a non-transfer-like side from an approved vendor ends up
unflagged (accounted for as normal spend). An unlink is **remembered**: the
analyzer never auto-pairs those same two transactions again on later syncs
(mirroring dismissal permanence); manual re-pairing stays possible. Manual pairing is
also possible for **any two transactions of the user — flagged or unflagged**
(user decision, current review cycle round 1), subject to the same checks
(opposite-sign, equal amount, different accounts of the same user) but with **no
time-window limit**; pairing attributes both sides to vendor **Self** and clears
any open flags on them. Its purpose is catching real transfers that settle
outside the 4-day auto-window or that don't look transfer-like at all.

**FR4 — Explicit resolution.** Every flag requires a user decision — approve vendor,
confirm/unlink pair, manually pair, or **dismiss** (per-transaction). Nothing auto-resolves except
unknown-vendor flags cleared by a vendor approval and flags cleared by linking —
pairing (auto or manual) clears **all** open flags on both sides, per FR1
exemption (a) and FR3 — and an auto link is not itself a resolution: the pair stays pending until
confirmed or unlinked (FR3), so every linked transfer still gets explicit review.

**FR5 — `/review` page.** New authenticated page listing open flags grouped by rule
plus auto-linked pairs pending confirmation,
newest first, with the actions above, plus counters: suspicious today, suspicious
this month (both counted by transaction date), total open — all three counting open
flags plus pairs pending confirmation. Filterable by day or
month (also by transaction date). Zero open flags and zero unconfirmed pairs is an
explicit, visible "all clear" state.

**FR6 — Monthly report.** New report view, linked from the main nav: for a chosen
month, spend per user
category with **linked transfer pairs excluded** (a pair counts as linked from the
moment it is auto-matched, not only once confirmed — same as the FR1 exemptions),
resolved vs open flag counts (counted by transaction date, as in FR5), and
total in/out (linked pairs also excluded, so both totals reflect external cash
flow only). Categories come from the Plaid-category→user-category mapping: defaults
seeded from Plaid's `personal_finance_category` (current behavior), with a settings
UI where the user remaps any Plaid category to a category of their own naming.

**FR7 — Transfers excluded from budget.** The existing `/budget` monthly totals also
exclude linked-pair transactions, auto-linked or confirmed (they net to zero and are
not spend).

**FR8 — Portfolio data migration.** A one-off, idempotent, re-runnable script that
copies the old Django app's institutions, items, accounts, transactions, categories
(with budgets), and predicted categories into the Prisma schema, attaching everything
to the owner's account (yuner25699@gmail.com). Access tokens are decrypted (Fernet)
and re-encrypted with the app's AES-256-GCM key so banks stay connected without
re-linking. Migrated rows **keep their original Plaid identifiers** (transaction, account,
and item IDs) so the next 180-day sync upserts into the migrated rows instead of
re-inserting the overlap as new rows (which would mass-false-flag duplicates).
Reads source/destination connection info from env vars; never hardcodes
credentials. Ships with a fixture dump of the old Django schema (plus a fixture
Fernet key) so the script is verifiable without production access (criterion 11).

**FR9 — Demo seed for verification.** `npm run seed:demo` creates a verified demo
user seeded with an active subscription status (so it passes the billing gate with
no Stripe calls) with fixture accounts/transactions that exercise all four rules and a transfer
pair, plus one pending transaction, so the full review/report flow is drivable
locally without Plaid credentials. One fixture vendor is seeded **pre-approved**
(as if the user had approved it), with ≥ 3 prior charges, one charge ≥ 3× their
median, and one below-threshold charge, so the unusual-amount rule (FR1.3) is
verifiable on first analysis (criterion 6); all other vendors start pending per FR2.
The seed also provides a follow-up step (e.g. a second seed phase) that injects
additional fixture transactions — including the pending transaction's posted
replacement under a new Plaid ID — and re-runs analysis, so post-decision behavior
(criteria 2–3, 15–17) is drivable without Plaid.

**FR10 — Bilingual UI (English + Simplified Chinese).** All app pages — existing
(dashboard, `/budget`, item detail, auth, billing) and new (`/review`, monthly
report, category-mapping settings) — render in English or Simplified Chinese via a
language switcher in the app shell. The choice persists per user (stored setting;
cookie fallback pre-login); default is English. UI chrome only — user data (vendor
names, category names, transaction descriptions) is never translated.

## Non-goals

- **No emails or notifications** for findings in v1 — in-app only (user decision).
- **No scheduled/background sync** — analysis runs only on user-triggered sync.
- **No ML category prediction** — the old airflow model is not ported; mapping is
  deterministic from Plaid categories.
- **No rule-threshold configuration UI** — 3× median, 3-day duplicate window, 4-day
  transfer window are code constants in v1.
- **No billing changes** — the analyzer is part of the existing $1/account/month
  subscription; no new Stripe products or gates.
- **No changes to bank linking, auth, or email verification.**
- **No per-transaction category override** — category mapping is at the
  Plaid-category level in v1.
- **No languages beyond English and Simplified Chinese**, and **no translated
  transactional emails** — verification/billing emails stay English-only in v1
  (user decision).

## Success criteria

Verifiable end-to-end against the seeded demo user (FR9) unless noted:

1. After seeding and running analysis, every **posted** transaction from a
   never-approved vendor — excluding linked-pair transactions, whose vendor is
   **Self** — has an open unknown-vendor flag visible on `/review` (the pending
   fixture transaction is exempt per FR1 exemption b, verified by criterion 15)
   (FR1.1, FR5).
2. Approving a vendor removes all its open unknown-vendor flags, and a subsequent
   sync/analysis of a new fixture transaction from that vendor produces no new
   unknown-vendor flag (FR2).
3. Rejecting a vendor leaves its transactions flagged, and new transactions from it
   are flagged again (FR2).
4. Two fixture transactions of +$X and −$X in different accounts 2 days apart are
   auto-linked; neither carries an unmatched-transfer or unknown-vendor flag (their
   vendor is **Self**); the pair is listed on `/review` pending confirmation; and
   unlinking it re-runs the rules and re-flags both (the fixture pair is
   e-transfer-named, so both get unmatched-transfer flags) (FR3).
5. A fixture transfer-out with no counterpart within 4 days has an open
   unmatched-transfer flag (FR1.2).
6. After the first analysis, the seeded pre-approved vendor's fixture charge ≥ 3×
   its median (with ≥ 3 priors) has an open unusual-amount flag; its
   below-threshold fixture charge does not (FR1.3, FR9).
7. Two same-vendor, same-amount fixture charges 1 day apart **each** carry an open
   duplicate flag (FR1.4).
8. Every flag and every pair pending confirmation can be driven to resolved through
   UI actions only, and `/review` then shows the all-clear state with zero open
   counters (FR4, FR5).
9. The monthly report for the fixture month shows per-category totals matching
   hand-computed fixture sums with the linked pair excluded; remapping a Plaid
   category to a renamed user category moves its spend accordingly (FR6).
10. `/budget` monthly totals for the fixture month exclude the linked pair's amounts
    (FR7).
11. The migration script, run twice against a fixture copy of the old Django schema,
    produces identical row counts (idempotent), attaches all rows to the owner user,
    migrated rows retain the fixture dump's original Plaid transaction/account/item
    IDs (so later real syncs upsert instead of duplicating),
    and a migrated access token decrypts with the new AES key to the original
    plaintext; running the analyzer afterwards flags the migrated fixture
    transactions per FR1 — nothing grandfathered (FR1, FR8).
12. `GET /api/health` returns 200 with the app running.
13. Switching the language to 简体中文 renders `/review` and the monthly report with
    Chinese UI strings (no untranslated chrome on those pages), the choice survives
    a page reload, and switching back restores English (FR10).
14. Two fixture unmatched transfers — opposite-sign, equal amount, different
    accounts, 6 days apart (outside the auto-window) — can be manually paired from
    `/review`; both unmatched-transfer flags clear and their vendor becomes **Self**.
    The manual-pairing UI also offers **unflagged** transactions as counterpart
    candidates — eligibility is any transaction meeting the FR3 checks, not only
    flagged ones (FR3).
15. The fixture pending transaction carries no flags after analysis; after seed
    phase 2 delivers its posted replacement and re-runs analysis, the posted row is
    flagged per FR1 and the pending→posted pair is **not** flagged as a duplicate
    (FR1 exemption b, FR9).
16. A flag dismissed in the UI stays resolved after seed phase 2 re-runs analysis —
    the same transaction is not re-flagged by the same rule (FR4).
17. Unlinking the auto-linked fixture pair and re-running analysis (seed phase 2)
    does not re-create the pair — both sides keep their re-run flags per criterion 4
    until resolved by hand (FR3).

## Deployment

- **Local run (what verifier agents execute):**
  ```bash
  nvm use 22
  npm install
  cp .env.example .env   # DATABASE_URL=file:./dev.db + APP_ENCRYPTION_KEY suffice; Plaid/Stripe not needed for seeded verification
  # generate the key: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  npm run db:push
  npm run seed:demo      # prints demo login credentials
  npm run dev            # http://localhost:5300
  ```
  Health check: `curl -fsS http://localhost:5300/api/health` → HTTP 200. Then log in
  as the demo user and drive `/review` and the monthly report per the success
  criteria.
- **Production:** existing Setups step — from `~/Setups`, `make deploy run=plaidbudget`
  (single pod on leozhu/leoec2/leodb2, image imported locally, Vault-injected
  secrets, `postgres-ai` database). Health check: same `/api/health` via the
  cluster service.
- **Data migration (one-off, run by the owner):** `npm run migrate:portfolio` with
  `OLD_DATABASE_URL` (Postgres on leodb2, creds from Vault
  `secret/db/postgres/portfolio`) and `OLD_FERNET_KEY` in env; idempotent and
  re-runnable. Verified in CI/local against a fixture dump (criterion 11), not
  against production.

## Open assumptions

- Vendor identity is the normalized (case/whitespace-folded) `merchantName ?? name`
  string; no fuzzy matching in v1. Linked-pair transactions are attributed to the
  built-in, implicitly-approved vendor **Self** (user decision, review round 1).
- Transfer-like detection = Plaid `personal_finance_category` primary
  `TRANSFER_IN`/`TRANSFER_OUT`, or name matching e-transfer patterns
  (`/e-?transfer|etfr|send money/i`). This gates the unmatched-transfer rule only —
  auto-matching pairs any opposite-sign, equal-amount, cross-account transactions
  within the 4-day window, no transfer-like category required (user decision,
  review round 3); the safeguard is that every auto pair must be explicitly
  confirmed or unlinked (FR3/FR4). A transaction belongs to at most one linked
  pair; when several candidates match, the nearest-by-date one is chosen.
- Thresholds: 3× median for unusual amount (min 3 priors), 3-day duplicate window,
  4-day transfer-match window, exact amount match for pairs.
- Dismissing a flag is per-transaction and permanent; the same transaction is not
  re-flagged by the same rule on later syncs.
- The old Fernet key is taken from Vault/env for the migration, then rotated along
  with the other Portfolio secrets already flagged in the migration follow-ups.
- Locale is a per-user setting (cookie fallback pre-login), English default,
  Simplified Chinese as the only other locale; emails and user data untranslated
  (user decision, review round 1).
- Review round 2 defaults, all **confirmed by the user in review round 3**:
  (a) linked-pair transactions are exempt from
  all four rules, not just unknown-vendor; (b) the analyzer runs on posted
  transactions only, skipping pending ones until they post; (c) manual pairing
  requires opposite-sign + equal amount + different accounts but has no time
  window; (d) the monthly report's total in/out excludes linked pairs.
- **Confirmed by the user in this review cycle (round 1):** unlinking a pair re-runs
  all four rules on both sides rather than unconditionally flagging them as unmatched
  transfers; the duplicate rule flags **both** transactions in the window, each
  dismissed individually.
- **This cycle round 2 defaults, all confirmed by the user in round 3:** (a) an
  unlink is permanent — the analyzer never auto-pairs the same two transactions
  again unless the user manually re-pairs them (FR3, criterion 17); (b) linked-pair
  exclusions in FR6/FR7 apply from auto-match, while the pair is still pending
  confirmation — consistent with the FR1 exemptions; (c) criteria 15–16 kept so the
  posted-only exemption and dismissal permanence are actually verified, with the
  needed pending-transaction fixture in FR9.
- **Confirmed by the user in the current review cycle (round 1):** (a) duplicate
  matching uses the **signed** amount — a charge and its refund do not pair
  (FR1.4); (b) manual pairing is open to **any** two transactions, flagged or
  unflagged, subject to the FR3 checks (FR3, criterion 14); (c) the migration
  preserves original Plaid transaction/account/item IDs so post-migration syncs
  upsert into migrated rows instead of duplicating the 180-day overlap (FR8,
  criterion 11).
- **Confirmed by the user in the current review cycle (round 2):** the demo seed
  pre-approves one fixture vendor (≥ 3 priors, one ≥ 3× median charge, one below
  threshold) so the unusual-amount rule is verifiable on first analysis — without
  this, no vendor is approved at seed-time analysis and criterion 6 could never
  pass (FR9, criterion 6).
