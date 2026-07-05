"use client";
import { createContext, useCallback, useContext } from "react";
import { t as translate, type Locale } from "./index";

// Client-side locale plumbing. layout.tsx resolves the locale server-side and
// wraps the app in <I18nProvider>; client components read it via useT()/useLocale().
const LocaleContext = createContext<Locale>("en");

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT() {
  const locale = useContext(LocaleContext);
  // Memoize so the returned fn is stable across renders — callers put `t` in
  // useEffect/useCallback deps, and a fresh closure each render loops them.
  return useCallback(
    (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  );
}
