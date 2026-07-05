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

const TRANSFER_NAME = /e-?transfer|etfr|send money/i;

// Plaid category primary TRANSFER_IN/TRANSFER_OUT, or an e-transfer-style name.
export function isTransferLike(txn: {
  category: string | null;
  name: string;
}): boolean {
  const primary = plaidPrimary(txn.category);
  if (primary === "TRANSFER_IN" || primary === "TRANSFER_OUT") return true;
  return TRANSFER_NAME.test(txn.name);
}
