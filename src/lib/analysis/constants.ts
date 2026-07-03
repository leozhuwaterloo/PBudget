// Analyzer thresholds and rule ids (SPEC "Constants"). Not configurable in v1.
export const UNUSUAL_MULTIPLIER = 3;
export const UNUSUAL_MIN_PRIORS = 3;
export const DUPLICATE_WINDOW_DAYS = 3;
export const AUTOMATCH_WINDOW_DAYS = 4;

export const RULES = {
  unknownVendor: "unknown_vendor",
  unmatchedTransfer: "unmatched_transfer",
  unusualAmount: "unusual_amount",
  duplicateCharge: "duplicate_charge",
} as const;

export type RuleId = (typeof RULES)[keyof typeof RULES];
