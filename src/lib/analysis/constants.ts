// Analyzer thresholds and rule ids (SPEC "Constants"). Not configurable in v1.
export const UNUSUAL_MULTIPLIER = 3;
export const UNUSUAL_MIN_PRIORS = 3;
export const DUPLICATE_WINDOW_DAYS = 3;
export const AUTOMATCH_WINDOW_DAYS = 4;
// Review only looks back this far: auto-match pool + suspicion rules ignore
// anything older, so old history doesn't churn the queue on every sync.
export const ANALYSIS_WINDOW_DAYS = 365;

// The built-in "ignore" category. A vendor rule that routes a txn here suppresses it:
// hidden from Review + the merge picker, kept out of Dashboard totals, and it WINS
// vendor matching regardless of priority (pickWinner in match.ts) — an ignore
// decision can't be quietly overridden by a broader/higher-priority rule.
// Undeletable/unrenameable (categories.ts) so the name these features key on can't
// drift. Lives here, not in categories.ts, so match.ts can import it without a cycle.
export const IGNORE_CATEGORY = "Ignore";

// The built-in "Transfer" category. TRANSFER_IN/TRANSFER_OUT collapse to it
// (plaidCategoryName), and the unmatched_transfer suspicion rule keys on it: a txn
// is flagged only when its RESOLVED category is Transfer (so a vendor that recats a
// Plaid-labelled transfer as e.g. Mortgage no longer trips it). Rename/delete-locked
// (categories.ts) so that literal name can't drift out from under the rule.
export const TRANSFER_CATEGORY = "Transfer";

// Catch-all for spend that resolved to a category the user doesn't actually have —
// i.e. the raw humanized Plaid primary fallback (e.g. "Food And Drink") when no
// vendor rule / override claimed the txn. The read model (effective.ts) folds every
// such non-user category into this one bucket so no raw Plaid name masquerades as a
// user category. NOT excluded from totals (it's real spend) and NOT seeded — it
// surfaces only when there's uncategorized spend, and drilling in re-categorises it.
export const UNCATEGORIZED_CATEGORY = "Uncategorized";

export const RULES = {
  // Queue-type items (engine lands in F1's match.ts): every effective item is
  // matched to a vendor or sits in one of these two queues.
  unmatchedVendor: "unmatched_vendor",
  vendorConflict: "vendor_conflict",
  // Suspicion flags (analyzer fires these today).
  unmatchedTransfer: "unmatched_transfer",
  unusualAmount: "unusual_amount",
  duplicateCharge: "duplicate_charge",
} as const;

export type RuleId = (typeof RULES)[keyof typeof RULES];
