import { PrismaClient } from "@prisma/client";
import { encrypt, maybeDecrypt } from "./crypto";

// Columns encrypted at rest (app-level column encryption). Values are AES-256-GCM
// sealed on write and transparently restored on read by the extension below, so
// every call site keeps seeing plaintext. amount/balances stay numeric on purpose:
// a bare number without its vendor/category is near-anonymous, and keeping it
// numeric avoids a Decimal→string migration and keeps it DB-sortable/aggregatable.
const ENCRYPTED: Record<string, readonly string[]> = {
  PlaidTransaction: ["name", "merchantName", "category", "website"],
  PlaidAccount: ["name", "officialName"],
};
const ENCRYPTED_FIELDS = new Set(Object.values(ENCRYPTED).flat());

// Seal the configured fields of one write payload (create/update/upsert data).
function encryptData(model: string, data: unknown): void {
  const fields = ENCRYPTED[model];
  if (!fields || !data || typeof data !== "object") return;
  const rows = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[];
  for (const row of rows) {
    for (const f of fields) {
      if (typeof row[f] === "string") row[f] = encrypt(row[f] as string);
    }
  }
}

// Restore encrypted fields anywhere in a result graph — top-level rows AND
// relations pulled in via `include` (the per-model query hook only fires for the
// top-level model, so nested rows must be walked). maybeDecrypt is GCM-safe on
// plaintext, so touching a same-named field on another model (e.g. Vendor.name)
// is a no-op. ponytail: heuristic by field name; the auth tag — not the model —
// guarantees we only ever transform values we sealed. Recurses only into plain
// objects/arrays, so Date/Decimal instances are left alone. O(nodes) per query,
// negligible vs the DB round-trip.
function decryptResult(node: unknown): void {
  if (Array.isArray(node)) {
    for (const x of node) decryptResult(x);
    return;
  }
  if (!node || typeof node !== "object" || (node as object).constructor !== Object) return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (typeof v === "string") {
      if (ENCRYPTED_FIELDS.has(k)) (node as Record<string, unknown>)[k] = maybeDecrypt(v);
    } else if (v && typeof v === "object") {
      decryptResult(v);
    }
  }
}

function extend(base: PrismaClient) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, args, query }) {
          if (ENCRYPTED[model] && args && typeof args === "object") {
            // Dedupe by object identity so an upsert that aliases create===update
            // isn't double-sealed. Distinct objects each hold their own plaintext.
            const seen = new Set<unknown>();
            for (const slot of ["data", "create", "update"] as const) {
              const payload = (args as Record<string, unknown>)[slot];
              if (payload && !seen.has(payload)) {
                seen.add(payload);
                encryptData(model, payload);
              }
            }
          }
          const result = await query(args);
          decryptResult(result);
          return result;
        },
      },
    },
  });
}

// ponytail: singleton so Next's dev hot-reload doesn't open a new pool each time.
const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof extend> };

export const prisma =
  globalForPrisma.prisma ??
  extend(new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] }));

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Interactive-transaction client type for the EXTENDED client (what $transaction's
// callback hands you). Prisma's own Prisma.TransactionClient is the un-extended
// shape and no longer assignable, so helpers taking a `tx` use this instead.
export type Tx = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;
