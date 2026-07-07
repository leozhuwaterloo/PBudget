// F12 Review hub acceptance gate. Exercises the read model the page renders
// (src/lib/review.ts) plus the engine behavior behind each row action, against a
// throwaway user in the dev SQLite DB. Deterministic, no network, no dev server.
// Run: npm run check:review
//
// Covers the card's acceptance points:
//  - an unmatched txn appears in the queue (AC1);
//  - "create vendor" from a row removes it AND every other queue row the new vendor
//    matches, with vendorId materialized, without a fresh sync (AC1);
//  - a two-vendor overlap shows a conflict with the priority winner; it cannot be
//    dismissed, only resolved (clears when the overlap is removed);
//  - suspicion tables list and dismiss (permanent);
//  - ALL confirmed merges and ALL splits are browsable, dissolve/unsplit work (AC7);
//  - the counters row reflects open items across every section.
import { prisma } from "../src/lib/db";
import { reviewData, dismissFlag } from "../src/lib/review";
import { createVendor, deleteVendor } from "../src/lib/vendors";
import { rematchUser } from "../src/lib/analysis/match";
import { analyzeUser } from "../src/lib/analysis/analyze";
import { createMergeGroup, dissolveGroup } from "../src/lib/analysis/merge";
import { createSplit, deleteSplit } from "../src/lib/splits";

const USER = "review-test-user";
const ITEM = "rt-item";
const CHQ = "rt-chq";
const SAV = "rt-sav";

// Two txns sharing one merchant → one vendor matches BOTH (queue shrinks past the
// acted-on row); a third with a different merchant stays queued.
const UN_1 = "rt-un-1";
const UN_2 = "rt-un-2";
const UN_OTHER = "rt-un-other";
const CONF = "rt-conf"; // matched by two overlapping vendors → conflict
const DUP_1 = "rt-dup-1"; // same merchant + amount → duplicate_charge
const DUP_2 = "rt-dup-2";
const MERGE_A = "rt-merge-a"; // confirmed merge group (net ≠ 0)
const MERGE_B = "rt-merge-b";
const SPLIT = "rt-split"; // split into 2 parts

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

async function reset(): Promise<void> {
  // Idempotent teardown (order avoids FK blocks; user delete cascades item→acct→txn).
  await prisma.transactionFlag.deleteMany({ where: { userId: USER } });
  await prisma.dissolvedGroupMemo.deleteMany({ where: { userId: USER } });
  await prisma.mergeGroup.deleteMany({ where: { userId: USER } });
  await prisma.transactionSplit.deleteMany({ where: { userId: USER } });
  await prisma.vendor.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });

  await prisma.user.create({ data: { id: USER, email: `${USER}@t.local`, passwordHash: "x" } });
  // Vendors now require a default category; seed one for the fixtures to reference.
  await prisma.transactionCategory.create({ data: { userId: USER, name: "Grocery" } });
  await prisma.plaidInstitution.upsert({
    where: { institutionId: "rt-inst" },
    create: { institutionId: "rt-inst", name: "RT Bank" },
    update: {},
  });
  await prisma.plaidItem.create({
    data: { itemId: ITEM, userId: USER, institutionId: "rt-inst", accessToken: "x", lastForceRefreshed: new Date("2026-01-01") },
  });
  for (const id of [CHQ, SAV]) {
    await prisma.plaidAccount.create({ data: { accountId: id, itemId: ITEM, name: "RT Chq", accountType: "depository" } });
  }
  const txn = (id: string, acct: string, amount: number, name: string, merchant: string, dayISO: string) =>
    prisma.plaidTransaction.create({
      data: {
        transactionId: id, accountId: acct, amount, isoCurrencyCode: "CAD",
        category: JSON.stringify({ primary: "GENERAL_MERCHANDISE" }),
        datetime: new Date(dayISO), name, merchantName: merchant, paymentChannel: "online", pending: false,
      },
    });
  await txn(UN_1, CHQ, 17, "Zqueue purchase one", "Zqueue Alpha", "2026-01-05");
  await txn(UN_2, CHQ, 23, "Zqueue purchase two", "Zqueue Alpha", "2026-01-06");
  await txn(UN_OTHER, CHQ, 31, "Zother purchase", "Zother Co", "2026-01-07");
  await txn(CONF, CHQ, 88, "Zconf Payee", "Zconfm Inc", "2026-01-08");
  await txn(DUP_1, CHQ, 40, "Zdup buy", "Zdup Mart", "2026-01-10");
  await txn(DUP_2, CHQ, 40, "Zdup buy", "Zdup Mart", "2026-01-11");
  await txn(MERGE_A, CHQ, 300, "Zmerge Primary", "Zmerge Co", "2026-01-12");
  await txn(MERGE_B, CHQ, 100, "Zmerge Secondary", "Zmerge Co", "2026-01-12");
  await txn(SPLIT, CHQ, 100, "Zsplit Charge", "Zsplit Store", "2026-01-13");

  // Structure first so rematch treats the group as one effective item.
  await createMergeGroup(USER, [MERGE_A, MERGE_B], { status: "confirmed" });
  await createSplit(USER, SPLIT, [{ amount: 60, label: "a" }, { amount: 40, label: "b" }]);

  // Conflict vendors: high before low so the append-at-end priority makes the
  // NAME vendor (created first) the winner. dup vendor keeps the dup pair matched
  // (so it shows only as duplicate_charge, not also unmatched).
  await createVendor(USER, { name: "rt-conf-high", categoryName: "Grocery", matchConditions: [{ nameOp: "contains", nameValue: "zconf" }] });
  await createVendor(USER, { name: "rt-conf-low", categoryName: "Grocery", matchConditions: [{ merchantOp: "contains", merchantValue: "zconfm" }] });
  await createVendor(USER, { name: "rt-dup-vendor", categoryName: "Grocery", matchConditions: [{ merchantOp: "contains", merchantValue: "Zdup Mart" }] });

  await analyzeUser(USER); // fires suspicion + final rematch (builds the queues)
}

async function main(): Promise<void> {
  console.log("\nChecking F12 Review hub:");
  await reset();

  // --- Initial payload -----------------------------------------------------
  let data = await reviewData(USER);
  const findUn = (id: string) => data.unmatched.find((r) => r.id === id);
  check(!!findUn(UN_1) && !!findUn(UN_2), "unmatched queue lists the two Zqueue transactions (AC1)");
  check(!!findUn(UN_OTHER), "unmatched queue lists the unrelated Zother transaction");
  check(
    findUn(UN_1)?.merchantName === "Zqueue Alpha",
    "unmatched row carries the merchant name for pre-fill (merchantName ?? name key)"
  );
  check(
    !!findUn(UN_1)?.accountId && findUn(UN_1)?.paymentChannel === "online",
    "unmatched row carries account + payment channel for the Review detail card"
  );

  // --- Server-side pagination + search over the unmatched queue ------------
  const paged = await reviewData(USER, { page: 0 });
  check(
    paged.unmatchedTotal === data.unmatched.length && paged.unmatched.length <= paged.unmatchedPageSize,
    "pagination: page 0 reports the full total and returns at most pageSize rows"
  );
  const searched = await reviewData(USER, { q: "zother" }); // case-insensitive over merchant/name/title
  check(
    searched.unmatchedTotal === 1 && !!searched.unmatched.find((r) => r.id === UN_OTHER),
    "search: a query narrows the unmatched queue to the matching merchant"
  );
  check(
    (await reviewData(USER, { q: "no-such-merchant-zzz" })).unmatchedTotal === 0,
    "search: a non-matching query yields an empty unmatched page"
  );

  const conflict = data.conflicts.find((c) => c.id === CONF);
  const confHigh = await prisma.vendor.findFirst({ where: { userId: USER, name: "rt-conf-high" } });
  check(!!conflict, "conflicts section shows the two-vendor overlap");
  check(conflict?.vendors.length === 2, "conflict lists EVERY matching vendor (2)");
  check(conflict?.winnerVendorId === confHigh?.id, "conflict names the priority winner (the higher-priority name vendor)");

  check((data.suspicion["duplicate_charge"] ?? []).length === 2, "suspicion: both duplicate_charge rows listed");

  check(data.mergeGroups.length === 1 && data.mergeGroups[0].legs.length === 2, "merges & splits: the confirmed group is browsable (AC7)");
  check(data.splits.length === 1 && data.splits[0].parts.length === 2, "merges & splits: the split is browsable (AC7)");

  // --- G5: split eligibility on Review rows (FR5) --------------------------
  // A Split action is offered only on transaction rows whose txn is posted,
  // ungrouped and unsplit; group-backed and already-split rows are not eligible.
  check(findUn(UN_OTHER)?.eligibleForSplit === true, "G5: an ungrouped, unsplit unmatched row is split-eligible");
  check(findUn(SPLIT)?.eligibleForSplit === false, "G5: an already-split parent row is NOT split-eligible");
  const unGroupRow = data.unmatched.find((r) => r.level === "group");
  check(!!unGroupRow && unGroupRow.eligibleForSplit === false, "G5: a merge-group-backed row is NOT split-eligible");
  check(
    (data.suspicion["duplicate_charge"] ?? []).length > 0 &&
      (data.suspicion["duplicate_charge"] ?? []).every((e) => e.eligibleForSplit === true),
    "G5: ungrouped suspicion (duplicate_charge) rows are split-eligible"
  );

  const openTotal =
    data.unmatched.length + data.conflicts.length +
    Object.values(data.suspicion).reduce((n, xs) => n + xs.length, 0) + data.pendingGroups.length;
  check(data.counters.totalOpen === openTotal, "counters.totalOpen spans open items across every section");
  const startTotal = data.counters.totalOpen;

  // --- G2: unmatched_vendor items have NO dismiss --------------------------
  // The dismiss route calls dismissFlag; unmatched_vendor must be rejected and
  // stay open, or the txn silently leaves the queue (setQueueFlag never reopens
  // a dismissed flag) and the match-or-queue invariant breaks.
  const unFlagId = findUn(UN_OTHER)!.flagId;
  const guarded = await dismissFlag(USER, unFlagId);
  check(guarded === "forbidden", "G2: dismissing an unmatched_vendor flag is rejected (route → 4xx)");
  const unFlag = await prisma.transactionFlag.findUnique({ where: { id: unFlagId } });
  check(unFlag?.status === "open", "G2: the rejected unmatched_vendor flag remains status=open");
  data = await reviewData(USER);
  check(!!findUn(UN_OTHER), "G2: it still shows in the unmatched queue (only matching a vendor clears it)");

  // --- AC1: create a vendor from an unmatched row --------------------------
  // The UI POSTs /api/vendors with an equals condition on the row's merchant; the
  // create rematches. Both Zqueue rows must leave the queue; Zother must remain.
  await createVendor(USER, { name: "Zqueue Alpha", categoryName: "Grocery", matchConditions: [{ merchantOp: "contains", merchantValue: "Zqueue Alpha" }] });
  const newVendor = await prisma.vendor.findFirst({ where: { userId: USER, name: "Zqueue Alpha" } });
  data = await reviewData(USER);
  check(!data.unmatched.find((r) => r.id === UN_1) && !data.unmatched.find((r) => r.id === UN_2), "AC1: BOTH Zqueue rows removed from the queue — it shrank past the acted-on row");
  check(!!data.unmatched.find((r) => r.id === UN_OTHER), "AC1: the unrelated row is untouched (queue shrinks only by matches)");
  const un1 = await prisma.plaidTransaction.findUnique({ where: { transactionId: UN_1 } });
  const un2 = await prisma.plaidTransaction.findUnique({ where: { transactionId: UN_2 } });
  check(un1?.vendorId === newVendor?.id && un2?.vendorId === newVendor?.id, "AC1: vendorId materialized on both, without a fresh sync");
  check(data.counters.totalOpen === startTotal - 2, "AC1: counters dropped by exactly the two closed items");

  // --- Conflicts cannot be dismissed — only resolved -----------------------
  // A conflict is a queue flag: like unmatched_vendor it clears ONLY by resolution
  // (removing the overlap so a single vendor wins), never by a manual dismiss.
  const confFlagId = conflict!.flagId;
  const guardedConf = await dismissFlag(USER, confFlagId); // same seam the route uses
  check(guardedConf === "forbidden", "conflict dismiss is rejected (route → 4xx) — conflicts are resolve-only");
  const confFlag = await prisma.transactionFlag.findUnique({ where: { id: confFlagId } });
  check(confFlag?.status === "open", "the rejected conflict flag remains status=open");
  data = await reviewData(USER);
  check(!!data.conflicts.find((c) => c.id === CONF), "the conflict still shows — a rejected dismiss does not hide it");

  // Resolving the overlap (drop one of the two matching vendors) + a full re-match
  // — the "Re-match all" the user runs — clears it. (Incremental rematch after the
  // non-winning delete leaves the winner-owned txn untouched, so it takes the full pass.)
  const confLow = await prisma.vendor.findFirst({ where: { userId: USER, name: "rt-conf-low" } });
  await deleteVendor(USER, confLow!.id);
  await rematchUser(USER);
  data = await reviewData(USER);
  check(!data.conflicts.find((c) => c.id === CONF), "conflict clears once only one vendor matches (resolved, not dismissed)");
  const confTxn = await prisma.plaidTransaction.findUnique({ where: { transactionId: CONF } });
  check(confTxn?.vendorId === confHigh?.id, "the surviving vendor keeps the txn after the overlap is removed");

  // --- Suspicion dismiss ---------------------------------------------------
  const dupFlag = (data.suspicion["duplicate_charge"] ?? [])[0];
  const okDup = await dismissFlag(USER, dupFlag.flagId); // guarded path allows suspicion rules
  check(okDup === "ok", "suspicion dismiss via the guarded path succeeds");
  await analyzeUser(USER); // re-analyze must not reopen a dismissed suspicion flag
  data = await reviewData(USER);
  check((data.suspicion["duplicate_charge"] ?? []).length === 1, "suspicion: dismissed duplicate stays dismissed after re-analyze");

  // --- Merge dissolve + split unsplit (AC7) --------------------------------
  await dissolveGroup(USER, data.mergeGroups[0].id);
  data = await reviewData(USER);
  check(data.mergeGroups.length === 0, "AC7: dissolve removes the confirmed group");

  await deleteSplit(USER, SPLIT);
  data = await reviewData(USER);
  check(data.splits.length === 0, "AC7: unsplit removes the split");

  // Teardown: leave the shared dev DB clean.
  await prisma.transactionFlag.deleteMany({ where: { userId: USER } });
  await prisma.mergeGroup.deleteMany({ where: { userId: USER } });
  await prisma.transactionSplit.deleteMany({ where: { userId: USER } });
  await prisma.vendor.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });

  console.log(failures ? `\n✗ ${failures} check(s) failed\n` : "\n✓ all review checks passed\n");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
