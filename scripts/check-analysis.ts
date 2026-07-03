// Analyzer acceptance checks (F1). Asserts the post-analysis DB state produced by
// the demo seed; exits non-zero on any failure. Verifiers rely on this.
//   npm run seed:demo && npm run check:analysis
//   npm run seed:demo -- --phase2 && npm run check:analysis -- --phase2
//
// Expectations are keyed off the seed's stable fixture IDs (seed-demo.ts can't be
// imported — it runs main() on load). Criterion numbers refer to the PRD.
import { prisma } from "../src/lib/db";
import { analyzeUser } from "../src/lib/analysis/analyze";
import { normalizeVendor } from "../src/lib/analysis/vendor";

const USER_ID = "demo-user";
// A flag we dismiss at the end of phase 1 so phase-2 re-analysis can prove
// dismissal permanence (criterion 16). Book Nook is untouched by phase 2.
const DISMISS_TXN = "demo-txn-unknown-books";

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

const openFlag = (transactionId: string, rule: string) =>
  prisma.transactionFlag.findFirst({ where: { transactionId, rule, status: "open" } });
const anyFlag = (transactionId: string, rule: string) =>
  prisma.transactionFlag.findFirst({ where: { transactionId, rule } });

async function phase1(): Promise<void> {
  const posted = await prisma.plaidTransaction.findMany({
    where: { pending: false, account: { item: { userId: USER_ID } } },
  });
  const legIds = new Set(
    (await prisma.mergeGroupLeg.findMany({ select: { transactionId: true } })).map(
      (l) => l.transactionId
    )
  );
  const approvedVendors = new Set(
    (await prisma.vendor.findMany({ where: { userId: USER_ID, status: "approved" } })).map(
      (v) => v.name
    )
  );

  // Criterion 1: every posted non-leg txn from a never-approved vendor is flagged.
  for (const t of posted) {
    if (legIds.has(t.transactionId)) continue;
    // This check dismisses DISMISS_TXN at the end (criterion-16 setup), so accept
    // open-or-dismissed for it — keeps the check safely re-runnable.
    if (t.transactionId === DISMISS_TXN) continue;
    const vendor = normalizeVendor(t.merchantName, t.name);
    if (approvedVendors.has(vendor)) continue;
    check(
      !!(await openFlag(t.transactionId, "unknown_vendor")),
      `criterion 1: open unknown_vendor on ${t.transactionId} (${vendor})`
    );
  }
  // Book Nook itself must be flagged (open on first run, or dismissed after a
  // re-run) — assert it's accounted for without requiring a specific status.
  check(!!(await anyFlag(DISMISS_TXN, "unknown_vendor")), `criterion 1: unknown_vendor on ${DISMISS_TXN}`);

  // Criterion 4 (first half): e-transfer pair became one auto net-0 group titled
  // from the outflow leg; neither leg carries an open flag.
  const leg = await prisma.mergeGroupLeg.findUnique({
    where: { transactionId: "demo-txn-etransfer-out" },
  });
  const group = leg
    ? await prisma.mergeGroup.findUnique({ where: { id: leg.groupId }, include: { legs: true } })
    : null;
  check(!!group && group.status === "auto", "criterion 4: e-transfer pair -> one auto MergeGroup");
  check(!!group && Number(group.netAmount) === 0, "criterion 4: auto group netAmount is 0");
  check(!!group && group.title === "E-Transfer sent", "criterion 4: title from the outflow leg");
  check(
    !!group &&
      group.legs.length === 2 &&
      group.legs.some((l) => l.transactionId === "demo-txn-etransfer-in"),
    "criterion 4: both e-transfer legs are in the group"
  );
  const legOpen = await prisma.transactionFlag.count({
    where: {
      transactionId: { in: ["demo-txn-etransfer-out", "demo-txn-etransfer-in"] },
      status: "open",
    },
  });
  check(legOpen === 0, "criterion 4: neither e-transfer leg carries an open flag");

  // Criteria 5 + 14 precondition: lone transfer-out and both 6-day-apart transfers
  // carry open unmatched_transfer flags.
  for (const id of ["demo-txn-lone-transfer", "demo-txn-unmatched-out", "demo-txn-unmatched-in"]) {
    check(!!(await openFlag(id, "unmatched_transfer")), `criterion 5/14: unmatched_transfer on ${id}`);
  }

  // Criterion 6: pre-approved vendor's ≥3× charge is flagged unusual; its
  // below-threshold charge and its refund are not (refund is not a charge, so it
  // neither triggers nor shifts the charges-only median).
  check(
    !!(await openFlag("demo-txn-a-unusual", "unusual_amount")),
    "criterion 6: Vendor A >=3x charge has open unusual_amount"
  );
  check(
    !(await anyFlag("demo-txn-a-normal", "unusual_amount")),
    "criterion 6: Vendor A below-threshold charge has NO unusual_amount"
  );
  check(
    !(await anyFlag("demo-txn-a-refund", "unusual_amount")),
    "criterion 6: Vendor A refund has NO unusual_amount"
  );

  // Criterion 7: same-vendor same-amount charges 1 day apart both flagged.
  check(!!(await openFlag("demo-txn-dup-1", "duplicate_charge")), "criterion 7: dup-1 duplicate_charge");
  check(!!(await openFlag("demo-txn-dup-2", "duplicate_charge")), "criterion 7: dup-2 duplicate_charge");

  // Criterion 15 (first half): the pending fixture txn has no flags.
  const pendingFlags = await prisma.transactionFlag.count({
    where: { transactionId: "demo-txn-pending" },
  });
  check(pendingFlags === 0, "criterion 15: pending fixture txn carries no flags");

  // Criterion 19 (first half): the pending vendor's txns carry unknown_vendor but
  // NO unusual_amount (unusual only fires on approved vendors).
  // Note: the fixture's Vendor B priors are three identical $100 charges 2 days
  // apart, so duplicate_charge legitimately also fires on them — we assert the
  // substantive guarantee (no unusual_amount pre-approval), not literal exclusivity.
  for (const id of ["demo-txn-b-prior-1", "demo-txn-b-prior-2", "demo-txn-b-prior-3", "demo-txn-b-unusual"]) {
    check(!(await anyFlag(id, "unusual_amount")), `criterion 19: no unusual_amount on ${id} (unapproved)`);
    check(!!(await openFlag(id, "unknown_vendor")), `criterion 19: unknown_vendor on ${id}`);
  }

  await idempotency();

  // Set up criterion 16: dismiss a flag that phase-2 re-analysis must not reopen.
  await prisma.transactionFlag.updateMany({
    where: { transactionId: DISMISS_TXN, rule: "unknown_vendor" },
    data: { status: "dismissed", resolvedAt: new Date() },
  });
  console.log(`  · dismissed unknown_vendor on ${DISMISS_TXN} (criterion 16 setup)`);
}

async function phase2(): Promise<void> {
  // Posted replacement of the pending txn is flagged per its (unknown) vendor.
  check(
    !!(await openFlag("demo-txn-pending-posted", "unknown_vendor")),
    "criterion 15: posted replacement is flagged unknown_vendor"
  );
  // The pending original stays invisible, so the pending→posted pair is NOT a duplicate.
  check(
    !(await anyFlag("demo-txn-pending-posted", "duplicate_charge")),
    "criterion 15: pending->posted pair is NOT flagged as duplicate"
  );
  const pendingFlags = await prisma.transactionFlag.count({
    where: { transactionId: "demo-txn-pending" },
  });
  check(pendingFlags === 0, "criterion 15: pending original still carries no flags");

  // Criterion 16: the flag dismissed before phase 2 stays dismissed.
  const dismissed = await anyFlag(DISMISS_TXN, "unknown_vendor");
  check(
    !!dismissed && dismissed.status === "dismissed",
    "criterion 16: dismissed flag stays dismissed after re-analysis"
  );

  await idempotency();
}

// Re-running analyzeUser over unchanged data must create no new flags/groups/legs.
async function idempotency(): Promise<void> {
  const snap = async () => ({
    flags: await prisma.transactionFlag.count(),
    groups: await prisma.mergeGroup.count(),
    legs: await prisma.mergeGroupLeg.count(),
  });
  const before = await snap();
  await analyzeUser(USER_ID);
  const after = await snap();
  check(
    before.flags === after.flags && before.groups === after.groups && before.legs === after.legs,
    "idempotent: re-running analyzeUser creates no new flags/groups/legs"
  );
}

async function main(): Promise<void> {
  const isPhase2 = process.argv.includes("--phase2");
  console.log(`\nChecking analyzer output${isPhase2 ? " (phase 2)" : ""}:`);
  if (isPhase2) await phase2();
  else await phase1();
  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED\n`);
    process.exit(1);
  }
  console.log("\nAll analyzer checks passed.\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
