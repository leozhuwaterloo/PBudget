// Gate for the day-of-month vendor filter. Pure (no DB): drives matchesCondition
// with a dayOfMonth-only row over fabricated txn dates, covering the last-day (0)
// and count-back (-n) resolution plus month-length + leap-year edges. The one thing
// that fails if targetDayOfMonth's math drifts. Run: npm run check:dayofmonth
import assert from "assert";
import type { VendorCondition } from "@prisma/client";
import { matchesCondition, type MatchTxn } from "../src/lib/analysis/match";

const cond = (dayOfMonth: number): VendorCondition =>
  ({ role: "match", order: 0, dayOfMonth } as unknown as VendorCondition);

// A txn on the given UTC calendar date (datetime is stored midnight-UTC of the date).
const txnOn = (iso: string): MatchTxn => ({
  name: "x", merchantName: null, amount: 1, accountId: "a",
  paymentChannel: "online", category: null, datetime: new Date(`${iso}T00:00:00Z`),
});

const hit = (dom: number, iso: string) => matchesCondition(cond(dom), txnOn(iso));

// positive = exact calendar day
assert(hit(1, "2026-07-01") && !hit(1, "2026-07-02"), "day 1");
// last day (0): 31-day month, 28-day Feb, 29-day leap Feb
assert(hit(0, "2026-07-31") && !hit(0, "2026-07-30"), "last day, 31-day month");
assert(hit(0, "2025-02-28") && !hit(0, "2025-02-27"), "last day, non-leap Feb");
assert(hit(0, "2024-02-29"), "last day, leap Feb");
// count back from last
assert(hit(-1, "2026-07-30") && !hit(-1, "2026-07-31"), "last − 1");
// out-of-range positive matches nothing that month
assert(!hit(31, "2026-06-30") && hit(31, "2026-07-31"), "day 31 only in 31-day months");

console.log("check:dayofmonth OK");
process.exit(0);
