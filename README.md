# PBudget

Personal-finance budgeting backed by [Plaid](https://plaid.com), migrated out of the
Portfolio monorepo (`/portfolio/plaid/`) into a standalone **Next.js (App Router) +
Prisma** application.

## What it does

- **Connect banks** via Plaid Link, **sync** 180 days of accounts + transactions.
- **Budget planning**: monthly spend per category vs. budget (the headline view),
  with inline budget editing.
- **Item detail**: per-bank accounts and their transactions.
- **Accounts**: email + password auth with an email-verification step.
- **Billing**: Stripe subscription at **$1 per managed account / month** (subscription
  quantity tracks your account count).

## Stack

Next.js 14 · React 18 · Prisma 6 · SQLite (dev) → PostgreSQL (prod) · Plaid Node SDK ·
Stripe · nodemailer. **Requires Node ≥ 18** (this host: `nvm use 22`).

## Local development

```bash
nvm use 22
cp .env.example .env          # then fill in the values (see below)
npm install
npm run db:push               # create the SQLite schema
npm run dev                   # http://localhost:5300  (reserved port)
```

Sign up, then open the verification link — in local dev (no SMTP configured) it is
**printed to the server console** instead of emailed.

### Required env (`.env`)

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | `file:./dev.db` for SQLite; a Postgres URL in prod |
| `APP_ENCRYPTION_KEY` | base64 32-byte key; encrypts Plaid access tokens at rest. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_COUNTRY_CODES` | Plaid API access |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` | Billing. `STRIPE_PRICE_ID` is a recurring **$1.00/month** price billed per unit |
| `SMTP_*`, `EMAIL_FROM` | Verification emails (optional in dev) |

Point your Stripe webhook at `POST /api/stripe/webhook`
(`checkout.session.completed`, `customer.subscription.*`).

## SQLite → Postgres

Switch `provider` in `prisma/schema.prisma` from `sqlite` to `postgresql` and point
`DATABASE_URL` at the Postgres instance — no query changes. The Setups deploy step
does this swap for the in-cluster `postgres-ai`.

## Mapping from the old Django app

| Portfolio (Django/Redux) | Here |
|--------------------------|------|
| `App/plaid/models.py` | `prisma/schema.prisma` |
| `App/plaid/views.py` + `update_item`/`fetch_link_token` tasks | `src/lib/plaid.ts` + `src/app/api/plaid/*` |
| Fernet token encryption | AES-256-GCM (`src/lib/crypto.ts`) |
| `PlaidLanding` / `PlaidBudget` / `PlaidItemDetail` (React+Redux) | `src/components/*` + server pages under `src/app/*` |
| ML `predicted_category` (airflow) | derived from Plaid `personal_finance_category` at sync time |
| `IsAdminUser` + access-code gate | real per-user auth + Stripe subscription gate |
