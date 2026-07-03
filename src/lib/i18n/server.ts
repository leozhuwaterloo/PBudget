import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { getSessionUser } from "@/lib/auth";
import { normalizeLocale, type Locale } from "./index";

// getLocale() = session user's User.locale ?? `locale` cookie ?? "en".
// Pass the already-fetched user (layout has one) to avoid a second session query.
export async function getLocale(user?: User | null): Promise<Locale> {
  const u = user !== undefined ? user : await getSessionUser();
  if (u?.locale) return normalizeLocale(u.locale);
  return normalizeLocale(cookies().get("locale")?.value);
}
