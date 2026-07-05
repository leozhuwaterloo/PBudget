// Reusable bundled-icon library (F4). Brand SVGs are extracted ONCE at dev time
// into icons.generated.ts (see scripts/gen-icons.mjs) and shipped in the bundle —
// runtime never fetches an icon. The vendor builder (F10) reuses this: users pick
// any bundled slug or fall back to a generated letter avatar.
import { BRAND_ICONS, type BrandIcon } from "./icons.generated";

export type { BrandIcon };
export { BRAND_ICONS };

// Every bundled icon slug, sorted — F10's icon picker lists these plus the
// letter-avatar option.
export const ICON_SLUGS: string[] = Object.keys(BRAND_ICONS).sort();

// The 24x24 single-path glyph for a slug, or null (→ render a letter avatar).
export function getBrandIcon(slug: string | null | undefined): BrandIcon | null {
  return slug ? BRAND_ICONS[slug] ?? null : null;
}

// Deterministic letter avatar for entries/vendors with no bundled icon: first
// letter + a hue derived from the name, so the same name always looks the same.
export function letterAvatar(name: string): { letter: string; hue: number } {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return { letter, hue: h };
}
