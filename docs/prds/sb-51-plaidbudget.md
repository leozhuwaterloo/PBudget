# PRD — PBudget Transaction Analyzer (sb-51)

## Problem

Synced bank transactions are trusted blindly today: nothing in the app tells the
user "this charge is from a vendor you've never dealt with", "this e-transfer never
arrived in your other account", or "you were charged twice". Transfers between the
user's own accounts also pollute spend totals, and partial refunds distort them the
other way (a $500 charge with a $100 refund is $400 of real spend, not two rows).
The user wants every transaction to be **accounted for**: either it goes to a vendor
they know, or it nets out against their own money movements — anything else is
suspicious and must be explicitly reviewed. Additionally, the transaction history and
category data from the old Portfolio Django app must be moved into this app so
analysis starts with full history. The app itself is renamed **PBudget** (from
PlaidBudget) and served at **https://pbudget.ppvnx.com** (FR11).

## Users

Existing account holders (today: a single power user, the owner) who have
linked one or more banks via Plaid and want an auditor-style review loop over their
daily transactions plus a trustworthy monthly category report. No new user types.

## Existing system

This extends the standalone PlaidBudget app (Next.js 14 App Router + React 18 +
Prisma 6, SQLite dev / Postgres prod, port 5300), renamed to PBudget by FR11:

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
  Public hostname is currently `plaid.ppvnx.com`, served by the nginx-internal
  vhost `plaidbudget.conf` (`server_name plaid.{{ domain }}` → the app service on
  5300); the manifest bakes `APP_URL=https://plaid.ppvnx.com` and
  `EMAIL_FROM=PlaidBudget <…>`. All of these are renamed by FR11.
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
1. **Unknown vendor** — the vendor (normalized `merchantName`, falling back to
   `name`) is not on the user's approved-vendor list. Applies to individual
   transactions and to net-≠0 merge groups (under the group's vendor, FR3); never
   fires on merge-group legs or net-0 groups (exemptions a–b below).
2. **Unmatched transfer** — a transfer-like transaction (Plaid category
   `TRANSFER_IN`/`TRANSFER_OUT` or e-transfer-style name) that is not part of any
   merge group.
3. **Unusual amount** — an approved vendor **charging** ≥ 3× its historical median.
   Charges only (user decision, cycle 3): the rule fires only on money-out
   transactions, and the median is computed over that vendor's prior posted charges
   (≥ 3 required); refunds/credits neither trigger the rule nor enter the median.
   Net-≠0 merge groups are evaluated at their net amount.
4. **Duplicate charge** — same vendor + same **signed** amount within a 3-day
   window (a charge and its refund have opposite signs and do not pair). **Both**
   transactions in the window are flagged; each is dismissed individually (FR4).

Merge-group handling across all four rules (user decision, cycle 3):
(a) **legs** of a merge group are exempt from every rule — the group represents
them, and merging clears their open flags (FR3); (b) a group netting **exactly 0**
is a self-transfer, accounted for by definition — exempt from every rule;
(c) a group netting **≠ 0** is analyzed as a **single transaction** — net amount,
group vendor — under rules 1, 3, and 4 (rule 2 never fires on a group: the user
composed it deliberately); (d) the analyzer runs on **posted transactions only** —
pending transactions are skipped and analyzed once they post (sync stores a pending
row and its posted replacement under different Plaid IDs, so analyzing both would
false-flag every pending→posted pair as a duplicate).

**FR2 — Vendor review queue.** Every distinct vendor starts *pending*. From the
review page the user can **approve** (clears all open unknown-vendor flags for that
vendor, past and future) or **reject** (vendor stays untrusted; its existing open
flags remain until dismissed per-transaction per FR4, and each of its future
transactions keeps getting flagged). Vendor decisions persist per user.

**FR3 — Merge groups: transfer auto-match + manual N-way merge.** The user can
merge **any N ≥ 2 of their transactions — flagged or unflagged, any accounts, any
signs or amounts, no time window** (user decision, cycle 3) — into a *merge group*
that displays everywhere (transaction lists, `/review`, reports) as **one
transaction** whose amount is the signed sum of its legs. All legs must share a
currency (a mixed-currency sum is undefined). The group's title is user-selectable,
defaulting to the title of the **largest-outflow leg**; the group's vendor,
category, and date come from that same leg (fallback: largest absolute amount if
the group has no outflow leg; ties broken by earliest date). Examples (the
user's): +1000/−1000 across two accounts → "e-transfer to self", amount 0;
Walmart −500 and +100 → "Walmart", −400.

The analyzer still **auto-matches**: two opposite-sign, equal-amount (same
currency) transactions across two different accounts of the same user within a
4-day window become a 2-leg net-0 group (status `auto`). No transfer-like category
is required to auto-match (user decision, cycle 1); the compensating control is
that **every auto group is itself an open review item** on `/review` until the
user **confirms** or **dissolves** it.

**Dissolving** a group reverts its legs to individual transactions and re-runs all
four rules on them (respecting dismissal permanence, FR4) — transfer-like legs get
unmatched-transfer flags, legs from unapproved vendors get unknown-vendor flags,
and a non-transfer-like leg from an approved vendor ends up unflagged. A dissolve
is **remembered**: the analyzer never auto-creates a group from those same
transactions again on later syncs; manual re-merge stays possible.

Merging (auto or manual) clears all open flags on the legs; the group itself is
then analyzed per FR1's merge-group rules — so a net-≠0 group from an unapproved
vendor immediately carries its own unknown-vendor flag.

**FR4 — Explicit resolution.** Every flag requires a user decision — approve vendor,
confirm/dissolve group, merge, or **dismiss** (per-transaction or per-group).
Nothing auto-resolves except unknown-vendor flags cleared by a vendor approval and
leg flags cleared by merging (FR1 exemption a, FR3). An auto group is not itself a
resolution: the group stays pending until confirmed or dissolved (FR3), so every
auto-matched transfer still gets explicit review — and a net-≠0 group is analyzed
as one transaction (FR1), so a merge can open a new group-level flag that itself
needs resolution. Dismissal is permanent: the same transaction (or group) is not
re-flagged by the same rule on later syncs or analyzer re-runs, including after a
dissolve.

**FR5 — `/review` page.** New authenticated page listing open flags grouped by rule
plus auto groups pending confirmation, newest first, with the actions above —
including a merge picker whose leg candidates are **any** of the user's
transactions, flagged or unflagged — plus counters: suspicious today, suspicious
this month (both counted by transaction date; a merge group uses its group date,
FR3), total open — all three counting open flags plus groups pending confirmation.
Filterable by day or month (same dates). Zero open flags and zero unconfirmed
groups is an explicit, visible "all clear" state.

**FR6 — Monthly report.** New report view, linked from the main nav: for a chosen
month, spend per user category with merge groups counted at their **net amount**
under the group's category — a net-0 group contributes nothing, so self-transfers
drop out (this applies from the moment a group is auto-matched, not only once
confirmed — same as the FR1 exemptions); resolved vs open flag counts (counted by
transaction/group date, as in FR5); and total in/out with merge groups at net
(net-0 groups drop out, so both totals reflect external cash flow only).
Categories come from the Plaid-category→user-category mapping: defaults seeded
from Plaid's `personal_finance_category` (current behavior), with a settings UI
where the user remaps any Plaid category to a category of their own naming.

**FR7 — Merge-aware budget.** The existing `/budget` monthly totals count merge
groups the same way — net amount under the group's category, auto-matched or
confirmed; legs are never counted individually (no double-counting, and net-0
transfers are not spend).

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
no Stripe calls) with fixture accounts/transactions that exercise all four rules,
an auto-matchable transfer pair, and one pending transaction, so the full
review/report flow is drivable locally without Plaid credentials. One fixture
vendor is seeded **pre-approved** (as if the user had approved it), with ≥ 3 prior
charges, one charge ≥ 3× their median, one below-threshold charge, **and one
refund** (which must not trigger or shift the charges-only median), so the
unusual-amount rule (FR1.3) is verifiable on first analysis (criterion 6); all
other vendors start pending per FR2. The fixtures also include an **unapproved
vendor with a −500 charge and a +100 refund** for the net-≠0 manual-merge
criterion 14. The seed also provides a follow-up step (e.g. a second seed phase)
that injects additional fixture transactions — including the pending transaction's
posted replacement under a new Plaid ID — and re-runs analysis, so post-decision
behavior (criteria 2–3, 15–17) is drivable without Plaid.

**FR10 — Bilingual UI (English + Simplified Chinese).** All app pages — existing
(dashboard, `/budget`, item detail, auth, billing) and new (`/review`, monthly
report, category-mapping settings) — render in English or Simplified Chinese via a
language switcher in the app shell. The choice persists per user (stored setting;
cookie fallback pre-login); default is English. UI chrome only — user data (vendor
names, category names, transaction descriptions) and the product name PBudget are
never translated.

**FR11 — Rename to PBudget (full technical rename; user decision, cycle 3).**
User-facing branding (UI chrome, page titles, email sender name) becomes
**PBudget**, and all technical identifiers follow: package name; image
`leozhu:5000/pbudget`; deploy step `make deploy run=pbudget` (Setups k8s directory,
manifest, and resource names renamed plaidbudget → pbudget); Vault paths
`secret/pbudget/config` and `secret/db/postgres-ai/pbudget` (policy + role renamed,
secrets seeded under the new paths on first deploy — never clobbering; old
plaidbudget paths retired); the app's own `pbudget` database + owner role in
postgres-ai (bare SQL identifier); nginx-internal vhost `pbudget.conf` with
`server_name pbudget.{{ domain }}` replacing `plaid.{{ domain }}`;
`APP_URL=https://pbudget.ppvnx.com`; `EMAIL_FROM=PBudget
<no-reply@pbudget.ppvnx.com>`. The renamed deploy step removes the superseded
plaidbudget k8s resources. User data is untouched.

## Non-goals

- **No emails or notifications** for findings in v1 — in-app only (user decision).
- **No scheduled/background sync** — analysis runs only on user-triggered sync.
- **No ML category prediction** — the old airflow model is not ported; mapping is
  deterministic from Plaid categories.
- **No rule-threshold configuration UI** — 3× median, 3-day duplicate window, 4-day
  transfer window are code constants in v1.
- **No transaction splitting** — merging combines whole transactions; a single
  transaction is never divided across categories or groups.
- **No billing changes** — the analyzer is part of the existing $1/account/month
  subscription; no new Stripe products or gates.
- **No changes to bank linking, auth, or email verification.**
- **No per-transaction category override** — category mapping is at the
  Plaid-category level in v1 (a merge group's user-picked *title* is not a
  category override; its category comes from the largest-outflow leg's mapping).
- **No languages beyond English and Simplified Chinese**, and **no translated
  transactional emails** — verification/billing emails stay English-only in v1
  (user decision).

## Success criteria

Verifiable end-to-end against the seeded demo user (FR9) unless noted:

1. After seeding and running analysis, every **posted** transaction from a
   never-approved vendor — excluding merge-group legs, which are represented by
   their group — has an open unknown-vendor flag visible on `/review` (the pending
   fixture transaction is exempt per FR1 exemption d, verified by criterion 15)
   (FR1.1, FR5).
2. Approving a vendor removes all its open unknown-vendor flags, and a subsequent
   sync/analysis of a new fixture transaction from that vendor produces no new
   unknown-vendor flag (FR2).
3. Rejecting a vendor leaves its transactions flagged, and new transactions from it
   are flagged again (FR2).
4. Two fixture transactions of +$X and −$X in different accounts 2 days apart are
   auto-merged into a pending net-0 group shown as **one transaction** (amount 0,
   title defaulting to the outflow leg's); neither leg carries an
   unmatched-transfer or unknown-vendor flag; the group is listed on `/review`
   pending confirmation; and dissolving it re-runs the rules and re-flags both legs
   (the fixture pair is e-transfer-named, so both get unmatched-transfer flags)
   (FR3).
5. A fixture transfer-out with no counterpart within 4 days has an open
   unmatched-transfer flag (FR1.2).
6. After the first analysis, the seeded pre-approved vendor's fixture charge ≥ 3×
   its median (with ≥ 3 priors) has an open unusual-amount flag; its
   below-threshold fixture charge does not; and its fixture **refund** carries no
   unusual-amount flag and does not shift the charges-only median (FR1.3, FR9).
7. Two same-vendor, same-amount fixture charges 1 day apart **each** carry an open
   duplicate flag (FR1.4).
8. Every flag and every group pending confirmation can be driven to resolved
   through UI actions only, and `/review` then shows the all-clear state with zero
   open counters (FR4, FR5).
9. The monthly report for the fixture month shows per-category totals matching
   hand-computed fixture sums, with the net-0 transfer group contributing nothing
   and the merged −500/+100 group counted as −400 in its category; remapping a
   Plaid category to a renamed user category moves its spend accordingly (FR6).
10. `/budget` monthly totals for the fixture month count the merge groups at net —
    zero for the transfer group, −400 for the Walmart-style group — with no leg
    counted individually (FR7).
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
    accounts, 6 days apart (outside the auto-window) — can be manually merged from
    `/review`; both unmatched-transfer flags clear and the result shows as one
    net-0 transaction. Separately, merging the unapproved fixture vendor's −500
    charge with its +100 refund yields one transaction at −400 whose default title
    is the charge leg's (editable by the user); the group then carries an
    unknown-vendor flag (net-≠0 groups are analyzed per FR1), which clears when
    that vendor is approved. The merge picker offers **unflagged** transactions as
    leg candidates (FR3, FR1).
15. The fixture pending transaction carries no flags after analysis; after seed
    phase 2 delivers its posted replacement and re-runs analysis, the posted row is
    flagged per FR1 and the pending→posted pair is **not** flagged as a duplicate
    (FR1 exemption d, FR9).
16. A flag dismissed in the UI stays resolved after seed phase 2 re-runs analysis —
    the same transaction is not re-flagged by the same rule (FR4).
17. Dissolving the auto-matched fixture group and re-running analysis (seed phase
    2) does not re-create the group — both legs keep their re-run flags per
    criterion 4 until resolved by hand (FR3).
18. With the app running, UI chrome shows **PBudget** and no user-visible
    "PlaidBudget" remains (page titles, nav, email sender name); the package and
    deploy identifiers are `pbudget` per FR11.

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
- **Production — end goal: https://pbudget.ppvnx.com working.** From `~/Setups`,
  `make deploy run=pbudget` (renamed step per FR11: single pod, image
  `leozhu:5000/pbudget` via the cluster registry, Vault-injected secrets, own
  `pbudget` database in postgres-ai, nginx-internal vhost
  `server_name pbudget.{{ domain }}`). Health check:
  `curl -fsS https://pbudget.ppvnx.com/api/health` → HTTP 200 through the public
  hostname.
- **Data migration (one-off, run by the owner):** `npm run migrate:portfolio` with
  `OLD_DATABASE_URL` (Postgres on leodb2, creds from Vault
  `secret/db/postgres/portfolio`) and `OLD_FERNET_KEY` in env; idempotent and
  re-runnable. Verified in CI/local against a fixture dump (criterion 11), not
  against production.

## Open assumptions

- Vendor identity is the normalized (case/whitespace-folded) `merchantName ?? name`
  string; no fuzzy matching in v1.
- Merge-group attribution: the group's title (user-editable), vendor, category, and
  date all default to the **largest-outflow leg** — per the user's "default to
  largest amount going out" (cycle 3); fallback when a group has no outflow leg is
  the largest absolute amount, ties broken by earliest date. All legs must share a
  currency.
- Transfer-like detection = Plaid `personal_finance_category` primary
  `TRANSFER_IN`/`TRANSFER_OUT`, or name matching e-transfer patterns
  (`/e-?transfer|etfr|send money/i`). This gates the unmatched-transfer rule only —
  auto-matching pairs any opposite-sign, equal-amount, cross-account transactions
  within the 4-day window, no transfer-like category required (user decision,
  cycle 1); the safeguard is that every auto group must be explicitly confirmed or
  dissolved (FR3/FR4). A transaction belongs to at most one merge group; when
  several auto-match candidates exist, the nearest-by-date one is chosen.
- Thresholds: 3× median for unusual amount (min 3 priors, median over **charges
  only** — user decision, cycle 3), 3-day duplicate window, 4-day auto-match
  window, exact amount match for auto-pairs.
- Dismissing a flag is per-transaction (or per-group) and permanent; the same
  transaction is not re-flagged by the same rule on later syncs or analyzer
  re-runs, including after a dissolve.
- The old Fernet key is taken from Vault/env for the migration, then rotated along
  with the other Portfolio secrets already flagged in the migration follow-ups.
- Locale is a per-user setting (cookie fallback pre-login), English default,
  Simplified Chinese as the only other locale; emails and user data untranslated
  (user decision, cycle 1).
- **Decision history.** Confirmed by the user in earlier review cycles and still in
  force: analysis on posted transactions only (FR1 exemption d); signed-amount
  duplicate matching (FR1.4); dismissal permanence with the pending-transaction
  fixtures that verify it (criteria 15–16); dissolution permanence (criterion 17,
  formerly "unlink permanence"); merge exclusions in FR6/FR7 applying from
  auto-match, while a group is still pending; the migration preserving original
  Plaid IDs (FR8, criterion 11); and the pre-approved seed vendor making the
  unusual-amount rule verifiable on first analysis (FR9, criterion 6). Earlier
  cycles' 2-leg "linked pair" semantics (opposite-sign/equal-amount constraints on
  manual pairing, the built-in vendor **Self**, pair exemption from all rules) are
  **superseded** by the cycle-3 merge-group model below.
- **Confirmed by the user in review cycle 3, round 1 (2026-07-03):** (a) full
  technical rename to **PBudget** with public URL **pbudget.ppvnx.com** (FR11);
  (b) linking generalized from 2-leg pairs to **N-way merge groups** displayed as
  one net transaction, any accounts/signs/amounts, no time window, title
  user-selectable defaulting to the largest-outflow leg (FR3); (c) merge-group rule
  treatment: legs exempt, net-0 groups exempt as self-transfers, net-≠0 groups
  analyzed as a single transaction under the group vendor (FR1); (d) transfer
  auto-match kept, producing 2-leg net-0 groups pending confirm/dissolve (FR3);
  (e) unusual-amount median over charges only (FR1.3).
