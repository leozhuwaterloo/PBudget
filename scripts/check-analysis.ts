// Analyzer acceptance checks (F1). Asserts the post-analysis DB state produced by
// the demo seed; exits non-zero on any failure. Verifiers rely on this.
//   npm run seed:demo && npm run check:analysis
//   npm run seed:demo -- --phase2 && npm run check:analysis -- --phase2
//
// Expectations are keyed off the seed's stable fixture IDs (seed-demo.ts can't be
// imported — it runs main() on load). Criterion numbers refer to the PRD.
import { prisma } from "../src/lib/db";
import { analyzeUser } from "../src/lib/analysis/analyze";
import { rematchUser } from "../src/lib/analysis/match";
import { effectiveTransactions } from "../src/lib/analysis/effective";
import { limitFor, canAddConnection, canSyncItem } from "../src/lib/stripe";

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
const groupFlag = (mergeGroupId: string, rule: string, status?: string) =>
  prisma.transactionFlag.findFirst({ where: { mergeGroupId, rule, ...(status ? { status } : {}) } });
const vendorByName = (name: string) =>
  prisma.vendor.findFirst({ where: { userId: USER_ID, name } });
const vendorIdOf = async (transactionId: string): Promise<string | null> =>
  (await prisma.plaidTransaction.findUnique({ where: { transactionId } }))?.vendorId ?? null;

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

  await vendorMatching();

  await f2Categorization();

  await tierLimit();

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

// F1 vendor matching engine + queue rules (task point 4). Mutates vendors and
// re-runs rematchUser to exercise the conflict/unmatched lifecycles; runs on a
// fresh seed before the idempotency snapshot.
async function vendorMatching(): Promise<void> {
  // Every operator both includes (HIT gets the vendorId) and excludes (MISS stays
  // unmatched). Covers contains/equals/starts_with/regex on name and merchant,
  // amount range, account, payment channel, and Plaid primary/detailed.
  const PROBES: [string, string, string][] = [
    ["probe-name-contains", "f1-name-contains-hit", "f1-name-contains-miss"],
    ["probe-name-equals", "f1-name-equals-hit", "f1-name-equals-miss"],
    ["probe-name-starts", "f1-name-starts-hit", "f1-name-starts-miss"],
    ["probe-name-regex", "f1-name-regex-hit", "f1-name-regex-miss"],
    ["probe-merch-contains", "f1-merch-contains-hit", "f1-merch-contains-miss"],
    ["probe-merch-regex", "f1-merch-regex-hit", "f1-merch-regex-miss"],
    ["probe-amount", "f1-amount-hit", "f1-amount-miss"],
    ["probe-account", "f1-account-hit", "f1-account-miss"],
    ["probe-channel", "f1-channel-hit", "f1-channel-miss"],
    ["probe-primary", "f1-primary-hit", "f1-primary-miss"],
    ["probe-detailed", "f1-detailed-hit", "f1-detailed-miss"],
  ];
  for (const [vname, hit, miss] of PROBES) {
    const v = await vendorByName(vname);
    check(!!v && (await vendorIdOf(hit)) === v.id, `operator ${vname}: HIT is matched`);
    check((await vendorIdOf(miss)) === null, `operator ${vname}: MISS is excluded`);
  }

  // Multi-match: priority winner assigned + vendor_conflict opens; reorder flips
  // the winner; removing the overlap auto-closes the conflict (criterion 2).
  const confHigh = (await vendorByName("conf-high"))!;
  const confLow = (await vendorByName("conf-low"))!;
  check((await vendorIdOf("f1-conflict")) === confHigh.id, "conflict: priority winner (conf-high) assigned");
  check(!!(await openFlag("f1-conflict", "vendor_conflict")), "conflict: vendor_conflict opens on multi-match");

  // Flip priorities 10<->20 (temp value dodges the @@unique([userId, priority])).
  await prisma.vendor.update({ where: { id: confHigh.id }, data: { priority: 100000 } });
  await prisma.vendor.update({ where: { id: confLow.id }, data: { priority: 10 } });
  await prisma.vendor.update({ where: { id: confHigh.id }, data: { priority: 20 } });
  await rematchUser(USER_ID);
  check((await vendorIdOf("f1-conflict")) === confLow.id, "conflict: reorder flips the winner to conf-low");
  check(!!(await openFlag("f1-conflict", "vendor_conflict")), "conflict: still open while both vendors overlap");

  // Break the overlap: conf-low no longer matches → conflict auto-closes.
  await prisma.vendorCondition.updateMany({ where: { vendorId: confLow.id }, data: { merchantValue: "zzz-no-overlap" } });
  await rematchUser(USER_ID);
  check((await vendorIdOf("f1-conflict")) === confHigh.id, "conflict: only conf-high matches after overlap removed");
  const conf = await anyFlag("f1-conflict", "vendor_conflict");
  check(!!conf && conf.status === "resolved", "conflict: vendor_conflict auto-closes when overlap gone");

  // unmatched_vendor opens for a no-match txn and auto-closes once a vendor matches
  // (criterion 1). No fresh sync — just rematch.
  check((await vendorIdOf("f1-unmatch")) === null, "unmatched: f1-unmatch matches no vendor initially");
  check(!!(await openFlag("f1-unmatch", "unmatched_vendor")), "unmatched: unmatched_vendor opens for a no-match txn");
  const closer = await prisma.vendor.create({
    data: {
      userId: USER_ID, name: "unmatch-closer", priority: 300,
      conditions: { create: [{ order: 0, nameOp: "contains", nameValue: "zunmatch" }] },
    },
  });
  await rematchUser(USER_ID);
  check((await vendorIdOf("f1-unmatch")) === closer.id, "unmatched: a matching vendor claims f1-unmatch");
  const um = await anyFlag("f1-unmatch", "unmatched_vendor");
  check(!!um && um.status === "resolved", "unmatched: unmatched_vendor auto-closes on match");

  // A net-≠0 group queues via its GROUP (not its legs); a net-0 group never queues.
  const gLeg = await prisma.mergeGroupLeg.findUnique({ where: { transactionId: "f1-group-primary" } });
  const grp = gLeg ? await prisma.mergeGroup.findUnique({ where: { id: gLeg.groupId } }) : null;
  check(!!grp && Number(grp.netAmount) === 400, "group: manual merge nets +400 (≠0)");
  check(!!grp && !!(await groupFlag(grp.id, "unmatched_vendor", "open")), "group: net-≠0 group queues unmatched_vendor");
  const legQueued = await prisma.transactionFlag.count({
    where: { transactionId: { in: ["f1-group-primary", "f1-group-secondary"] }, rule: "unmatched_vendor" },
  });
  check(legQueued === 0, "group: grouped legs themselves never queue");

  const eLeg = await prisma.mergeGroupLeg.findUnique({ where: { transactionId: "demo-txn-etransfer-out" } });
  const eGrp = eLeg ? await prisma.mergeGroup.findUnique({ where: { id: eLeg.groupId } }) : null;
  check(!!eGrp && Number(eGrp.netAmount) === 0, "group: e-transfer group is net-0");
  check(!!eGrp && !(await groupFlag(eGrp.id, "unmatched_vendor")), "group: net-0 group never queues");

  // rematchUser is idempotent: re-running changes no vendorId or queue flag.
  const snap = async () =>
    JSON.stringify({
      txns: await prisma.plaidTransaction.findMany({
        where: { account: { item: { userId: USER_ID } } },
        select: { transactionId: true, vendorId: true },
        orderBy: { transactionId: "asc" },
      }),
      flags: await prisma.transactionFlag.findMany({
        where: { rule: { in: ["unmatched_vendor", "vendor_conflict"] } },
        select: { rule: true, transactionId: true, mergeGroupId: true, status: true },
        orderBy: [{ rule: "asc" }, { transactionId: "asc" }, { mergeGroupId: "asc" }],
      }),
    });
  const before = await snap();
  await rematchUser(USER_ID);
  check(before === (await snap()), "idempotent: re-running rematchUser changes no vendorId/queue flag");
}

// F2 read-time category waterfall + split-/vendor-aware effective model (point 4).
// Reads through effectiveTransactions (the shared read contract) so this asserts the
// real integration, not the resolver in isolation.
async function f2Categorization(): Promise<void> {
  const eff = await effectiveTransactions(USER_ID);
  const byId = new Map(eff.map((e) => [e.id, e]));
  const cat = (id: string) => byId.get(id)?.categoryName ?? null;

  // Per-row routing: ONE vendor, two rows, two categories; first matching row wins
  // (a txn matching both rows takes row 0; later rows are never consulted).
  check(cat("f2-router-alpha") === "Grocery", "point 4: vendor row 0 routes alpha → Grocery");
  check(cat("f2-router-beta") === "Restaurant", "point 4: vendor row 1 routes beta → Restaurant");
  check(cat("f2-router-both") === "Grocery", "point 4: first matching row wins (later rows never consulted)");

  // Fallback chain: matching row w/o a category → vendor default → CategoryMapping →
  // humanized Plaid primary, each level exercised when the ones above are unset.
  check(cat("f2-vdefault-hit") === "Pet", "point 4: matching row w/o category → vendor default");
  check(cat("f2-mapping-hit") === "Utility", "point 4: no row/vendor category → CategoryMapping");
  check(cat("f2-humanized-hit") === "Bank Fees", "point 4: nothing set → humanized Plaid primary");

  // Vendor identity: matched → display name + id; unmatched → normalized-string fallback.
  const alpha = byId.get("f2-router-alpha");
  check(!!alpha && alpha.vendorName === "f2-router" && alpha.vendorId != null,
    "point 4: matched txn exposes vendor display name + id");
  const books = byId.get("demo-txn-unknown-books");
  check(!!books && books.vendorId === null && books.vendorName === "book nook",
    "point 4: unmatched txn falls back to the normalized string");

  // Split: parent is REPLACED by its parts (parent absent); the override is honored;
  // the un-overridden part follows the parent's LIVE waterfall (vendor category
  // Travel); both parts inherit the parent's vendor (name + icon).
  check(!byId.has("f2-split-parent"), "point 4: split parent is absent from effective output");
  const parts = eff.filter((e) => e.parentId === "f2-split-parent");
  check(parts.length === 2, "point 4: split parent replaced by its 2 parts");
  const overridden = parts.find((p) => p.amount === 100);
  const inherited = parts.find((p) => p.amount === 200);
  check(!!overridden && overridden.categoryName === "Grocery", "point 4: split part override honored (Grocery)");
  check(!!inherited && inherited.categoryName === "Travel", "point 4: un-overridden part follows parent's live resolution (Travel)");
  const splitVendor = (await vendorByName("f2-split-vendor"))!;
  check(
    parts.length === 2 && parts.every((p) => p.vendorId === splitVendor.id && p.vendorName === "f2-split-vendor" && p.vendorIcon === "airplane"),
    "point 4: split parts inherit the parent's vendor (name + icon)"
  );
  check(!!overridden && overridden.title.includes("groceries"), "point 4: split part title = parent title + label");

  // Suspicion rules evaluate the split parent WHOLE: parent(300) + same-vendor twin(300)
  // 1 day apart both fire duplicate_charge (parts 100/200 would never match).
  check(!!(await openFlag("f2-split-parent", "duplicate_charge")), "point 4: analyzer flags the split parent WHOLE (duplicate_charge)");
  check(!!(await openFlag("f2-split-dup", "duplicate_charge")), "point 4: the split parent's same-amount twin is also flagged");
}

// FR10 tier connection limit (AC14). The demo user is on Free (limit 1) with TWO
// seeded connections, so it is over the limit: the oldest keeps syncing, the newer is
// read-only, and no new connection can be added until an upgrade lifts the gate.
async function tierLimit(): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });
  check(user.plan === "free" && limitFor("free") === 1, "tier: demo user is Free (limit 1 connection)");

  const add = await canAddConnection(user);
  check(!add.ok && add.used === 2, "tier: Free at its limit blocks a new connection");
  const oldest = await canSyncItem(user, "demo-item");
  check(oldest.ok, "tier: the oldest connection keeps syncing");
  const excess = await canSyncItem(user, "demo-item-2");
  check(!excess.ok && excess.used === 2, "tier: the over-limit 2nd connection is read-only");

  // Upgrade to Pro (limit 5) lifts the gate; restore Free so the check is re-runnable.
  await prisma.user.update({ where: { id: USER_ID }, data: { plan: "pro" } });
  const pro = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });
  check((await canSyncItem(pro, "demo-item-2")).ok, "tier: Pro lifts read-only on the 2nd connection");
  check((await canAddConnection(pro)).ok, "tier: Pro (limit 5) may add more connections");
  await prisma.user.update({ where: { id: USER_ID }, data: { plan: "free" } });
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
