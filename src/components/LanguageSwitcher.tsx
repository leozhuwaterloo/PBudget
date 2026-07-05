"use client";
import { useRouter } from "next/navigation";
import { LOCALES, type Locale } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/context";

// Nav language control. Sets the `locale` cookie always (so pre-login and
// logged-out users get their choice), and persists User.locale when logged in.
// Awaits the POST before router.refresh() because getLocale() prefers
// User.locale over the cookie — refreshing first would read the stale value.
export default function LanguageSwitcher() {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();

  const change = async (next: Locale) => {
    document.cookie = `locale=${next}; path=/; max-age=31536000; samesite=lax`;
    await fetch("/api/settings/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: next }),
    }).catch(() => {});
    router.refresh();
  };

  return (
    <select
      aria-label={t("nav.language")}
      value={locale}
      onChange={(e) => change(e.target.value as Locale)}
      style={{ width: "auto" }}
    >
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
