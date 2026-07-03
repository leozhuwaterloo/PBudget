# SPEC — PBudget Transaction Analyzer (sb-51)

Workers: this spec + the PRD (`docs/prds/sb-51-plaidbudget.md`) are source of truth. The PRD wins on product behavior; this spec wins on interfaces and file ownership. Repo layout: PlaidBudget (app, all cards except F11), Setups (F11 only), Portfolio (reference only — the old Django plaid app lives at git `e8e10b8^:App/plaid/models.py`; no Portfolio changes).

## Architecture

Next.js 14 App Router + React 18 + Prisma 6 (SQLite dev, Postgres prod — no enums, no Json columns, no provider-specific SQL). Dev port 5300. Auth/billing/email reused unchanged (`src/lib/auth.ts`, `guard.ts`, `stripe.ts`, `email.ts`). All new pages are session-gated like existing ones; all new APIs are session-scoped JSON routes under `src/app/api/`.

New subsystem: `src/lib/analysis/` — the analyzer and merge-group domain. Single entry point `analyzeUser(userId): Promise<void>`, called from the demo seed and from the sync route after upserts. Analysis is deterministic and idempotent: re-running over unchanged data changes nothing.

**Sign convention (normative):** DB stores Plaid convention — positive amount = money OUT (charge/outflow), negative = money IN (refund/credit/inflow). "Charge" everywhere means amount > 0. UI displays the user-facing convention (spend shown negative, per the PRD's "Walmart −500 and +100 → −400" example): render `-amount`.

**Vendor identity:** `normalizeVendor(merchantName, name)` = lower-cased, whitespace-folded `merchantName ?? name`. No fuzzy matching.

**Transfer-like:** Plaid `personal_finance_category.primary` ∈ {TRANSFER_IN, TRANSFER_OUT} (parse the JSON in `PlaidTransaction.category`) OR name matches `/e-?transfer|etfr|send money/i`.

**Constants** (`src/lib/analysis/constants.ts`): UNUSUAL_MULTIPLIER=3, UNUSUAL_MIN_PRIORS=3, DUPLICATE_WINDOW_DAYS=3, AUTOMATCH_WINDOW_DAYS=4. Rule ids: `unknown_vendor`, `unmatched_transfer`, `unusual_amount`, `duplicate_charge`.

## Data model (F0, normative — added to prisma/schema.prisma)

```prisma
model Vendor {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  name      String    // normalized vendor string
  status    String    @default("pending") // pending | approved | rejected
  decidedAt DateTime?
  @@unique([userId, name])
}

model TransactionFlag {
  id            String    @id @default(cuid())
  userId        String
  rule          String    // one of the four rule ids
  transactionId String?   // exactly one of transactionId | mergeGroupId is set
  mergeGroupId  String?
  status        String    @default("open") // open | dismissed | resolved
  createdAt     DateTime  @default(now())
  resolvedAt    DateTime?
  @@unique([rule, transactionId])
  @@unique([rule, mergeGroupId])
  @@index([userId, status])
}

model MergeGroup {
  id           String   @id @default(cuid())
  userId       String
  status       String   // auto | confirmed  (manual merges are born "confirmed")
  title        String   // user-editable; defaults from primary leg
  vendorName   String?  // normalized vendor of primary leg
  categoryName String?  // effective category of primary leg (via categoryFor)
  date         DateTime // primary leg's date
  netAmount    Decimal  // signed sum of legs (Plaid convention)
  currency     String?
  createdAt    DateTime @default(now())
  legs         MergeGroupLeg[]
}

model MergeGroupLeg {
  transactionId String     @id  // a transaction belongs to at most ONE group
  groupId       String
  group         MergeGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
}

model DissolvedGroupMemo {
  id     String @id @default(cuid())
  userId String
  legKey String // sorted transactionIds joined with "|"
  @@unique([userId, legKey])
}

model CategoryMapping {
  id           String @id @default(cuid())
  userId       String
  plaidPrimary String // e.g. "FOOD_AND_DRINK"
  categoryName String // target user category name (TransactionCategory row ensured)
  @@unique([userId, plaidPrimary])
}
// plus: User.locale String?  ("en" | "zh-Hans"; null = en)
```

Flag semantics: `dismissed` is PERMANENT — nothing ever reopens or deletes it (FR4, criterion 16). `resolved` = cleared by an action (vendor approval, merged into a group, group dissolved); the analyzer MAY reopen a resolved flag if the rule fires again (this is how dissolve re-flags legs). The analyzer NEVER closes flags; only actions do (approve / merge / dismiss).

## Analyzer semantics (F1 — `analyzeUser`)

Order matters:
1. Scope = the user's POSTED transactions (`pending: false`). Pending rows are invisible to analysis (FR1 exemption d).
2. Upsert a `Vendor` row (pending) for every distinct normalized vendor seen.
3. **Auto-match**: opposite-sign, equal-absolute-amount, same-currency pairs in two different accounts within 4 days, both ungrouped, sorted-leg key not in DissolvedGroupMemo; nearest-by-date pairing when multiple candidates; each match → `createMergeGroup(userId, legIds, {status: "auto"})` (in `src/lib/analysis/merge.ts`): creates group + legs, derives title/vendorName/categoryName/date from `primaryLeg` (largest outflow; fallback largest |amount|; ties → earliest date), netAmount = signed sum, and RESOLVES the legs' open flags.
4. **Effective items** = ungrouped posted txns + net-≠0 groups (evaluated at net amount under group vendor). Net-0 groups and ALL legs are exempt from every rule.
5. Rules over effective items:
   - `unknown_vendor`: vendor status ≠ approved. Fires on txns and net-≠0 groups.
   - `unmatched_transfer`: transfer-like INDIVIDUAL txn not in any group. Never fires on groups.
   - `unusual_amount`: APPROVED vendors only. A charge (amount > 0) ≥ 3× the median of that vendor's ≥3 PRIOR posted charges. Charges only — refunds neither trigger nor enter the median. Legs excluded from the median; a net-≠0 group whose net is a charge both enters and is evaluated against the group vendor's median at its net.
   - `duplicate_charge`: same vendor + same SIGNED amount within 3 days → BOTH rows flagged (each dismissed individually). Net-≠0 groups participate at net under group vendor.
6. Flag upsert invariant per (rule, target): fires & no row → create open; fires & dismissed → untouched; fires & resolved → reopen; fires & open → leave. Doesn't fire → leave whatever exists.

**Vendor approval** (F2, `src/lib/analysis/vendors.ts`): set approved → resolve ALL that vendor's open unknown_vendor flags (txn + group level) → immediately run the unusual_amount evaluation over the vendor's existing posted charges (same code path as rule 5.3 — never fork the median logic), respecting dismissal permanence and merge exemptions. Criterion 19's contract.

**Merge lifecycle** (F3): manual merge = `createMergeGroup(..., {status: "confirmed"})` after validating N≥2, all posted, same currency, none grouped; then analyze the group per rules above. Confirm: auto → confirmed. Dissolve: delete group+legs, write DissolvedGroupMemo, resolve the group's own open flags, re-run all four rules over the freed legs (dismissed stays dismissed). Retitle: PATCH title only.

**`effectiveTransactions(userId, {from, to})`** (`src/lib/analysis/effective.ts`, F3): ungrouped txns as-is + every group (auto OR confirmed — exclusions apply from auto-match, FR6/FR7) as ONE synthetic entry {isGroup, id, title, vendorName, categoryName, date, amount: netAmount, currency, legs}. Net-0 groups included at 0. Consumers: /review context, /report (F5), /budget (F7), transaction lists (F8).

**Categories** (`src/lib/categories.ts`, F0): `categoryFor(mappings, plaidPrimary)` = CategoryMapping override ?? humanize(primary) (humanize moves here from plaid.ts). Applied at READ time everywhere (report/budget/group category), so remaps retroactively move spend — required by criterion 9. `predictedCategory` stays as the sync-time default only.

## API surface

- F2: `GET /api/flags?day=|month=` (open flags grouped by rule + auto groups pending + counters {today, thisMonth, totalOpen} = open flags + status-auto groups, by txn/group date), `POST /api/flags/[id]/dismiss`, `GET /api/vendors`, `POST /api/vendors/[id]/approve|reject`.
- F3: `GET /api/merge/candidates` (all posted ungrouped txns), `POST /api/merge`, `POST /api/merge/[id]/confirm|dissolve`, `PATCH /api/merge/[id]` (title).
- F6: `GET/PUT /api/categories/mapping`.
- F9: `POST /api/settings/locale`.
All 401 without a session; all scoped to the session user.

## Pages

`/review` (F4): flags grouped by rule + pending auto groups, counters, day/month filter, actions (approve/reject vendor, dismiss, confirm/dissolve, N-way merge picker over candidates incl. unflagged), explicit all-clear state. `/report` (F5): month picker; per-category spend over effectiveTransactions with read-time mapping; resolved-vs-open counts; total in/out (groups at net; net-0 drops out). `/settings/categories` (F6). `/budget` (F7) and TransactionTable/ItemDetail/Dashboard lists (F8) switch to effectiveTransactions. Nav links for /review, /report, /settings/categories are added in F0 (layout.tsx is single-writer: F0, then F9 only).

## i18n (F9)

Hand-rolled, no new dependency: `src/lib/i18n/{en,zh}.ts` flat dictionaries + `t(locale, key)`; `getLocale()` = User.locale ?? `locale` cookie ?? "en"; switcher in nav sets cookie always + persists User.locale when logged in. UI chrome only — never vendor/category/transaction names or "PBudget". Emails stay English.

## Demo fixtures (F0 seed — the verification backbone)

`npm run seed:demo` (tsx; idempotent via fixed IDs; prints demo credentials). Demo user: verified email, subscriptionStatus "active" (passes guard.ts with no Stripe). One institution/item, 2+ accounts, same currency. All dates anchored relative to "today", within the current month where possible. Inventory (Plaid sign convention):
- Vendor A **pre-approved** (Vendor row status approved): 3 prior charges (e.g. 100/110/120 → median 110), one charge ≥ 3× median (e.g. 400), one below-threshold charge (e.g. 150), one refund (e.g. −50). → criterion 6.
- Vendor B **pending**: 3 prior charges + one ≥ 3× charge. → criterion 19.
- Several one-off unknown-vendor charges, at least one dated TODAY (counters). → criterion 1.
- E-transfer-named pair: +X account1, −X account2, 2 days apart → auto-match. → criteria 4, 17.
- Lone transfer-out, no counterpart within 4 days. → criterion 5.
- Transfer pair, opposite sign, equal amount, different accounts, 6 days apart (outside window). → criterion 14a.
- Vendor C unapproved: 500 charge + −100 refund. → criteria 14b, 9, 10.
- Duplicate pair: same vendor, same signed amount, 1 day apart. → criterion 7.
- One PENDING transaction (pending: true). → criterion 15.
Phase 2 (`npm run seed:demo -- --phase2`): the pending txn's posted replacement (NEW Plaid ID, pendingTransactionId set), a new txn from Vendor B, a new txn from an unknown vendor; re-runs analyzeUser. → criteria 2, 3, 15–17. Both phases end by calling analyzeUser. `npm run check:analysis` (F1) computes expectations from the fixture definitions and asserts the post-analysis DB state; verifiers rely on it.

## File ownership (collision map)

- F0: prisma/schema.prisma, package.json, layout.tsx, email.ts, plaid.ts (branding line + humanize move), lib skeleton, scripts/seed-demo.ts, .env.example, README.
- F1: src/lib/analysis/* (fills), sync route (adds one call), scripts/check-analysis.ts.
- F2: api/flags/*, api/vendors/*, src/lib/analysis/vendors.ts (new). F3: api/merge/*, merge.ts (extends), effective.ts (new). No overlap — F2∥F3∥F10.
- F4: app/review/* + Review components. F5: app/report/* + Report component. F6: app/settings/categories/* + mapping API. F7: budget page + Budget.tsx. F8: TransactionTable/ItemDetail/Dashboard. Pairwise disjoint — F4∥F5∥F7∥F8 (F6 after F5 for verification only).
- F9: sweeps ALL pages/components + layout.tsx — must land after F4–F8 (enforced by depends_on).
- F10: scripts/migrate-portfolio.ts + fixtures + package.json script + `pg` dep.
- F11: Setups repo only (deploy_pbudget.py, k8s/pbudget/, vault-policy/pbudget-kv.hcl, nginx-internal pbudget.conf, deployment.yaml, registrations).

## Migration (F10) & deploy rename (F11) key decisions

F10: read old Postgres via `pg` from OLD_DATABASE_URL; Fernet decrypt implemented with node crypto (AES-128-CBC + HMAC-SHA256, ~40 lines); re-encrypt with existing crypto.ts (AES-256-GCM, APP_ENCRYPTION_KEY); attach to OWNER_EMAIL (default yuner25699@gmail.com); PRESERVE original Plaid transaction/account/item IDs (natural-key upserts → idempotent; prevents mass duplicate false-flags on next sync); analyzer NOT run inside the script. Bundled fixture (rows + fixture Fernet key + .sql dump) with `--fixture` mode through the same transform/upsert path — verifiable with zero production access.

F11: full plaidbudget → pbudget rename in Setups; first deploy COPIES secret/plaidbudget/config values to secret/pbudget/config (app_encryption_key MUST carry over — tokens stay decryptable), new creds at secret/db/postgres-ai/pbudget, one-time idempotent DB copy plaidbudget → pbudget (skip when pbudget has data), nginx vhost pbudget.conf (server_name pbudget.{{ domain }}), retire old plaidbudget k8s + vault resources after the copy. GitHub repo name unchanged. End gate: `make deploy run=pbudget` then `curl -fsS https://pbudget.ppvnx.com/api/health` → 200.

## Card DAG

F0 → F1 → {F2, F3, F10}; {F2,F3} → F4; F3 → {F5, F7, F8}; F5 → F6; {F4,F5,F6,F7,F8} → F9; {F9, F10} → F11. Critical path: F0→F1→F3→F5→F6→F9→F11.

## Verification environment (every card)

Node via `nvm use 22` (system node is too old). Local flow per PRD Deployment: `npm install; cp .env.example .env` (DATABASE_URL=file:./dev.db + generated APP_ENCRYPTION_KEY; Plaid/Stripe not needed), `npm run db:push && npm run seed:demo && npm run dev` → http://localhost:5300, health at /api/health. Drive UI as the demo user (credentials printed by the seed).
