// Analyzer thresholds and rule ids (SPEC "Constants"). Not configurable in v1.
export const UNUSUAL_MULTIPLIER = 3;
export const UNUSUAL_MIN_PRIORS = 3;
export const DUPLICATE_WINDOW_DAYS = 3;
export const AUTOMATCH_WINDOW_DAYS = 4;
// Review only looks back this far: auto-match pool + suspicion rules ignore
// anything older, so old history doesn't churn the queue on every sync.
export const ANALYSIS_WINDOW_DAYS = 365;

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
