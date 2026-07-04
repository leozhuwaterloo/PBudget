# PRD — PBudget V2: the customizable categorization funnel (sb-79)

## Problem

PBudget today categorizes transactions with almost no user control: a vendor is an
exact normalized string (`merchantName ?? name`, lowercased), categories come from
Plaid's `personal_finance_category.primary` with a flat primary→name remap, and the
only knobs are approve/reject per auto-discovered vendor string. The predecessor —
Portfolio's airflow funnel (`transaction_processor/process_transaction.py`, removed
in Portfolio commit `e8e10b8`, readable at `e8e10b8~1`) — achieved high accuracy the
opposite way: a 450-line **hardcoded** Python cascade of per-transaction-ID
overrides, Plaid detailed-category rules, and ~150 merchant `contains` lists mapping
into a fixed 21-value category enum. Accurate, but every correction was a code edit.

V2 rebuilds that funnel as **user-editable configuration**: user-defined vendors
with rich matching conditions (the contains-lists become editable rules), per-rule
vendor → category assignment (every transaction falls to a vendor; a vendor falls
to a list of categories), custom categories with budgets, manual splits (the
per-txn-ID override lists become UI actions), and a review queue guaranteeing every
transaction is either matched to a vendor or explicitly awaiting the user. Pages are
re-scoped around this funnel: a graphs-only Dashboard, a Review hub for everything
the funnel did, a new Accounts page for connections and raw data, and a new
Customizations page holding all configuration. Billing switches from
$1/bank-account/month quantity pricing to tiers (Free/Pro/Max) priced per Plaid
connection.

## Users

Existing account holders (today: a single power user, the owner) with one or more
Plaid-linked banks. No new user types. The owner's migrated history (~2 years,
Canadian banks, many local merchants) is the accuracy benchmark: the funnel must be
able to reproduce what the old hardcoded funnel decided, via configuration alone.

## Existing system (what V2 builds on)

Next.js 14 App Router + React 18 + Prisma 6 (SQLite dev / Postgres prod), port 5300,
deployed as `plaidbudget` via Setups (`make deploy run=plaidbudget`,
pbudget.ppvnx.com). Bilingual UI (en / zh-Hans), "Statement" ledger theme, no chart
library. Reused as-is: auth + email verification, Plaid link/sync
(`src/lib/plaid.ts`, 180-day lookback, on-demand sync), AES-encrypted access tokens,
i18n plumbing.

The analysis pipeline (`src/lib/analysis/`) that V2 modifies:

- `analyzeUser` (`analyze.ts`) runs after every sync: upserts a pending `Vendor` row
  per distinct normalized string, auto-matches opposite-sign equal-amount
  cross-account pairs into net-0 `MergeGroup`s, then fires four flag rules
  (`unknown_vendor`, `unmatched_transfer`, `unusual_amount`, `duplicate_charge`)
  over "effective items" (ungrouped txns + net-≠0 groups).
- `effectiveTransactions` (`effective.ts`) is the merge-aware read model every list
  and sum reads through; categories resolve at read time via `categoryFor`
  (`categories.ts`): user `CategoryMapping` override on the Plaid primary, else the
  humanized primary.
- Flag lifecycle (`fire` in `analyze.ts`): analyzer never closes a flag; only user
  actions do; dismissal is permanent.
- Pages: `/dashboard` (items table + connect/sync/reauth), `/review` (flags + pending
  auto-groups + vendor approve/reject), `/report`, `/budget`, `/settings/categories`,
  `/billing`, `/item/[itemId]`.
- Billing (`stripe.ts`): one subscription, quantity = `PlaidAccount` count,
  `reconcileQuantity` after every sync; everything gated on an active subscription.

## The V2 funnel

Order of evaluation for every posted transaction (pending rows stay invisible to
analysis, as today):

1. **Structure (manual):** merge groups (existing) and **splits** (new, FR5) shape
   what the read model shows — a group is one line at its net; a split parent is
   replaced by its parts.
2. **Vendor match (FR1):** the highest-priority vendor whose conditions match claims
   the transaction (materialized as `vendorId`). More than one match → the priority
   winner is still assigned and a `vendor_conflict` review item fires. Zero matches
   → an `unmatched_vendor` review item fires: **every transaction must end up
   matched to a vendor or sitting in the review queue.**
3. **Category resolution (FR3), at read time:** per-split-part category override →
   the winning vendor's **first matching condition row's category**, else the
   vendor's **default category** (both optional, FR1) → `CategoryMapping` on the
   Plaid primary → humanized Plaid primary. (The old funnel's detailed-category
   granularity is reachable by giving a condition row a Plaid detailed-category
   condition — the mapping table itself stays primary-level.)
4. **Suspicion flags:** `unmatched_transfer`, `unusual_amount`, `duplicate_charge`
   carry over with today's semantics and thresholds; vendor identity for them
   becomes `vendorId` (fallback: normalized string for unmatched txns).
   `unknown_vendor` is **replaced** by the `unmatched_vendor` queue.

Re-match triggers: after sync/analyze, and after any vendor create/edit/delete or
priority change. Matching is deterministic and idempotent; `unmatched_vendor` and
`vendor_conflict` are *queue-type* items that auto-close when re-matching shows the
condition no longer holds. A `vendor_conflict` can additionally be dismissed
manually (FR6), which suppresses it for that transaction; `unmatched_vendor` items
have no dismiss — they clear only by matching. The three suspicion rules keep
today's invariant unchanged: never auto-closed, only user actions close them,
dismissal permanent.

## Pages

| Page | V2 role |
|---|---|
| `/dashboard` | Graphs only (FR7): monthly spend trend, budget vs actual, items-to-review, top vendors. |
| `/review` | Everything the funnel wants a human for (FR6): unmatched queue, conflicts, 3 suspicion rules, pending auto-merges — plus browse/dissolve **all** merge groups and browse/unsplit all splits. |
| `/accounts` (new) | Connections: connect / sync / re-auth per item, accounts per item, raw per-account transaction browser (FR8). Absorbs today's dashboard table and `/item/[itemId]`. |
| `/customizations` (new) | All configuration (FR9): Categories & budgets, Plaid mappings, Vendors (ordered list + condition builder + catalog), Billing (tiers). Absorbs `/budget`'s budget-editing, `/settings/categories`, `/billing`. |
| Removed | `/report`, `/budget`, `/billing`, `/settings/categories`, `/item/[itemId]`. Nav becomes: Dashboard · Review · Accounts · Customizations. |

## Functional requirements

**FR1 — Vendor matching engine.** A vendor is a user-owned record: display name,
optional icon (user-settable in the builder — bundled icon library or letter
avatar, FR2), optional **default category**, strict priority (unique integer per
user; list is user-reorderable), and **1..N ordered condition rows**. A condition
row matches when ALL of its specified fields hold (AND); a vendor matches when ANY
of its condition rows match (OR) — exactly the shape of one line in the old funnel.
Each row may additionally carry its own category (one of the user's categories):
a transaction falls to a vendor, and a vendor falls to a **list of categories** —
the first matching row (in row order within the vendor) decides the category:
its row category if set, else the vendor's default — later matching rows are
never consulted (FR3). Multiple matching rows within ONE
vendor are normal, not a conflict. Condition fields (each optional, ≥1 required;
the row's category is an outcome, not a matching field):

- transaction name: `contains` | `equals` | `starts_with` | `regex` (case-insensitive,
  against the whitespace-normalized string; regex length capped at 200, invalid
  patterns rejected at save)
- merchant name: same operators
- signed amount range: min and/or max (Plaid convention, + = outflow)
- account: one of the user's `PlaidAccount`s
- payment channel: `online` | `in store` | `other`
- Plaid category: primary and/or detailed (from the stored category JSON)

Matching materializes `PlaidTransaction.vendorId` (nullable). Merge groups take
their vendor from the primary leg's `vendorId` (primary leg = the existing
`primaryLeg` rule in `src/lib/analysis/groups.ts`: largest outflow, else largest
|amount| — the same leg groups already take their title/category from). First match in priority order wins;
multi-match additionally fires `vendor_conflict` (FR6) so the user can tighten
conditions or reorder — the ideal end state is zero conflicts. Vendors are kept
precise and non-overlapping by design: broad category-level fallbacks belong to
the lower tiers of the category waterfall (FR3), not to wide vendor conditions,
and one-off personal noise is matched by coarse bucket vendors (FR2: Self,
General Bank) rather than a catch-all.

**FR2 — Vendor catalog.** A predefined, checked-in catalog seeded from the old
funnel's fixed merchant lists (extract every distinct merchant/name string from
`predicted_category_funnel`, `default_categories_funnel`, and `name_funnel` at
Portfolio `e8e10b8~1:App/airflow_tasks/dags/transaction_processor/process_transaction.py`
— on the order of 150 entries: Tim Hortons, Costco, T&T Supermarket, Walmart, Uber
Eats, Pet Valu, Air Canada, Rogers/Fido/Bell, Steam, IKEA, Dollarama, Amazon,
Taobao…). Each catalog entry carries: display name, default condition rows
(translating that line of the old funnel: the contains-string plus any payment-channel
/ Plaid-category constraint it had), a suggested category per row (the old enum
name that line returned, FR4), and an icon. Icons are sourced online once during development (real brand SVGs
fetched from logo libraries such as the MIT-licensed `simple-icons` set or official
brand assets) and checked into the repo; entries with no sourceable logo fall back
to an auto-generated letter avatar. At runtime all icons are bundled — no external
fetches. The user can also change any vendor's icon themselves in the vendor
builder (pick from the bundled icon library, or letter avatar). Alongside merchant
entries, a few
**bucket** entries (e.g. Self, General Bank) fold in the old funnel's personal-
and bank-noise lines (transaction-ID overrides, e-transfer patterns, ABM fees,
rebates) with per-row categories, so every historical transaction has a catalog
path to a vendor. In the vendor builder the user browses/searches the catalog and **instantiates** an entry — a
one-time copy into their own editable vendor (no live link to the catalog).
Catalog data lives in-repo (e.g. `src/lib/catalog/vendors.ts`) with a provenance
comment; the extraction is a one-time authored artifact, not a build step.

**FR3 — Category resolution.** As specified in "The V2 funnel" step 3. Resolution
stays at read time so any config change retroactively moves spend with no rewrite —
same principle as today's `categoryFor`, extended with the vendor steps (row
category, then vendor default) and split overrides. Every tier of the waterfall is
user-editable in Customizations (FR9). `CategoryMapping` (plaid primary → user category) and its UI carry over
unchanged into Customizations.

**FR4 — Custom categories & budgets.** Customizations lets the user create, rename,
and delete categories, set a monthly `budget` per category, and toggle a new
`excludeFromTotals` flag (replaces `Budget.tsx`'s hardcoded
`IGNORE = {Income, Transfer In, Transfer Out}`; for parity, `excludeFromTotals`
seeds `true` on Income, Transfer In, Transfer Out — rows created if the user
lacks them — and on the seeded Transfer and Other Income categories). Every user is seeded with the
old funnel's category set (Transfer, Grocery, Restaurant, Food Delivery, Online
Shopping, In-Store Shopping, Game, Entertainment, Income, Other Income, Fee,
Recurring, Utility, Pet, Travel, Cash, Gas, Baby — `BigPayment`/`Unknown`/`Ignore`
are funnel outcomes, not categories, and are not carried over). Rename cascades to
all rows referencing the name (`CategoryMapping.categoryName`, vendor default and
condition-row categories, split-part category). Delete requires the category to be unreferenced. Existing
`TransactionCategory` rows and budgets are preserved.

**FR5 — Manual splits.** The user can split any posted, **ungrouped** transaction
into N ≥ 2 parts. There is **no auto-split — always manual**. Each part has an
amount (non-zero, same sign as the parent, integer-cents sum exactly equal to the
parent), an optional label, and an optional category override. An unset override
stores nothing: the part resolves at read time through the parent's waterfall
(funnel step 3), so it keeps following vendor/config changes — the split UI may
*display* the parent's currently-resolved category as the default, but must not
snapshot it. Vendor is inherited from the parent (per-part vendors
out of scope). Split and merge are mutually exclusive on a transaction: a split
parent can't be merged (its parts aren't merge candidates either) and a merge leg
can't be split — dissolve/unsplit first. The read model replaces the parent with
its parts (title = parent title + part label), so budgets and all Dashboard graphs
see parts; the analyzer keeps evaluating the **parent** as one transaction (a split
must not hide a duplicate or unusual charge). Unsplit restores the parent anytime;
editing a split = replacing its parts. Split actions live on the Accounts raw
browser rows and on Review entries; all existing splits are browsable/unsplittable
on Review.

**FR6 — Review v2.** One page, sectioned:

1. **Unmatched transactions** — every posted txn (and net-≠0 group) with no vendor,
   shown as a flat paged list, one row per transaction. Actions per row: instantiate
   a catalog vendor, create a custom vendor pre-filled from the row (equals-condition
   on its normalized string), or extend an existing vendor's conditions. Re-match
   runs after each action and removes **every** queue row the new/edited vendor now
   matches — not just the acted-on row; the queue shrinks live.
2. **Conflicts** — multi-matched txns showing every matching vendor and the priority
   winner. Actions: jump to the vendors to edit conditions/priority, or dismiss
   (accept the winner; permanent for that txn).
3. **Suspicion flags** — `unmatched_transfer`, `unusual_amount`, `duplicate_charge`
   tables as today (dismiss / merge actions; vendor approve/reject disappears with
   the old vendor model).
4. **Merges & splits** — pending auto-groups (confirm/dissolve, as today) plus
   browsable lists of ALL confirmed merge groups (dissolve) and ALL splits
   (unsplit). Manual N-way merge picker carries over.

Counters row spans open items across all sections (today / this month / total).

**FR7 — Dashboard.** Graphs only, current data from the effective read model
(merge- and split-aware, category-resolved). Four widgets: (a) monthly spend trend —
total spend per month, last 12 months, excluding `excludeFromTotals` categories;
(b) budget vs actual per category for the selected month (defaults to current);
(c) items to review — stat tiles per Review section, linking into `/review`;
(d) top vendors by spend for the selected month, with icons. Charts are hand-rolled
inline SVG in the Statement theme — no chart dependency. The connect/sync UI moves
to `/accounts`; the not-subscribed banner is replaced by tier-limit CTAs (FR10).

**FR8 — Accounts page.** Lists Plaid items (institution, accounts, last-updated,
sync / re-auth / connect actions — moved from today's dashboard) and, per account,
a paged **raw transaction browser**: the `PlaidTransaction` rows as fetched (name,
merchant, amount, date, pending, Plaid category), before any funnel processing,
with the resolved vendor/category shown alongside and a split action on eligible
rows (posted, ungrouped — FR5).
Connect is blocked with an upgrade CTA when at the tier's connection limit.

**FR9 — Customizations page.** Sections: **Categories & budgets** (FR4),
**Category mappings** (FR3), **Vendors** (FR1/FR2: priority-ordered list with drag
or up/down reorder, icon, category chips, per-vendor condition builder with
per-row category, catalog browser), **Billing** (FR10: current tier, usage `n of limit connections`,
upgrade/downgrade via Stripe Checkout, manage via Stripe portal).

**FR10 — Tier billing.** Tiers are priced per **Plaid connection** (`PlaidItem` —
a bank login), not per bank account: **Free = 1, Pro ($5/mo) = 5, Max ($15/mo) =
20**. Replaces the $1/bank-account quantity model: `reconcileQuantity` and the
per-account price are retired; two flat Stripe prices are created once, manually
in Stripe (env
`STRIPE_PRICE_PRO`, `STRIPE_PRICE_MAX`, seeded via Vault like today's
`STRIPE_PRICE_ID`). `User.plan` (`free` default) is set by the webhook from the
subscription's price id; only `active`/`trialing` statuses grant a paid plan.
Enforcement: connecting a new bank is blocked at the limit (402-style error + CTA);
on downgrade, connections beyond the limit stay visible **read-only** — items
ordered by connection date, the first `limit` keep syncing, the excess can't sync
until upgrade or disconnect. Free tier requires no card and no subscription — the
global subscription gate (today wrapping every app API route, not just
sync/connect) is removed everywhere; the connection limit is the only billing
enforcement.
The owner's existing graduated-price subscription is cancelled and re-created on a
tier price via Checkout (one-time manual step, noted in deploy notes); the old
price is archived in Stripe.

**FR11 — Migration & cleanup.**

- Prisma migration for the new tables/columns (below), applied to dev SQLite and
  prod `postgres-ai` via the existing deploy step.
- Data migration (idempotent script, like `migrate-portfolio.ts`): each existing
  **approved** `Vendor` row becomes a V2 vendor with one equals-condition on its
  normalized name (priority = `decidedAt` order); `pending`/`rejected` rows are
  dropped — their transactions surface in the unmatched queue. Open/dismissed
  `unknown_vendor` flags are deleted (superseded by the queue). First re-match
  builds the initial unmatched backlog, worked down via the catalog.
- Delete removed pages/components/APIs (`Report`, `Budget` page shell,
  `BillingClient` page, `/settings/categories` route, `reconcileQuantity`), update
  nav, add en + zh strings for all new UI, update `seed-demo.ts` and
  `check-analysis.ts` to exercise the new funnel (vendor rules, conflict, split,
  tier limit).

## Data model changes (sketch)

```prisma
model Vendor {              // reshaped
  id/userId                 // as today
  name        String        // display name, unique per user
  icon        String?       // catalog slug or null → letter avatar
  categoryName String?      // optional DEFAULT category (FR3 fallback)
  priority    Int           // unique per user; match order
  conditions  VendorCondition[]
}
model VendorCondition {
  id/vendorId
  order       Int           // row order within the vendor; first match wins
  categoryName String?      // optional per-row category (FR3 step)
  nameOp/nameValue          // contains|equals|starts_with|regex
  merchantOp/merchantValue
  amountMin/amountMax       // Decimal, signed
  accountId                 // optional FK PlaidAccount
  paymentChannel            // optional
  plaidPrimary/plaidDetailed// optional
}
model PlaidTransaction { vendorId String? }   // + index
model TransactionSplit {
  id/userId
  parentTransactionId String @unique          // one split per txn
  parts SplitPart[]
}
model SplitPart { id/splitId; amount Decimal; label String?; categoryName String? }
model TransactionCategory { excludeFromTotals Boolean @default(false) }
model User { plan String @default("free") }   // free|pro|max
// TransactionFlag.rule gains: unmatched_vendor, vendor_conflict (unknown_vendor retired)
```

## Non-goals

- Auto-split, fuzzy/ML vendor matching, and the old per-transaction-ID override
  lists (splits + review actions supersede them).
- The old `BigPayment` per-category cap (the `unusual_amount` rule covers it).
- Per-split-part vendors, per-transaction category overrides, vendor-match audit UI
  (declined in discovery).
- Detailed-level `CategoryMapping` (vendor conditions on `plaidDetailed` cover it).
- Multi-currency budget math (single-currency assumption stands, as in `Report.tsx`).
- Proration/refund handling beyond what Stripe Checkout/portal do natively.

## Deployment

Unchanged from today's setup — V2 rides the existing pipeline:

- **Local dev:** `npm run dev` (`next dev -p 5300`) → http://localhost:5300, SQLite
  via Prisma (`npm run db:migrate` applies migrations).
- **Production:** from the Setups repo, `make deploy run=plaidbudget` — builds and
  imports the image, applies Prisma migrations against the shared `postgres-ai`
  cluster, seeds Vault secrets (first deploy only), and applies the manifest. Live
  at https://pbudget.ppvnx.com. The two new Stripe price env vars
  (`STRIPE_PRICE_PRO`, `STRIPE_PRICE_MAX`, FR10) must be seeded in Vault before the
  first V2 deploy.
- **Health check:** `GET /api/health` returns `{"ok":true}` (the existing k8s probe
  target) — https://pbudget.ppvnx.com/api/health in prod,
  http://localhost:5300/api/health in dev.

## Open assumptions (flag disagreements in review)

1. New vendors append at the **end** of the priority order (lowest priority).
2. Rejected/pending legacy vendors are dropped, not migrated; previously dismissed
   `unknown_vendor` transactions may reappear in the unmatched queue once.
3. Split parts keep the parent's sign; refund-vs-charge decomposition stays merge
   territory.
4. Catalog extraction is one-time and manual-ish (~150 entries authored from the old
   funnel file); personal-noise lines (transaction-ID overrides, "wife transfer"
   strings, e-transfer patterns) are not dropped — they fold into the bucket
   entries (FR2: Self, General Bank) so the unmatched queue can reach zero.
5. Dashboard month selector is shared by widgets (b) and (d); (a) and (c) are fixed
   windows.
6. Tier limits count `PlaidItem` rows regardless of sync health; a broken connection
   still occupies a slot until removed.

## Acceptance criteria

1. A transaction matching no vendor appears in Review → Unmatched; creating a vendor
   from it (or instantiating a matching catalog entry) removes it — and every other
   unmatched row the new vendor matches — from the queue and sets their `vendorId`
   without a fresh sync.
2. Two vendors matching the same transaction: the higher-priority one is assigned,
   a conflict item appears; reordering priorities flips the assignment and re-match
   auto-closes the conflict when conditions no longer overlap.
3. Condition operators (contains/equals/starts_with/regex on name and merchant,
   amount range, account, payment channel, Plaid primary/detailed) each demonstrably
   include and exclude transactions in the raw browser.
4. Vendor categories move spend on Dashboard immediately (read-time resolution,
   retroactive): two condition rows of one vendor route their transactions to two
   different categories; a row without a category falls back to the vendor default,
   and to the Plaid mapping when both are unset.
5. Splitting a $100 charge into $60/$40 with different categories: Dashboard's
   budget-vs-actual shows $60 and $40 in the two categories; the parent is gone from
   effective lists; unsplit restores it. Sum ≠ parent or a merged transaction →
   validation error. Split parents never appear in merge candidates.
6. The three suspicion rules still fire per today's semantics (analyzer evaluates
   split parents whole); `unknown_vendor` no longer exists anywhere.
7. Review browses ALL merge groups and splits; dissolve and unsplit work from there;
   pending auto-groups still confirm/dissolve.
8. Dashboard renders the four widgets from effective data with no chart dependency;
   items-to-review tiles link into Review sections.
9. Accounts page: connect/sync/re-auth per item; raw browser pages through an
   account's transactions showing pre-funnel fields + resolved vendor/category.
10. Free user with 1 connection syncs without any subscription; connecting a 2nd is
    blocked with an upgrade CTA; after Pro checkout it succeeds; a Pro→Free
    downgrade leaves the oldest connection syncing and the rest read-only.
11. Stripe webhook maps price id → `User.plan`; portal/checkout round-trips work
    from Customizations → Billing.
12. Legacy migration: an approved vendor's transactions stay matched after
    migration with zero manual work; catalog instantiation of "Tim Hortons" matches
    the owner's historical Tim Hortons rows.
13. All new UI strings exist in en and zh-Hans; removed pages 404/redirect and nav
    shows Dashboard · Review · Accounts · Customizations.
14. `seed-demo.ts` + `check-analysis.ts` pass, exercising vendor rules, a conflict,
    a split, and the tier limit.
15. Categories & budgets (FR4): renaming a category updates every referencing row
    (`CategoryMapping`, vendor default, condition-row, split-part) and spend follows
    under the new name; deleting a referenced category is rejected until references
    are removed; toggling `excludeFromTotals` on a category removes its spend from
    the Dashboard monthly-trend widget.
