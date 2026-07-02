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
   back to `name`) is not on the user's approved-vendor list.
2. **Unmatched transfer** — a transfer-like transaction (Plaid category
   `TRANSFER_IN`/`TRANSFER_OUT` or e-transfer-style name) with no linked counterpart.
3. **Unusual amount** — an approved vendor charging ≥ 3× its historical median
   (needs ≥ 3 prior transactions from that vendor).
4. **Duplicate charge** — same vendor + same amount within a 3-day window.

**FR2 — Vendor review queue.** Every distinct vendor starts *pending*. From the
review page the user can **approve** (clears all open unknown-vendor flags for that
vendor, past and future) or **reject** (vendor stays untrusted; each of its future
transactions keeps getting flagged). Vendor decisions persist per user.

**FR3 — Transfer auto-match + confirm.** The analyzer auto-pairs opposite-sign,
equal-amount (same currency) transactions across two different accounts of the same
user within a 4-day window into a *linked pair* (status `auto`). The user can
**confirm** or **unlink** a pair from the review page; unlinking re-flags both sides
as unmatched transfers. Manual pairing of two flagged transfers is also possible.

**FR4 — Explicit resolution.** Every flag requires a user decision — approve vendor,
confirm/unlink pair, or **dismiss** (per-transaction). Nothing auto-resolves except
unknown-vendor flags cleared by a vendor approval and transfer flags cleared by a
link.

**FR5 — `/review` page.** New authenticated page listing open flags grouped by rule,
newest first, with the actions above, plus counters: suspicious today, suspicious
this month, total open. Filterable by day or month. Zero open flags is an explicit,
visible "all clear" state.

**FR6 — Monthly report.** New report view: for a chosen month, spend per user
category with **linked transfer pairs excluded**, resolved vs open flag counts, and
total in/out. Categories come from the Plaid-category→user-category mapping: defaults
seeded from Plaid's `personal_finance_category` (current behavior), with a settings
UI where the user remaps any Plaid category to a category of their own naming.

**FR7 — Transfers excluded from budget.** The existing `/budget` monthly totals also
exclude linked-pair transactions (they net to zero and are not spend).

**FR8 — Portfolio data migration.** A one-off, idempotent, re-runnable script that
copies the old Django app's institutions, items, accounts, transactions, categories
(with budgets), and predicted categories into the Prisma schema, attaching everything
to the owner's account (yuner25699@gmail.com). Access tokens are decrypted (Fernet)
and re-encrypted with the app's AES-256-GCM key so banks stay connected without
re-linking. Reads source/destination connection info from env vars; never hardcodes
credentials.

**FR9 — Demo seed for verification.** `npm run seed:demo` creates a verified demo
user with fixture accounts/transactions that exercise all four rules and a transfer
pair, so the full review/report flow is drivable locally without Plaid credentials.

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

## Success criteria

Verifiable end-to-end against the seeded demo user (FR9) unless noted:

1. After seeding and running analysis, every transaction from a never-approved vendor
   has an open unknown-vendor flag visible on `/review` (FR1.1, FR5).
2. Approving a vendor removes all its open unknown-vendor flags, and a subsequent
   sync/analysis of a new fixture transaction from that vendor produces no new
   unknown-vendor flag (FR2).
3. Rejecting a vendor leaves its transactions flagged, and new transactions from it
   are flagged again (FR2).
4. Two fixture transactions of +$X and −$X in different accounts 2 days apart are
   auto-linked; neither carries an unmatched-transfer flag; unlinking them re-flags
   both (FR3).
5. A fixture transfer-out with no counterpart within 4 days has an open
   unmatched-transfer flag (FR1.2).
6. A fixture charge ≥ 3× an approved vendor's median (with ≥ 3 priors) is flagged
   unusual-amount; one below the threshold is not (FR1.3).
7. Two same-vendor, same-amount fixture charges 1 day apart are flagged duplicate
   (FR1.4).
8. Every flag can be driven to resolved through UI actions only, and `/review` then
   shows the all-clear state with zero open counters (FR4, FR5).
9. The monthly report for the fixture month shows per-category totals matching
   hand-computed fixture sums with the linked pair excluded; remapping a Plaid
   category to a renamed user category moves its spend accordingly (FR6).
10. `/budget` monthly totals for the fixture month exclude the linked pair's amounts
    (FR7).
11. The migration script, run twice against a fixture copy of the old Django schema,
    produces identical row counts (idempotent), attaches all rows to the owner user,
    and a migrated access token decrypts with the new AES key to the original
    plaintext (FR8).
12. `GET /api/health` returns 200 with the app running.

## Deployment

- **Local run (what verifier agents execute):**
  ```bash
  nvm use 22
  npm install
  cp .env.example .env   # DATABASE_URL=file:./dev.db + generated APP_ENCRYPTION_KEY suffice; Plaid/Stripe not needed for seeded verification
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
  string; no fuzzy matching in v1.
- Transfer-like detection = Plaid `personal_finance_category` primary
  `TRANSFER_IN`/`TRANSFER_OUT`, or name matching e-transfer patterns
  (`/e-?transfer|etfr|send money/i`).
- Thresholds: 3× median for unusual amount (min 3 priors), 3-day duplicate window,
  4-day transfer-match window, exact amount match for pairs.
- Dismissing a flag is per-transaction and permanent; the same transaction is not
  re-flagged by the same rule on later syncs.
- The old Fernet key is taken from Vault/env for the migration, then rotated along
  with the other Portfolio secrets already flagged in the migration follow-ups.
