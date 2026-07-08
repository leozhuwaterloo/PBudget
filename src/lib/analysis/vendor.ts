// Vendor identity + transfer detection (SPEC "Vendor identity" / "Transfer-like").
// No fuzzy matching.

// Parse the primary of Plaid's personal_finance_category out of the JSON text
// stored in PlaidTransaction.category (saveTransactions spreads the pfc at top
// level, so `.primary` sits at the root). Returns null when absent/unparseable.
export function plaidPrimary(category: string | null | undefined): string | null {
  if (!category) return null;
  try {
    return (JSON.parse(category) as { primary?: string }).primary ?? null;
  } catch {
    return null;
  }
}

// Same as plaidPrimary but for the detailed subcategory (FR1: a condition row may
// match on plaidDetailed). Returns null when absent/unparseable.
export function plaidDetailed(category: string | null | undefined): string | null {
  if (!category) return null;
  try {
    return (JSON.parse(category) as { detailed?: string }).detailed ?? null;
  } catch {
    return null;
  }
}

// Plaid's confidence in its predicted category (VERY_HIGH | HIGH | MEDIUM | LOW |
// UNKNOWN), stored at the root of the category JSON alongside primary/detailed.
// Surfaced on transactions and usable as a match-condition field. null if absent.
export function plaidConfidence(category: string | null | undefined): string | null {
  if (!category) return null;
  try {
    return (JSON.parse(category) as { confidence_level?: string }).confidence_level ?? null;
  } catch {
    return null;
  }
}

// A match condition's confidence is a MINIMUM (a floor), not an exact value: a txn
// qualifies when it's at least as confident as the target. LOW is the floor, so
// target LOW matches everything; UNKNOWN/absent/unrecognized confidence is treated
// as the floor, so it clears a LOW target but nothing higher.
const CONFIDENCE_ORDER = ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"];
function confidenceRank(level: string | null): number {
  const i = CONFIDENCE_ORDER.indexOf((level ?? "").toUpperCase());
  return i < 0 ? 0 : i;
}
export function meetsConfidence(txnCategory: string | null | undefined, target: string): boolean {
  return confidenceRank(plaidConfidence(txnCategory)) >= confidenceRank(target);
}

// Lower-cased, whitespace-folded. The one string normalization the funnel uses:
// vendor identity, and case-insensitive name/merchant condition matching (F1) both
// go through this so they agree byte-for-byte.
export function normalizeStr(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// Lower-cased, whitespace-folded `merchantName ?? name`.
export function normalizeVendor(
  merchantName: string | null | undefined,
  name: string
): string {
  return normalizeStr(merchantName ?? name);
}

// Vendor identity for the suspicion rules (FR1): the materialized vendorId when a
// vendor matched, else the normalized string. Namespaced so a cuid can never collide
// with a normalized name across the two identity spaces. Shared by the analyzer
// (duplicate/unusual detection) and Review's duplicate-charge grouping so both key
// duplicates on exactly the same identity.
export function vendorIdentity(vendorId: string | null, normalized: string): string {
  return vendorId ? `v:${vendorId}` : `n:${normalized}`;
}
