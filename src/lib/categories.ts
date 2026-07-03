import type { CategoryMapping } from "@prisma/client";

// "FOOD_AND_DRINK" -> "Food And Drink"
export function humanize(pfcPrimary: string): string {
  return pfcPrimary
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Effective user category for a Plaid primary: a user-set CategoryMapping
// override if one exists, else the humanized Plaid primary. Applied at READ
// time everywhere so remaps retroactively move spend (SPEC "Categories").
export function categoryFor(
  mappings: CategoryMapping[],
  plaidPrimary: string
): string {
  const override = mappings.find((m) => m.plaidPrimary === plaidPrimary);
  return override ? override.categoryName : humanize(plaidPrimary);
}
