// Review hub read model (F12, FR6). One call assembles everything /review shows so
// the client refetches after each action and watches the queues shrink. Read-only:
// every mutation goes through an existing route (vendors / catalog / flag-dismiss /
// merge / splits). Kept out of the route handler so it's unit-testable without HTTP
// (see scripts/check-review.ts). Amounts stay Plaid-convention (+ = outflow); the
// UI renders them user-convention.
import { prisma } from "./db";
import { normalizeVendor, plaidPrimary, plaidDetailed, plaidConfidence } from "./analysis/vendor";
import { primaryLeg } from "./analysis/groups";
import { matchesVendor } from "./analysis/match";
import { ignoredTxnIds } from "./categories";
import { RULES, ANALYSIS_WINDOW_DAYS } from "./analysis/constants";

const num = (d: unknown): number | null => (d == null ? null : Number(d));

// UTC calendar boundaries (same convention as /api/flags) for the counters.
const dayRange = (d: Date) => {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
};
const monthRange = (d: Date) => {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
};
const inRange = (date: Date, r: { start: Date; end: Date }) => date >= r.start && date < r.end;

const SUSPICION = [RULES.unmatchedTransfer, RULES.unusualAmount, RULES.duplicateCharge] as const;

export type UnmatchedRow = {
  flagId: string;
  level: "transaction" | "group";
  id: string;
  title: string;
  name: string;
  merchantName: string | null;
  amount: number | null;
  currency: string | null;
  date: Date;
  // Representative-txn fields for the Review detail card (a group shows its primary leg's).
  accountId: string;
  paymentChannel: string;
  plaidPrimary: string | null;
  plaidDetailed: string | null;
  plaidConfidence: string | null;
  // FR5: transaction rows can initiate a split when posted, ungrouped, unsplit.
  // Group-backed rows are never eligible (split/merge mutual exclusion).
  eligibleForSplit: boolean;
};
export type ConflictRow = {
  flagId: string;
  level: "transaction" | "group";
  id: string;
  title: string;
  subtitle: string;
  amount: number | null;
  currency: string | null;
  date: Date;
  winnerVendorId: string | null;
  vendors: { id: string; name: string; priority: number | null }[];
};
export type SuspicionEntry = {
  flagId: string;
  level: "transaction" | "group";
  transactionId?: string;
  mergeGroupId?: string;
  vendor: string | null;
  name?: string;
  title?: string;
  amount: number | null;
  currency: string | null;
  date: Date;
  // FR5: same split eligibility as UnmatchedRow (false for group rows).
  eligibleForSplit: boolean;
};
export type GroupRow = {
  id: string;
  title: string;
  vendor: string | null;
  amount: number | null;
  currency: string | null;
  date: Date;
  legs: { transactionId: string; name: string | null; amount: number | null }[];
};
export type SplitRow = {
  parentTransactionId: string;
  title: string;
  amount: number | null;
  currency: string | null;
  date: Date;
  parts: { amount: number | null; label: string | null; categoryName: string | null }[];
};
export type ReviewPayload = {
  counters: { today: number; thisMonth: number; totalOpen: number };
  // The unmatched queue is the one unbounded section, so it paginates server-side.
  // `unmatched` is the current page; `unmatchedTotal` is the count after search.
  unmatched: UnmatchedRow[];
  unmatchedTotal: number;
  unmatchedPage: number;
  unmatchedPageSize: number;
  conflicts: ConflictRow[];
  suspicion: Record<string, SuspicionEntry[]>;
  pendingGroups: GroupRow[];
  mergeGroups: GroupRow[];
  splits: SplitRow[];
};

// Permanently dismiss a flag (FR4) — the write side the dismiss route calls.
// The two queue flags (unmatched_vendor + vendor_conflict) have NO dismiss: they
// clear ONLY by resolution — matching a vendor / removing the overlap so a single
// vendor wins (PRD). Dismissing one would silently drop the txn from the queue and
// break the match-or-queue invariant (setQueueFlag never reopens a dismissed flag),
// so it's rejected. Only suspicion flags dismiss permanently.
export async function dismissFlag(
  userId: string,
  flagId: string
): Promise<"ok" | "not_found" | "forbidden"> {
  const flag = await prisma.transactionFlag.findFirst({ where: { id: flagId, userId } });
  if (!flag) return "not_found";
  if (flag.rule === RULES.unmatchedVendor || flag.rule === RULES.vendorConflict) return "forbidden";
  await prisma.transactionFlag.update({
    where: { id: flag.id },
    data: { status: "dismissed", resolvedAt: new Date() },
  });
  return "ok";
}

// Un-mark a marked-valid (dismissed) flag — reopen it so the analyzer/queue
// surface it again. The inverse of dismissFlag, used by the "Marked valid" tab.
export async function restoreFlag(
  userId: string,
  flagId: string
): Promise<"ok" | "not_found"> {
  const flag = await prisma.transactionFlag.findFirst({
    where: { id: flagId, userId, status: "dismissed" },
  });
  if (!flag) return "not_found";
  await prisma.transactionFlag.update({
    where: { id: flag.id },
    data: { status: "open", resolvedAt: null },
  });
  return "ok";
}

const UNMATCHED_PAGE_SIZE = 25;

export async function reviewData(
  userId: string,
  opts: { page?: number; q?: string } = {}
): Promise<ReviewPayload> {
  const [openFlags, allGroups, splits, posted, vendorRows] = await Promise.all([
    prisma.transactionFlag.findMany({ where: { userId, status: "open" } }),
    prisma.mergeGroup.findMany({ where: { userId }, include: { legs: true } }),
    prisma.transactionSplit.findMany({
      where: { userId },
      include: { parts: { orderBy: { id: "asc" } } },
    }),
    prisma.plaidTransaction.findMany({ where: { pending: false, account: { item: { userId } } } }),
    prisma.vendor.findMany({
      where: { userId, priority: { not: null } },
      include: { conditions: true },
      orderBy: { priority: "asc" },
    }),
  ]);

  const txnById = new Map(posted.map((t) => [t.transactionId, t]));
  const groupById = new Map(allGroups.map((gr) => [gr.id, gr]));

  // Review only surfaces analyzer output from the last ANALYSIS_WINDOW_DAYS (mirrors
  // analyzeUser's window). Older unmatched/conflict/suspicion flags and auto merge
  // suggestions drop off the queue — they stay in the DB, just out of view, so a
  // narrowed window takes effect on the next load without re-running analysis. User
  // artifacts (confirmed merges, splits) are NOT windowed.
  const since = new Date(Date.now() - ANALYSIS_WINDOW_DAYS * 86400000);
  const flagDate = (f: (typeof openFlags)[number]): Date | null =>
    (f.transactionId
      ? txnById.get(f.transactionId)?.datetime
      : f.mergeGroupId
        ? groupById.get(f.mergeGroupId)?.date
        : null) ?? null;
  const inWindow = (d: Date | null): boolean => !!d && d >= since;

  // Match order = ascending priority; legacy/condition-less vendors never match.
  const vendors = vendorRows.filter((v) => v.conditions.length > 0);

  // FR5 split eligibility for a transaction row (same rule as api/accounts/transactions):
  // posted (all `posted` rows are) + ungrouped + not already a split parent.
  const splitParents = new Set(splits.map((s) => s.parentTransactionId));
  const mergeLegs = new Set(allGroups.flatMap((gr) => gr.legs.map((l) => l.transactionId)));
  const eligibleTxn = (transactionId: string) => !splitParents.has(transactionId) && !mergeLegs.has(transactionId);

  // The representative txn behind a flag: the txn itself, or a group's primary leg.
  const legsOf = (grp: (typeof allGroups)[number]) =>
    grp.legs.map((l) => txnById.get(l.transactionId)).filter((t): t is (typeof posted)[number] => !!t);
  const flagTxn = (f: (typeof openFlags)[number]) => {
    if (f.transactionId) return txnById.get(f.transactionId) ?? null;
    const grp = f.mergeGroupId ? groupById.get(f.mergeGroupId) : null;
    const legs = grp ? legsOf(grp) : [];
    return legs.length ? primaryLeg(legs) : null;
  };
  const byDateDesc = (a: { date: Date }, b: { date: Date }) => b.date.getTime() - a.date.getTime();

  // Transactions routed to the Ignore category are hidden from Review (and the merge
  // picker + Dashboard totals). Resolve via the materialized vendor — the winning
  // vendorId is always one of these loaded vendors — and drop any flag/pending-group
  // whose txn (or a group's primary leg) is ignored. Flags stay in the DB, out of view.
  const ignored = ignoredTxnIds(posted, vendors);
  const isIgnored = (f: (typeof openFlags)[number]): boolean => {
    const t = flagTxn(f);
    return !!t && ignored.has(t.transactionId);
  };
  const groupIgnored = (grp: (typeof allGroups)[number]): boolean => {
    const legs = legsOf(grp);
    const primary = legs.length ? primaryLeg(legs) : null;
    return !!primary && ignored.has(primary.transactionId);
  };

  // --- Unmatched queue: one row per effective item (merchant/name for pre-fill) ---
  const unmatched: UnmatchedRow[] = openFlags
    .filter((f) => f.rule === RULES.unmatchedVendor && inWindow(flagDate(f)))
    .flatMap((f) => {
      const t = flagTxn(f);
      if (!t) return [];
      const isGroup = !!f.mergeGroupId;
      const grp = isGroup ? groupById.get(f.mergeGroupId!) : null;
      return [{
        flagId: f.id,
        level: isGroup ? ("group" as const) : ("transaction" as const),
        id: isGroup ? grp!.id : t.transactionId,
        title: isGroup ? grp!.title : t.name,
        name: t.name,
        merchantName: t.merchantName,
        amount: isGroup ? num(grp!.netAmount) : num(t.amount),
        currency: isGroup ? grp!.currency : t.isoCurrencyCode,
        date: isGroup ? grp!.date : t.datetime,
        accountId: t.accountId,
        paymentChannel: t.paymentChannel,
        plaidPrimary: plaidPrimary(t.category),
        plaidDetailed: plaidDetailed(t.category),
        plaidConfidence: plaidConfidence(t.category),
        eligibleForSplit: !isGroup && eligibleTxn(t.transactionId),
      }];
    })
    .sort(byDateDesc);

  // Search + pagination for the unmatched queue. merchantName/name are encrypted at
  // rest so this can't be a DB filter — the rows above are already decrypted, so we
  // filter/slice them here. Opt-in: with no `page` arg the full list is returned
  // (check-review + whole-queue callers keep working). Counters below span the FULL
  // list, independent of the current search.
  const q = (opts.q ?? "").toLowerCase().trim();
  const unmatchedMatched = q
    ? unmatched.filter(
        (r) =>
          (r.merchantName ?? "").toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q)
      )
    : unmatched;
  const unmatchedTotal = unmatchedMatched.length;
  const lastPage = Math.max(0, Math.ceil(unmatchedTotal / UNMATCHED_PAGE_SIZE) - 1);
  const unmatchedPage = opts.page === undefined ? 0 : Math.max(0, Math.min(opts.page, lastPage));
  const unmatchedView =
    opts.page === undefined
      ? unmatchedMatched
      : unmatchedMatched.slice(
          unmatchedPage * UNMATCHED_PAGE_SIZE,
          unmatchedPage * UNMATCHED_PAGE_SIZE + UNMATCHED_PAGE_SIZE
        );

  // --- Conflicts: every matching vendor + the priority winner (materialized) ---
  const conflicts: ConflictRow[] = openFlags
    .filter((f) => f.rule === RULES.vendorConflict && inWindow(flagDate(f)) && !isIgnored(f))
    .flatMap((f) => {
      const t = flagTxn(f);
      if (!t) return [];
      const isGroup = !!f.mergeGroupId;
      const grp = isGroup ? groupById.get(f.mergeGroupId!) : null;
      const matching = vendors.filter((v) => matchesVendor(v, t));
      return [{
        flagId: f.id,
        level: isGroup ? ("group" as const) : ("transaction" as const),
        id: isGroup ? grp!.id : t.transactionId,
        title: isGroup ? grp!.title : normalizeVendor(t.merchantName, t.name),
        subtitle: isGroup ? grp!.title : t.name,
        amount: isGroup ? num(grp!.netAmount) : num(t.amount),
        currency: isGroup ? grp!.currency : t.isoCurrencyCode,
        date: isGroup ? grp!.date : t.datetime,
        winnerVendorId: t.vendorId,
        vendors: matching.map((v) => ({ id: v.id, name: v.name, priority: v.priority })),
      }];
    })
    .sort(byDateDesc);

  // --- Suspicion rules: same entry shape the old queue used ---
  const suspicion: Record<string, SuspicionEntry[]> = {};
  for (const rule of SUSPICION) suspicion[rule] = [];
  for (const f of openFlags) {
    if (!(SUSPICION as readonly string[]).includes(f.rule)) continue;
    if (!inWindow(flagDate(f))) continue;
    if (isIgnored(f)) continue;
    if (f.transactionId) {
      const t = txnById.get(f.transactionId);
      if (!t) continue;
      suspicion[f.rule].push({
        flagId: f.id, level: "transaction", transactionId: t.transactionId,
        vendor: normalizeVendor(t.merchantName, t.name), name: t.name,
        amount: num(t.amount), currency: t.isoCurrencyCode, date: t.datetime,
        eligibleForSplit: eligibleTxn(t.transactionId),
      });
    } else {
      const grp = groupById.get(f.mergeGroupId!);
      if (!grp) continue;
      suspicion[f.rule].push({
        flagId: f.id, level: "group", mergeGroupId: grp.id,
        vendor: grp.vendorName, title: grp.title,
        amount: num(grp.netAmount), currency: grp.currency, date: grp.date,
        eligibleForSplit: false,
      });
    }
  }
  for (const rule of SUSPICION) suspicion[rule].sort(byDateDesc);

  // --- Merge groups (pending auto vs all confirmed) + splits ---
  const groupView = (grp: (typeof allGroups)[number]): GroupRow => ({
    id: grp.id, title: grp.title, vendor: grp.vendorName,
    amount: num(grp.netAmount), currency: grp.currency, date: grp.date,
    legs: grp.legs.map((l) => {
      const t = txnById.get(l.transactionId);
      return { transactionId: l.transactionId, name: t?.name ?? null, amount: t ? num(t.amount) : null };
    }),
  });
  const pendingGroups = allGroups.filter((grp) => grp.status === "auto" && inWindow(grp.date) && !groupIgnored(grp)).map(groupView).sort(byDateDesc);
  const mergeGroups = allGroups.filter((grp) => grp.status === "confirmed").map(groupView).sort(byDateDesc);

  const splitRows: SplitRow[] = splits.flatMap((s) => {
    const t = txnById.get(s.parentTransactionId);
    if (!t) return [];
    return [{
      parentTransactionId: s.parentTransactionId,
      title: t.name,
      amount: num(t.amount),
      currency: t.isoCurrencyCode,
      date: t.datetime,
      parts: s.parts.map((p) => ({ amount: num(p.amount), label: p.label, categoryName: p.categoryName })),
    }];
  }).sort(byDateDesc);

  // --- Counters: open items across ALL sections, by their own date ---
  const now = new Date();
  const today = dayRange(now);
  const thisMonth = monthRange(now);
  const openDates = [
    ...unmatched.map((r) => r.date),
    ...conflicts.map((r) => r.date),
    ...SUSPICION.flatMap((rule) => suspicion[rule].map((e) => e.date)),
    ...pendingGroups.map((r) => r.date),
  ];
  const counters = {
    today: openDates.filter((d) => inRange(d, today)).length,
    thisMonth: openDates.filter((d) => inRange(d, thisMonth)).length,
    totalOpen: openDates.length,
  };

  return {
    counters,
    unmatched: unmatchedView,
    unmatchedTotal,
    unmatchedPage,
    unmatchedPageSize: UNMATCHED_PAGE_SIZE,
    conflicts,
    suspicion,
    pendingGroups,
    mergeGroups,
    splits: splitRows,
  };
}
