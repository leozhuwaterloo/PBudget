import en from "./en";
import zh from "./zh";

// Pure, isomorphic i18n core (no server/client-only imports — safe to import
// from either). Server code calls t(locale, key) directly; client code uses the
// useT() hook from ./context, which wraps this.
export type Locale = "en" | "zh-Hans";

export const LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "zh-Hans", label: "简体中文" },
];

const dicts = { en, "zh-Hans": zh };

export function normalizeLocale(v: string | null | undefined): Locale {
  return v === "zh-Hans" ? "zh-Hans" : "en";
}

// t(locale, key, params?) — dictionary lookup with en fallback then the raw key,
// and {name} token substitution. Keeps callers from crashing on an unknown key.
export function t(locale: Locale, key: string, params?: Record<string, string | number>): string {
  let s = dicts[locale][key as keyof typeof en] ?? en[key as keyof typeof en] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, String(v));
  return s;
}
