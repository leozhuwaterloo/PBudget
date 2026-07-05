// One-off, idempotent migration of the LEGACY approve/reject vendor model into V2
// vendors, and cleanup of the retired unknown_vendor queue (FR11 / AC12).
//
//   npx tsx scripts/migrate-vendors-v2.ts     # runs against THIS app's DATABASE_URL
//
// Unlike migrate-portfolio.ts this reads no external source — it reshapes rows
// already in this app's DB (the deprecated Vendor.status/decidedAt columns F0 kept).
// Run it ONCE against prod AFTER the V2 deploy (see docs/deploy-notes.md). Re-running
// changes nothing.
//
// Per user with legacy vendors (status != null):
//  - status "approved" -> convert to a V2 vendor: equals-condition rows on merchant
//    name and/or transaction name that reproduce the legacy
//    normalizeVendor(merchantName ?? name) key. That key can come from EITHER field
//    per transaction, so we inspect the user's transactions and emit a merchant row,
//    a name row, or both — whichever origins actually occur. priority = decidedAt
//    order, so every claimed transaction stays claimed with zero manual work.
//  - status "pending"/"rejected" -> DELETE (their transactions resurface in the
//    unmatched queue).
//  - ALL unknown_vendor flags (open or dismissed) -> DELETE (superseded by the queue).
//  - rematchUser(user) materializes vendorId on every posted txn and builds the
//    initial unmatched backlog.
//
// The deprecated status/decidedAt columns are LEFT in place (their removal is
// deferred until this migration is confirmed in prod). Idempotency therefore relies
// on guards, not on clearing status: converted vendors keep status "approved" and are
// re-visited on a re-run, but every write is skipped because priority + conditions
// already match.
import { prisma } from "../src/lib/db";
import { normalizeStr, normalizeVendor } from "../src/lib/analysis/vendor";
import { rematchUser } from "../src/lib/analysis/match";

type DesiredRow = {
  order: number;
  nameOp?: string;
  nameValue?: string;
  merchantOp?: string;
  merchantValue?: string;
};
type TxnLite = { name: string; merchantName: string | null };
type CondLite = {
  order: number;
  categoryName: string | null;
  nameOp: string | null;
  nameValue: string | null;
  merchantOp: string | null;
  merchantValue: string | null;
  amountMin: unknown;
  amountMax: unknown;
  accountId: string | null;
  paymentChannel: string | null;
  plaidPrimary: string | null;
  plaidDetailed: string | null;
};

// The equals-rows that reproduce a legacy vendor's normalized key, given the user's
// transactions. A transaction "belonged" to the legacy vendor iff its
// normalizeVendor(merchantName ?? name) equals the key; the key's origin for that
// transaction is the merchant field when merchantName is present, else the name field.
export function rowsForKey(key: string, txns: TxnLite[]): DesiredRow[] {
  let fromMerchant = false;
  let fromName = false;
  for (const t of txns) {
    if (normalizeVendor(t.merchantName, t.name) !== key) continue;
    if (t.merchantName != null) fromMerchant = true;
    else fromName = true;
  }
  // No historical txn (e.g. rolled off the 180-day window): reproduce both origins so
  // the vendor keeps claiming its key going forward.
  if (!fromMerchant && !fromName) {
    fromMerchant = true;
    fromName = true;
  }
  const rows: DesiredRow[] = [];
  if (fromMerchant) rows.push({ order: rows.length, merchantOp: "equals", merchantValue: key });
  if (fromName) rows.push({ order: rows.length, nameOp: "equals", nameValue: key });
  return rows;
}

// Full-shape equality so a re-run is a no-op: existing rows differ from desired only
// on a first run (legacy vendors have no conditions) — then never again.
function sameRows(existing: CondLite[], desired: DesiredRow[]): boolean {
  if (existing.length !== desired.length) return false;
  const norm = (r: Partial<CondLite> & { order: number }) =>
    JSON.stringify([
      r.order,
      r.categoryName ?? null,
      r.nameOp ?? null,
      r.nameValue ?? null,
      r.merchantOp ?? null,
      r.merchantValue ?? null,
      r.amountMin ?? null,
      r.amountMax ?? null,
      r.accountId ?? null,
      r.paymentChannel ?? null,
      r.plaidPrimary ?? null,
      r.plaidDetailed ?? null,
    ]);
  const e = [...existing].sort((a, b) => a.order - b.order).map(norm);
  const d = [...desired].sort((a, b) => a.order - b.order).map(norm);
  return e.every((x, i) => x === d[i]);
}

export type MigrateResult = { approved: number; dropped: number; flags: number };

export async function migrateUser(userId: string): Promise<MigrateResult> {
  const legacy = await prisma.vendor.findMany({
    where: { userId, status: { not: null } },
    include: { conditions: true },
  });
  // decidedAt order = match priority; id breaks ties so the ordering is deterministic.
  const approved = legacy
    .filter((v) => v.status === "approved")
    .sort(
      (a, b) =>
        (a.decidedAt?.getTime() ?? 0) - (b.decidedAt?.getTime() ?? 0) ||
        a.id.localeCompare(b.id)
    );
  const drop = legacy.filter((v) => v.status !== "approved");

  // Delete pending/rejected legacy vendors first (frees their names/priorities).
  if (drop.length) await prisma.vendor.deleteMany({ where: { id: { in: drop.map((v) => v.id) } } });

  // Delete ALL unknown_vendor flags (open or dismissed) — superseded by the queue.
  const flags = await prisma.transactionFlag.deleteMany({ where: { userId, rule: "unknown_vendor" } });

  const txns = await prisma.plaidTransaction.findMany({
    where: { account: { item: { userId } } },
    select: { name: true, merchantName: true },
  });

  // Convert approved -> V2. priority = decidedAt rank (1..N). ponytail: assumes no
  // other real-priority vendors exist yet (this migration is the first thing run
  // after the V2 deploy, before the user works the queue) — assign a base offset if
  // that ever stops holding.
  for (let i = 0; i < approved.length; i++) {
    const v = approved[i];
    const priority = i + 1;
    if (v.priority !== priority) {
      await prisma.vendor.update({ where: { id: v.id }, data: { priority } });
    }
    const desired = rowsForKey(normalizeStr(v.name), txns);
    if (!sameRows(v.conditions, desired)) {
      await prisma.vendorCondition.deleteMany({ where: { vendorId: v.id } });
      if (desired.length) {
        await prisma.vendorCondition.createMany({
          data: desired.map((r) => ({ vendorId: v.id, ...r })),
        });
      }
    }
  }

  // Materialize vendorId on every posted txn + build the unmatched backlog.
  await rematchUser(userId);
  return { approved: approved.length, dropped: drop.length, flags: flags.count };
}

async function main(): Promise<void> {
  const vendorUsers = await prisma.vendor.findMany({
    where: { status: { not: null } },
    select: { userId: true },
    distinct: ["userId"],
  });
  const flagUsers = await prisma.transactionFlag.findMany({
    where: { rule: "unknown_vendor" },
    select: { userId: true },
    distinct: ["userId"],
  });
  const userIds = [...new Set([...vendorUsers, ...flagUsers].map((u) => u.userId))];

  const totals: MigrateResult = { approved: 0, dropped: 0, flags: 0 };
  for (const userId of userIds) {
    const r = await migrateUser(userId);
    totals.approved += r.approved;
    totals.dropped += r.dropped;
    totals.flags += r.flags;
    console.log(
      `  user ${userId}: converted ${r.approved} approved, dropped ${r.dropped} legacy, deleted ${r.flags} unknown_vendor flag(s)`
    );
  }
  console.log(
    `\nDone. ${userIds.length} user(s): ${totals.approved} approved vendors migrated, ` +
      `${totals.dropped} legacy vendors dropped, ${totals.flags} unknown_vendor flags removed.`
  );
}

// Only run main() when executed as a script — check-migration.ts imports migrateUser.
if (process.argv[1]?.includes("migrate-vendors-v2")) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      console.error(e instanceof Error ? e.message : e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
