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

// Lower-cased, whitespace-folded `merchantName ?? name`.
export function normalizeVendor(
  merchantName: string | null | undefined,
  name: string
): string {
  return (merchantName ?? name).toLowerCase().replace(/\s+/g, " ").trim();
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
