// Single analyzer entry point (SPEC "Analyzer semantics", FR1/FR3/FR4). Called
// from the demo seed and from the sync route after upserts. Deterministic and
// idempotent: re-running over unchanged data changes no flags or groups.
import type { PlaidTransaction } from "@prisma/client";
import { prisma } from "../db";
import { normalizeVendor, isTransferLike } from "./vendor";
import { createMergeGroup } from "./merge";
import {
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
  // 1. Scope: the user's POSTED transactions only (FR1 exemption d). Pending
  //    rows are invisible to analysis until they post.
  const posted = await prisma.plaidTransaction.findMany({
    where: { pending: false, account: { item: { userId } } },
  });

  // 2. Upsert a pending Vendor row for every distinct normalized vendor seen
  //    (FR2 "every distinct vendor starts pending"). Existing rows are untouched
  //    so an already-approved/rejected decision survives re-analysis.
  const vendorNames = new Set(posted.map((t) => normalizeVendor(t.merchantName, t.name)));
  for (const name of vendorNames) {
    await prisma.vendor.upsert({
      where: { userId_name: { userId, name } },
      create: { userId, name },
      update: {},
    });
  }

  // 3. Auto-match opposite-sign equal-amount cross-account pairs into net-0 groups.
  await autoMatch(userId, posted);

  // 4-6. Rules over effective items + flag upsert invariant.
  const items = await buildEffectiveItems(userId);
  const vendors = await prisma.vendor.findMany({ where: { userId } });
  const approvedNames = new Set(
    vendors.filter((v) => v.status === "approved").map((v) => v.name)
  );
  const approved = (v: string) => approvedNames.has(v);

  for (const it of items) {
    // 5.1 unknown_vendor — vendor not approved (txns and net-≠0 groups).
    if (!approved(it.vendor)) await fire(userId, RULES.unknownVendor, it.target);
    // 5.2 unmatched_transfer — transfer-like individual txn (never on groups).
    if (it.isTxn && it.transferLike) await fire(userId, RULES.unmatchedTransfer, it.target);
    // 5.4 duplicate_charge — same vendor + same signed amount within the window.
    if (hasDuplicate(it, items)) await fire(userId, RULES.duplicateCharge, it.target);
  }
  // 5.3 unusual_amount — approved vendors only, charges only, ≥3 priors.
  await applyUnusualAmount(userId, items, approved);
}

// F2's vendor-approval flow re-runs rule 5.3 over the just-approved vendor's
// charges (SPEC "Vendor approval" — a big historical charge must still surface
// after approval clears the unknown_vendor flags). Same median path as analyzeUser.
export async function evaluateUnusualForVendor(userId: string, vendorName: string): Promise<void> {
  const vendor = await prisma.vendor.findUnique({
    where: { userId_name: { userId, name: vendorName } },
  });
  if (vendor?.status !== "approved") return;
  const items = await buildEffectiveItems(userId);
  await applyUnusualAmount(userId, items, (v) => v === vendorName);
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

// Ungrouped posted txns + net-≠0 groups (at their net, under the group vendor).
// Net-0 groups and all group legs are exempt from every rule.
async function buildEffectiveItems(userId: string): Promise<Item[]> {
  const posted = await prisma.plaidTransaction.findMany({
    where: { pending: false, account: { item: { userId } } },
  });
  const legIds = new Set(
    (await prisma.mergeGroupLeg.findMany({ select: { transactionId: true } })).map(
      (l) => l.transactionId
    )
  );
  const groups = await prisma.mergeGroup.findMany({ where: { userId } });

  const items: Item[] = [];
  for (const t of posted) {
    if (legIds.has(t.transactionId)) continue; // legs are represented by their group
    items.push({
      target: { transactionId: t.transactionId },
      vendor: normalizeVendor(t.merchantName, t.name),
      amount: cents(t.amount),
      date: t.datetime,
      transferLike: isTransferLike(t),
      isTxn: true,
    });
  }
  for (const g of groups) {
    if (cents(g.netAmount) === 0) continue; // net-0 self-transfer is accounted for
    items.push({
      target: { mergeGroupId: g.id },
      vendor: g.vendorName ?? "",
      amount: cents(g.netAmount),
      date: g.date,
      transferLike: false,
      isTxn: false,
    });
  }
  return items;
}

// --- Auto-match (FR3) -------------------------------------------------------

async function autoMatch(userId: string, posted: PlaidTransaction[]): Promise<void> {
  const grouped = new Set(
    (await prisma.mergeGroupLeg.findMany({ select: { transactionId: true } })).map(
      (l) => l.transactionId
    )
  );
  const memo = new Set(
    (await prisma.dissolvedGroupMemo.findMany({ where: { userId } })).map((m) => m.legKey)
  );
  const cands = posted.filter((t) => !grouped.has(t.transactionId));

  type Pair = { a: string; b: string; dist: number; key: string };
  const pairs: Pair[] = [];
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const a = cands[i];
      const b = cands[j];
      const ca = cents(a.amount);
      const cb = cents(b.amount);
      if (ca === 0 || ca !== -cb) continue; // opposite sign AND equal |amount|
      if (a.accountId === b.accountId) continue; // two different accounts
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

// Rule 5.3, factored so F2's approval path reuses it (never fork the median).
// A charge ≥ 3× the median of that vendor's ≥3 prior posted charges. Charges
// only — refunds neither trigger nor enter the median.
async function applyUnusualAmount(
  userId: string,
  items: Item[],
  approved: (v: string) => boolean
): Promise<void> {
  const charges = items.filter((it) => it.amount > 0);
  for (const it of charges) {
    if (!approved(it.vendor)) continue;
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
