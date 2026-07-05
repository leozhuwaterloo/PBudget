# Deploy notes — PBudget V2 (sb-79)

The V2 schema reaches prod through the normal pipeline (`make deploy run=plaidbudget`
from Setups → image build/import, `prisma db push` at container start, manifest apply).
Two manual one-time steps must happen **after** that deploy, **in this order**.

## 1. Run the legacy-vendor migration (once, right after the V2 deploy)

The V2 funnel replaces the old approve/reject vendor model. Existing data is
reshaped by an idempotent script that runs against the app's own database:

```sh
# inside the running app pod (or any env with DATABASE_URL pointing at prod):
npx tsx scripts/migrate-vendors-v2.ts      # or: npm run migrate:vendors
```

What it does, per user (FR11 / AC12):

- **Approved** legacy vendors → V2 vendors with `equals` condition rows on merchant
  name and/or transaction name that reproduce the legacy `merchantName ?? name` key,
  so every transaction they claimed **stays claimed** with zero manual work. Priority
  follows `decidedAt` order.
- **Pending / rejected** legacy vendors → deleted; their transactions resurface in the
  Review → Unmatched queue (work them down via the catalog).
- **All** `unknown_vendor` flags (open or dismissed) → deleted; that rule is retired
  and superseded by the unmatched queue.
- Then `rematchUser` materializes `PlaidTransaction.vendorId` and builds the initial
  unmatched backlog.

Run it **once**. Re-running is a byte-for-byte no-op (verified by
`npm run check:migration`), so it is safe to re-run if a deploy is retried.

> The deprecated `Vendor.status` / `Vendor.decidedAt` columns are intentionally left
> in place — the migration reads them. Drop them in a later change only after this
> migration is confirmed in prod.

## 2. Stripe tier prices (F15 — after the migration)

The tier billing (Free/Pro/Max) needs the two flat Stripe prices to exist before any
paid checkout works. F15 seeds `STRIPE_PRICE_PRO` / `STRIPE_PRICE_MAX` into Vault; the
prices themselves are created manually in Stripe, and the owner's old graduated-price
subscription is cancelled and re-created on a tier price via Checkout (the old price is
archived). These Stripe steps only start to matter **after** step 1 has run — the
connection limit is the only billing gate, and it reads `User.plan`, which the webhook
sets independently of the vendor migration.
