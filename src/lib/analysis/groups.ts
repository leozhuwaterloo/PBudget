import type { Prisma } from "@prisma/client";

// Merge-group leg math (SPEC "Merge lifecycle" / FR3).
// Plaid sign convention: positive amount = money OUT (outflow), negative = in.

type LegLike = { amount: number | Prisma.Decimal; datetime: Date };
const n = (a: number | Prisma.Decimal): number => Number(a);

// Signed sum of the legs, rounded to cents so float dust never masks a net-0
// self-transfer. ponytail: cent rounding, revisit if sub-cent currencies appear.
export function netAmount(legs: LegLike[]): number {
  const sum = legs.reduce((acc, l) => acc + n(l.amount), 0);
  return Math.round(sum * 100) / 100;
}

// Primary leg = largest outflow (amount > 0); if no outflow, largest |amount|;
// ties broken by earliest date. Title/vendor/category/date derive from this leg.
export function primaryLeg<T extends LegLike>(legs: T[]): T {
  const outflows = legs.filter((l) => n(l.amount) > 0);
  const byOutflow = outflows.length > 0;
  const pool = byOutflow ? outflows : legs;
  const rank = (l: LegLike) => (byOutflow ? n(l.amount) : Math.abs(n(l.amount)));
  return [...pool].sort((a, b) => {
    const d = rank(b) - rank(a); // larger amount first
    return d !== 0 ? d : a.datetime.getTime() - b.datetime.getTime(); // ties: earliest
  })[0];
}
