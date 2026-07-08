// Gate for the day-of-month vendor filter. Pure (no DB): drives matchesCondition
// with a day-of-month-only row over fabricated txn dates. Covers the multi-day list
// (OR), the last-day (0) and count-back (-n) resolution, month-length + leap-year
// edges, and the legacy single-column fallback. The one thing that fails if the
// day math or list plumbing drifts. Run: npm run check:dayofmonth
import assert from "assert";
import type { VendorCondition } from "@prisma/client";
import { matchesCondition, type MatchTxn } from "../src/lib/analysis/match";

// New rows store a CSV list in daysOfMonth; `legacy` exercises the old single column.
const cond = (days: number[] | null, legacy: number | null = null): VendorCondition =>
  ({
    role: "match",
    order: 0,
    daysOfMonth: days && days.length ? days.join(",") : null,
    dayOfMonth: legacy,
  } as unknown as VendorCondition);

// A txn on the given UTC calendar date (datetime is stored midnight-UTC of the date).
const txnOn = (iso: string): MatchTxn => ({
  name: "x", merchantName: null, amount: 1, accountId: "a",
  paymentChannel: "online", category: null, datetime: new Date(`${iso}T00:00:00Z`),
});

const hit = (days: number[], iso: string) => matchesCondition(cond(days), txnOn(iso));

// single value in a list = exact calendar day
assert(hit([1], "2026-07-01") && !hit([1], "2026-07-02"), "day 1");
// list is an OR: matches any member, nothing else
assert(hit([1, 2], "2026-07-01") && hit([1, 2], "2026-07-02") && !hit([1, 2], "2026-07-03"), "day 1 or 2");
// last day (0): 31-day month, 28-day Feb, 29-day leap Feb
assert(hit([0], "2026-07-31") && !hit([0], "2026-07-30"), "last day, 31-day month");
assert(hit([0], "2025-02-28") && !hit([0], "2025-02-27"), "last day, non-leap Feb");
assert(hit([0], "2024-02-29"), "last day, leap Feb");
// count back from last, alongside a positive in the same list
assert(hit([1, -1], "2026-07-30") && !hit([1, -1], "2026-07-31"), "last − 1 (mixed list)");
// out-of-range positive matches nothing that month
assert(!hit([31], "2026-06-30") && hit([31], "2026-07-31"), "day 31 only in 31-day months");
// legacy single-column rows (no daysOfMonth) still match
assert(matchesCondition(cond(null, 1), txnOn("2026-07-01")), "legacy dayOfMonth fallback");
assert(!matchesCondition(cond(null, 1), txnOn("2026-07-02")), "legacy dayOfMonth fallback (miss)");
// empty list = no day filter → the row has no set fields, so it never matches
assert(!matchesCondition(cond([]), txnOn("2026-07-01")), "empty list is no filter");

console.log("check:dayofmonth OK");
process.exit(0);
