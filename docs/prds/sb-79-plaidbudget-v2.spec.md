# SPEC — PBudget V2: customizable categorization funnel (sb-79)

Source of truth alongside the PRD at `docs/prds/sb-79-plaidbudget-v2.md`. The PRD defines WHAT; this spec pins the shared contracts and how the cards fit. Repos: **PlaidBudget** (all app cards F0–F14), **Setups** (F15 only), **Portfolio** (read-only — the old funnel is read from git history for F4).

## Architecture overview

Next.js 14 App Router + React 18 + Prisma 6. SQLite dev / Postgres prod; **schema reaches databases via `prisma db push`** (no migrations directory: dev `npm run db:push`; prod pushes at container start; the Dockerfile seds the provider to postgresql). Therefore **every schema change must be additive/non-destructive** — nullable columns, defaulted columns, new tables only. Dev server: `npm run dev` → http://localhost:5300; health: `GET /api/health` → `{"ok":true}`. Reused unchanged: auth + email verification, Plaid link/sync (`src/lib/plaid.ts`), AES token encryption, i18n plumbing (en / zh-Hans), Statement theme. No new runtime dependencies; **no chart library** (Dashboard is hand-rolled inline SVG).

The V2 funnel, per posted transaction (pending rows stay invisible to analysis):
1. **Structure (manual):** merge groups (existing) and splits (new) shape the read model.
2. **Vendor match:** highest-priority matching vendor claims the txn (materialized `PlaidTransaction.vendorId`). Multi-match → priority winner assigned + `vendor_conflict` queue item. Zero match → `unmatched_vendor` queue item. Invariant: every effective item is matched or in the queue.
3. **Category resolution (read time):** split-part override → winning vendor's first matching condition row's category → vendor default category → `CategoryMapping` on Plaid primary → humanized primary.
4. **Suspicion flags:** `unmatched_transfer`, `unusual_amount`, `duplicate_charge` keep today's semantics/thresholds; identity = `vendorId`, fallback normalized string. `unknown_vendor` is retired entirely.

## Data model (F0 — the shared contract)

```prisma
model Vendor {                 // reshaped
  id, userId                   // as today
  name         String          // display name; @@unique([userId, name])
  icon         String?         // bundled icon slug | null → letter avatar
  categoryName String?         // optional DEFAULT category
  priority     Int?            // @@unique([userId, priority]); ascending = match order;
                               // NULL = legacy row, never matches
  status       String?         // DEPRECATED (legacy approval) — read only by F14's migration
  decidedAt    DateTime?       // DEPRECATED — legacy priority source for F14
  conditions   VendorCondition[]
}
model VendorCondition {
  id, vendorId (FK cascade)
  order        Int             // row order in vendor; FIRST matching row decides category
  categoryName String?         // per-row category (outcome, not a matching field)
  nameOp/nameValue String?     // contains|equals|starts_with|regex
  merchantOp/merchantValue String?
  amountMin/amountMax Decimal? // signed, Plaid convention (+ = outflow)
  accountId    String?         // FK PlaidAccount
  paymentChannel String?       // online|in store|other
  plaidPrimary/plaidDetailed String?
}
model PlaidTransaction { vendorId String? }          // + @@index([vendorId])
model TransactionSplit { id, userId, parentTransactionId String @unique, parts SplitPart[] }
model SplitPart { id, splitId (FK cascade), amount Decimal, label String?, categoryName String? }
model TransactionCategory { excludeFromTotals Boolean @default(false) }
model User      { plan String @default("free") }     // free|pro|max
model PlaidItem { createdAt DateTime @default(now()) } // FR10 downgrade ordering
// TransactionFlag.rule: unmatched_vendor | vendor_conflict | unmatched_transfer
//                       | unusual_amount | duplicate_charge   (unknown_vendor retired)
```

Semantics of a row: a condition row matches when **ALL** set fields hold; a vendor matches when **ANY** row matches. Name/merchant ops are case-insensitive against the whitespace-normalized string (same normalization as `normalizeVendor`). Regex ≤ 200 chars, validated at save (F1 exports the validator; F3/F4 reuse it — never fork). Deleting the deprecated `status`/`decidedAt` columns is deferred until after the prod data migration is confirmed — leave them in place.

## Key shared modules

- **`src/lib/analysis/match.ts` (F1)** — the ONLY implementation of condition/row/vendor evaluation. Exports: row evaluation, first-matching-row lookup (used by F2's category resolution), regex validator (used by F3/F4), and `rematchUser(userId)`: materializes `vendorId` on every posted txn (first match in ascending-priority order; split parents matched like any txn, parts inherit), then maintains the two queue flags over **effective items** (ungrouped posted txns + net-≠0 groups; a group's vendor = its primary leg's `vendorId` via `primaryLeg`; net-0 groups and grouped legs never queue; one queue row per split parent). Queue lifecycle: `unmatched_vendor` auto-closes on match, has NO dismiss; `vendor_conflict` auto-closes when overlap disappears, and manual dismissal is permanent (a dismissed conflict never reopens for that txn). Deterministic + idempotent. Rematch triggers: after sync/analyze (inside `analyzeUser`), and after every vendor create/edit/delete/reorder/instantiate (F3/F4 call it).
- **`src/lib/analysis/effective.ts` (F2)** — the read model every list/sum/page reads through. Split parents are replaced by their parts (title = parent title + part label; part category = its override, else the parent's live waterfall — never snapshotted; parts inherit the parent's vendor). Exposes matched vendor display name + icon (fallback: normalized string). The `EffectiveTransaction` type is the read contract for F8/F12/F13. The **analyzer's own** item builder stays parent-whole — splits must not hide duplicate/unusual charges.
- **`src/lib/categories.ts` (F2/F6)** — read-time waterfall (above) + `ensureDefaultCategories(userId)`: idempotent seed of the old funnel's 18 categories with `excludeFromTotals=true` on Income, Transfer In, Transfer Out, Transfer, Other Income; called at signup and lazily; never overwrites user edits.
- **`src/lib/catalog/vendors.ts` (F4)** — one-time authored extraction of ~150 merchant entries + Self/General Bank bucket entries from Portfolio `e8e10b8~1:App/airflow_tasks/dags/transaction_processor/process_transaction.py` (read via `git show` in the Portfolio checkout). Suggested categories use the seeded set's names. Icons: real brand SVGs checked into the repo (e.g. simple-icons, MIT), bundled at runtime, letter-avatar fallback; the icon library is reused by the vendor builder's icon picker. Instantiate = one-time copy into a user vendor, appended at lowest priority, then rematch.
- **`src/lib/stripe.ts` (F7)** — tiers per Plaid CONNECTION (`PlaidItem`): Free=1, Pro($5)=5, Max($15)=20. `reconcileQuantity` deleted. Env: `STRIPE_PRICE_PRO`, `STRIPE_PRICE_MAX` (Vault-seeded by F15). Webhook maps price id → `User.plan`; only active/trialing grant paid. Enforcement is the ONLY billing gate (F0 removed the global `subscribed` gate): new-connection link/exchange blocked at limit with 402 + CTA payload; after downgrade the first `limit` items by `PlaidItem.createdAt` sync, excess are read-only (sync → 402).

## Decisions workers must respect

- **Priorities**: unique ints per user, ascending = match order; new/instantiated vendors append at the END (lowest priority).
- **Integer cents everywhere** amounts are compared (split sums, matching amount bounds follow Decimal compare; split validation is exact in cents).
- **Merge/split mutual exclusion**, enforced on both sides (merge candidates/creation reject split parents+parts; splitting a merge leg rejected).
- **i18n discipline**: F0 creates commented placeholder regions per page area in `en.ts`/`zh.ts`; each page card edits ONLY its own region (this is what makes the UI cards parallel-safe). Every new string ships in en AND zh-Hans.
- **Page ownership** (parallel-safety): F8 owns `/accounts` + its api routes; F12 owns `/review`; F13 owns `/dashboard`; F9→F10→F11 serially own `/customizations`. Old pages (`/report`, `/budget`, `/billing`, `/settings/categories`, `/item/[itemId]`) are untouched until F14 deletes them. Nav is final from F0 — don't touch it.
- **Scripts**: `seed-demo.ts`/`check-analysis.ts` are the runnable quality gate; F1/F2 extend them on the serial spine, F14 does the final sweep (vendor rules + conflict + split + tier limit). Don't edit these from parallel cards.
- **Legacy data**: F14's `migrate-vendors-v2.ts` converts approved legacy vendors to V2 vendors (equals rows on merchant and/or txn name reproducing the legacy `merchantName ?? name` key; priority = `decidedAt` order), drops pending/rejected, deletes all `unknown_vendor` flags, then rematches. Idempotent; run manually against prod after the V2 deploy.
- **Deploy**: unchanged pipeline (`make deploy run=plaidbudget` from Setups). F15 adds the two price env exports to the Vault template and patches missing keys into the existing secret without clobbering. Manual once: create the two Stripe prices, fill Vault, archive the old graduated price, owner cancels + re-subscribes via Checkout.

## Card DAG

```
F0 foundation
├─ F1 match engine ──┬─ F2 read model ── F5 splits API ──┐
│                    ├─ F3 vendors API ─┐                │
│                    └─ F4 catalog ─────┤                │
├─ F6 categories API ── F9 customizations shell ── F10 vendor builder ── F11 billing UI ─┐
├─ F7 tier billing ──┬─ F15 Setups secrets                                               │
│                    └──────────────► F8 accounts page (also ◄ F2, F5) ──────────────────┤
├─ (F1,F3,F4,F5) ──► F12 review v2 ──────────────────────────────────────────────────────┤
└─ (F1,F2,F6) ─────► F13 dashboard v2 ───────────────────────────────────────────────────┴─ F14 migration & cleanup
```

Critical path: F0 → F1 → F3/F4 → F10 → F11 → F14.
