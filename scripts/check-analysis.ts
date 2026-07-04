// Analyzer acceptance checks (F1). Asserts the post-analysis DB state produced by
// the demo seed; exits non-zero on any failure. Verifiers rely on this.
//   npm run seed:demo && npm run check:analysis
//   npm run seed:demo -- --phase2 && npm run check:analysis -- --phase2
//
// Expectations are keyed off the seed's stable fixture IDs (seed-demo.ts can't be
// imported — it runs main() on load). Criterion numbers refer to the PRD.
import { prisma } from "../src/lib/db";
import { analyzeUser } from "../src/lib/analysis/analyze";

const USER_ID = "demo-user";
// A flag we dismiss at the end of phase 1 so phase-2 re-analysis can prove
// dismissal permanence (criterion 16). Vendor B's unusual_amount fires in both
// phases and nothing else asserts it, so re-analysis would re-fire it if
// permanence didn't hold.
const DISMISS_TXN = "demo-txn-b-unusual";
const DISMISS_RULE = "unusual_amount";

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
  // unknown_vendor is retired: the analyzer never fires it anywhere (the funnel's
  // unmatched/conflict queue replaces it in F1).
  check(
    (await prisma.transactionFlag.count({ where: { rule: "unknown_vendor" } })) === 0,
    "retired: no unknown_vendor flags exist"
  );

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

  // Criterion 6: a vendor's ≥3× charge is flagged unusual; its below-threshold
  // charge and its refund are not (refund is not a charge, so it neither triggers
  // nor shifts the charges-only median). Approval model is retired — unusual fires
  // for every vendor now.
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

  // Vendor B's ≥3× charge fires unusual_amount too (no approval gate); its
  // identical-$100 priors 2 days apart legitimately fire duplicate_charge.
  // b-unusual is the DISMISS_TXN, so accept open-or-dismissed to stay re-runnable.
  check(!!(await anyFlag("demo-txn-b-unusual", "unusual_amount")), "unusual_amount fires for any vendor (no approval gate)");
  check(!!(await openFlag("demo-txn-b-prior-1", "duplicate_charge")), "Vendor B identical priors flagged duplicate_charge");

  await idempotency();

  // Set up criterion 16: dismiss a flag that phase-2 re-analysis must not reopen.
  await prisma.transactionFlag.updateMany({
    where: { transactionId: DISMISS_TXN, rule: DISMISS_RULE },
    data: { status: "dismissed", resolvedAt: new Date() },
  });
  console.log(`  · dismissed ${DISMISS_RULE} on ${DISMISS_TXN} (criterion 16 setup)`);
}

async function phase2(): Promise<void> {
  // The pending original stays invisible, so the pending→posted pair is NOT a
  // duplicate (and the posted replacement, a lone new charge, carries no flags).
  check(
    !(await anyFlag("demo-txn-pending-posted", "duplicate_charge")),
    "criterion 15: pending->posted pair is NOT flagged as duplicate"
  );
  const pendingFlags = await prisma.transactionFlag.count({
    where: { transactionId: "demo-txn-pending" },
  });
  check(pendingFlags === 0, "criterion 15: pending original still carries no flags");

  // Criterion 16: the flag dismissed before phase 2 stays dismissed.
  const dismissed = await anyFlag(DISMISS_TXN, DISMISS_RULE);
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
