# PBudget — Next.js + Prisma. Single-stage for reliability (homelab scale):
# keep node_modules so the prisma + next CLIs are available at container start.
FROM node:22-slim

# Prisma needs openssl at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first. prisma/ is copied before `npm ci` so the postinstall
# `prisma generate` finds the schema.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .

# Prod runs on the shared postgres-ai cluster. Swapping the Prisma provider
# from sqlite -> postgresql is the ONLY change needed to move databases
# (CLAUDE.md); DATABASE_URL comes from Vault at runtime.
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma

RUN npm run build

ENV NODE_ENV=production
EXPOSE 5300

# k8s overrides this to also source /vault/secrets/*. `prisma db push` makes the
# schema match on first boot (idempotent); then start the server.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node_modules/.bin/next start -p 5300"]
