// Single analyzer entry point (SPEC "Analyzer semantics", FR1/FR3/FR4). Called
// from the demo seed and from the sync route after upserts. Deterministic and
// idempotent: re-running over unchanged data changes no flags or groups.
import type { PlaidTransaction } from "@prisma/client";
import { prisma } from "../db";
import { normalizeVendor, isTransferLike } from "./vendor";
import { ignoredTxnIds } from "../categories";
import { createMergeGroup } from "./merge";
import { rematchUser } from "./match";
import { primaryLeg } from "./groups";
import { splitParentIds } from "../splits";
import {
  ANALYSIS_WINDOW_DAYS,
  AUTOMATCH_WINDOW_DAYS,
  DUPLICATE_WINDOW_DAYS,
  UNUSUAL_MIN_PRIORS,
  UNUSUAL_MULTIPLIER,
  RULES,
} from "./constants";

const DAY = 86400000;
// Amounts compared in integer cents so float dust never breaks equality/sign.
const cents = (x: unknown): number => Math.round(Number(x) * 100);
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export async function analyzeUser(userId: string): Promise<void> {
  // 1. Scope: the user's POSTED transactions in the last ANALYSIS_WINDOW_DAYS
  //    (FR1 exemption d). Pending rows are invisible until they post; older-than-
  //    window rows are ignored so stale history doesn't churn the queue.
  const since = new Date(Date.now() - ANALYSIS_WINDOW_DAYS * DAY);
  const posted = await prisma.plaidTransaction.findMany({
    where: { pending: false, datetime: { gte: since }, account: { item: { userId } } },
  });

  // 2. Auto-match opposite-sign equal-amount pairs (any account) into net-0 groups.
  //    Ignored txns (routed to the Ignore category by a vendor rule) never auto-merge.
  //    ponytail: keys on the vendorId materialized by the PREVIOUS rematch (this runs
  //    before step 3), so a txn ignored for the first time this sync is excluded on the
  //    next run — reviewData hides any interim auto group in the meantime.
  const vendors = await prisma.vendor.findMany({ where: { userId }, include: { conditions: true } });
  const ignored = ignoredTxnIds(posted, vendors);
  await autoMatch(userId, posted, ignored);

  // 3. Vendor match (FR1): materialize vendorId on every posted txn + maintain the
  //    unmatched_vendor / vendor_conflict queue flags. Runs after auto-match so a
  //    group's queueing keys on its (now grouped) primary leg.
  await rematchUser(userId);

  // 4. Suspicion rules over effective items + flag upsert invariant. Vendor
  //    identity is vendorId (fallback: normalized string for unmatched txns).
  const items = await buildEffectiveItems(userId, since);
  for (const it of items) {
    // unmatched_transfer — transfer-like individual txn (never on groups).
    if (it.isTxn && it.transferLike) await fire(userId, RULES.unmatchedTransfer, it.target);
    // duplicate_charge — same vendor + same signed amount within the window.
    if (hasDuplicate(it, items)) await fire(userId, RULES.duplicateCharge, it.target);
  }
  // unusual_amount — charges only, ≥3 priors (approval model gone: every vendor).
  await applyUnusualAmount(userId, items);
}

// --- Effective items --------------------------------------------------------

type Item = {
  target: { transactionId: string } | { mergeGroupId: string };
  vendor: string;
  amount: number; // signed cents (Plaid convention: + = outflow/charge)
  date: Date;
  transferLike: boolean; // meaningful only for txns; groups never fire rule 5.2
  isTxn: boolean;
};

// Vendor identity for the suspicion rules (FR1): the materialized vendorId when a
// vendor matched, else the normalized string. Namespaced so a cuid can never
// collide with a normalized name across the two identity spaces.
const vendorIdentity = (vendorId: string | null, normalized: string): string =>
  vendorId ? `v:${vendorId}` : `n:${normalized}`;

// Ungrouped posted txns + net-≠0 groups (at their net, under the group vendor).
// Net-0 groups and all group legs are exempt from every rule.
async function buildEffectiveItems(userId: string, since: Date): Promise<Item[]> {
  const posted = await prisma.plaidTransaction.findMany({
    where: { pending: false, datetime: { gte: since }, account: { item: { userId } } },
  });
  const groups = await prisma.mergeGroup.findMany({
    where: { userId },
    include: { legs: true },
  });
  const legIds = new Set(groups.flatMap((g) => g.legs.map((l) => l.transactionId)));
  const postedById = new Map(posted.map((t) => [t.transactionId, t]));

  const items: Item[] = [];
  for (const t of posted) {
    if (legIds.has(t.transactionId)) continue; // legs are represented by their group
    items.push({
      target: { transactionId: t.transactionId },
      vendor: vendorIdentity(t.vendorId, normalizeVendor(t.merchantName, t.name)),
      amount: cents(t.amount),
      date: t.datetime,
      transferLike: isTransferLike(t),
      isTxn: true,
    });
  }
  for (const g of groups) {
    if (cents(g.netAmount) === 0) continue; // net-0 self-transfer is accounted for
    const legs = g.legs
      .map((l) => postedById.get(l.transactionId))
      .filter((t): t is PlaidTransaction => !!t);
    const primary = legs.length ? primaryLeg(legs) : null;
    items.push({
      target: { mergeGroupId: g.id },
      vendor: vendorIdentity(primary?.vendorId ?? null, g.vendorName ?? ""),
      amount: cents(g.netAmount),
      date: g.date,
      transferLike: false,
      isTxn: false,
    });
  }
  return items;
}

// --- Auto-match (FR3) -------------------------------------------------------

async function autoMatch(userId: string, posted: PlaidTransaction[], ignored: Set<string>): Promise<void> {
  const grouped = new Set(
    (await prisma.mergeGroupLeg.findMany({ select: { transactionId: true } })).map(
      (l) => l.transactionId
    )
  );
  const memo = new Set(
    (await prisma.dissolvedGroupMemo.findMany({ where: { userId } })).map((m) => m.legKey)
  );
  // Split parents can never be merged (FR5 merge/split mutual exclusion), so they
  // never enter the auto-match pool.
  const splitParents = await splitParentIds(userId);
  const cands = posted.filter(
    (t) => !grouped.has(t.transactionId) && !splitParents.has(t.transactionId) && !ignored.has(t.transactionId)
  );

  type Pair = { a: string; b: string; dist: number; key: string };
  const pairs: Pair[] = [];
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const a = cands[i];
      const b = cands[j];
      const ca = cents(a.amount);
      const cb = cents(b.amount);
      if (ca === 0 || ca !== -cb) continue; // opposite sign AND equal |amount|
      // Same-account pairs are allowed too: a send + its reclaim/cancel is a
      // same-account net-0 round-trip worth merging (a rare unrelated charge +
      // equal refund just surfaces as a pending suggestion to dismiss).
      if (a.isoCurrencyCode !== b.isoCurrencyCode) continue; // same currency
      const dist = Math.abs(a.datetime.getTime() - b.datetime.getTime());
      if (dist > AUTOMATCH_WINDOW_DAYS * DAY) continue; // within 4 days
      const key = [a.transactionId, b.transactionId].sort().join("|");
      if (memo.has(key)) continue; // a dissolve is remembered — never re-auto-match
      pairs.push({ a: a.transactionId, b: b.transactionId, dist, key });
    }
  }
  // Nearest-by-date wins when a txn has several candidates; deterministic
  // tie-break by sorted-leg key. Greedy consume so each leg pairs at most once.
  pairs.sort((x, y) => x.dist - y.dist || (x.key < y.key ? -1 : 1));
  const used = new Set<string>();
  for (const p of pairs) {
    if (used.has(p.a) || used.has(p.b)) continue;
    used.add(p.a);
    used.add(p.b);
    await createMergeGroup(userId, [p.a, p.b], { status: "auto" });
  }
}

// --- Rule helpers -----------------------------------------------------------

function hasDuplicate(it: Item, items: Item[]): boolean {
  const win = DUPLICATE_WINDOW_DAYS * DAY;
  return items.some(
    (o) =>
      o !== it &&
      o.vendor === it.vendor &&
      o.amount === it.amount && // same SIGNED amount (a charge and its refund differ)
      Math.abs(o.date.getTime() - it.date.getTime()) <= win
  );
}

// A charge ≥ 3× the median of that vendor's ≥3 prior posted charges. Charges
// only — refunds neither trigger nor enter the median. Applies to every vendor
// (the approval model is retired; identity is the normalized string until F1).
async function applyUnusualAmount(userId: string, items: Item[]): Promise<void> {
  const charges = items.filter((it) => it.amount > 0);
  for (const it of charges) {
    const priors = charges
      .filter((o) => o.vendor === it.vendor && o.date.getTime() < it.date.getTime())
      .map((o) => o.amount);
    if (priors.length < UNUSUAL_MIN_PRIORS) continue;
    if (it.amount >= UNUSUAL_MULTIPLIER * median(priors)) {
      await fire(userId, RULES.unusualAmount, it.target);
    }
  }
}

// Flag upsert invariant (FR4): fires & no row → create open; fires & dismissed →
// untouched (permanence); fires & resolved → reopen; fires & open → leave. The
// analyzer never CLOSES a flag — only actions (approve/merge/dismiss) do.
async function fire(
  userId: string,
  rule: string,
  target: { transactionId: string } | { mergeGroupId: string }
): Promise<void> {
  const where =
    "transactionId" in target
      ? { rule_transactionId: { rule, transactionId: target.transactionId } }
      : { rule_mergeGroupId: { rule, mergeGroupId: target.mergeGroupId } };
  const existing = await prisma.transactionFlag.findUnique({ where });
  if (!existing) {
    await prisma.transactionFlag.create({ data: { userId, rule, ...target, status: "open" } });
  } else if (existing.status === "resolved") {
    await prisma.transactionFlag.update({
      where: { id: existing.id },
      data: { status: "open", resolvedAt: null },
    });
  }
  // dismissed → untouched; open → leave as-is.
}
