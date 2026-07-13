# PBudget

PBudget is a **Next.js + React full-stack application**.

## Stack
- **Framework:** Next.js (App Router) + React, full-stack — UI, API routes, and
  server-side logic all live in this one app.
- **Database:** Use **SQLite for local development**. Keep the data layer
  **easily pluggable to PostgreSQL** for production: isolate all DB access behind
  a thin layer so switching SQLite ↔ Postgres is a config/connection change, not
  a query rewrite. Use **Prisma 6** as the ORM — it supports both SQLite and
  Postgres, so migrating is just a datasource provider + connection-string swap.
  Only stand up a database if there is actually data to store.

## Local development
- This app's **reserved dev port is 5300**. Run the dev server on it:
  next dev -p 5300. The port is fixed for this app — each AIOnboarding app gets
  its own port, incremented by 100 from the previous one (5100, 5200, 5300, …).

## Product intent
- Build this as a **full, production-minded application** with **payments** and
  **user engagement** in mind from day one (accounts, auth, billing, retention).
- **Capture the user's email address wherever it is reasonable** to do so.
- **Always validate email addresses** — syntactic validation on input, plus a
  verification step (confirmation link or code) before treating an address as
  trusted.

## Deployment (home k3s cluster, via the Setups repo)
Deploy through the **Setups** infrastructure-as-code repo (~/Setups — config-first,
make-driven); never by one-off commands on a host. Wire this app as a deploy step and
apply it with a single command: make deploy run=<app>.
- **Two pods, zero-downtime deploys**: a Deployment with strategy: RollingUpdate
  (maxUnavailable: 1, maxSurge: 1) and NO fixed replicas — an HPA owns the count
  (minReplicas: 2, maxReplicas: 4, CPU 70%), so ≥1 pod always serves during a deploy
  (no 502 window). The deploy `kubectl apply`s then `kubectl rollout restart`s — it
  must NOT `delete` the Deployment (a delete tears down every pod = outage).
  Scheduled on the app nodes (nodeAffinity NotIn **leoml / leodb2**). The image is
  pushed to the in-cluster registry (leoml:7000) and pulled with imagePullPolicy: Always.
- **Secrets via Vault sidecar injection**: annotate the pod with
  vault.hashicorp.com/agent-inject plus a role and a read-only policy; render secrets
  into /vault/secrets/ (perms 0644) and source them at container startup. Never
  hardcode credentials in code, env, or YAML.
- **Database — shared postgres-ai cluster** (in-cluster host postgres-ai.database:5432):
  create this app's **own new database** and owner role in it (idempotent init SQL),
  keep the creds in Vault at secret/db/postgres-ai/<app>, and build DATABASE_URL from
  them. The database/role name must be a bare SQL identifier (no hyphens).
- **Setup script**: the deploy step IS the setup script — it builds/imports the image,
  writes the Vault policy + role, seeds secrets on first deploy (never clobbering),
  creates the database, and applies the manifest. Keep it idempotent and re-runnable.
