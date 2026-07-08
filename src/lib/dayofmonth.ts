// Day-of-month vendor filter encoding. A row can target SEVERAL days; they're
// stored as a CSV of "day codes" in VendorCondition.daysOfMonth (a String column,
// so it stays portable to SQLite, which has no array type). Each code: >0 = that
// calendar day; 0 = the month's last day; -n = n days before the last. UTC
// throughout — the app displays dates in UTC, so a user's "day 1" matches what
// they see on screen. Pure + dependency-free so both server (match.ts) and client
// (VendorEditor / vendorSummary) can import it.

export function parseDays(csv: string | null | undefined): number[] {
  if (!csv) return [];
  return csv.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n));
}

// Stored form: deduped CSV, or null when empty (so "no day filter" stays null).
export function serializeDays(days: number[]): string | null {
  const clean = [...new Set(days.filter((n) => Number.isInteger(n)))];
  return clean.length ? clean.join(",") : null;
}

// The days a stored row targets — the new list, falling back to the legacy single
// dayOfMonth column so rows written before the list existed keep matching.
export function effectiveDays(
  daysCsv: string | null | undefined,
  legacyDay: number | null | undefined
): number[] {
  const list = parseDays(daysCsv);
  if (list.length) return list;
  return legacyDay != null ? [legacyDay] : [];
}

// Concrete UTC day one code targets within `d`'s month. >0 → that day; 0 → last;
// -n → n before last. An out-of-range positive (31 in a 30-day month) won't equal
// any real getUTCDate(), so it silently matches nothing — no clamping.
export function targetDayOfMonth(code: number, d: Date): number {
  if (code > 0) return code;
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return lastDay + code; // 0 → last, -1 → last-1
}

// True when `d`'s UTC day equals ANY code (a row's day set is an OR).
export function matchesDayOfMonth(days: number[], d: Date): boolean {
  const day = d.getUTCDate();
  return days.some((code) => targetDayOfMonth(code, d) === day);
}
