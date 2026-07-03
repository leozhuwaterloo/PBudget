import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// POST /api/settings/locale { locale } — persist the logged-in user's language
// choice. Logged-out callers no-op (the cookie the switcher set already carries
// their choice; locale is not sensitive so no 401 needed).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: true });
  const body = await req.json().catch(() => null);
  await prisma.user.update({
    where: { id: user.id },
    data: { locale: normalizeLocale(body?.locale) },
  });
  return NextResponse.json({ ok: true });
}
