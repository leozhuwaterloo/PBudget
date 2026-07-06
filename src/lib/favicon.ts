// Vendor icons, fetched ONCE server-side and stored as a data URI on the vendor row
// (the kept-but-unused `Vendor.icon` column), so the client never live-fetches a
// third party on render. Best-effort: any failure yields null and the UI falls back
// to a letter avatar.
//
// - Website link → the site's OWN declared favicon (what the browser shows),
//   falling back to Google's faviconV2 service (no key) when it declares none.
// - Google Maps link → the place/contributor's real profile photo IF Google exposes
//   one (via the page's og:image). A bare place whose og:image is only a static-map
//   tile gets nothing (a map tile isn't a profile icon) → letter avatar.
//
// ponytail: depends on Google (favicon service + Maps og:image markup). Ceilings:
// (1) in-process cache only — swap for a shared table if this runs hot; (2) timeouts
// so a slow Google can't wedge a vendor save; (3) og:image parsing is best-effort and
// breaks quietly (→ null) if Google changes their markup.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

// Google Maps profile/place PHOTO CDNs — as opposed to maps.google.com's static-map
// tile, which we skip.
const PHOTO_HOST = /(^|\.)googleusercontent\.com$|(^|\.)ggpht\.com$|(^|\.)streetviewpixels-pa\.googleapis\.com$/i;

// True for Google-Maps-style URLs; everything else is treated as a website.
export function isMapLink(url: string): boolean {
  return /google\.[^/]*\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(url);
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// Fetch an image URL → data URI (bounded, best-effort).
async function imageDataUri(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    const type = res.headers.get("content-type") || "image/png";
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// A Google Maps link's real profile/business photo, when it has one: resolve the
// (short) link, read the page's og:image, and keep it only when it's an actual photo
// (skip the static-map tile a bare place falls back to).
async function mapIconDataUri(link: string): Promise<string | null> {
  let html: string;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const page = await fetch(link, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    html = await page.text();
    clearTimeout(timer);
  } catch {
    return null;
  }
  const m =
    html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ||
    html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
  if (!m) return null;
  const imgUrl = m[1].replace(/&amp;/g, "&");
  const host = hostOf(imgUrl);
  if (!host || !PHOTO_HOST.test(host)) return null; // static-map tile / non-photo → skip
  return imageDataUri(imgUrl);
}

// A direct image URL the user supplies as the vendor's icon → data URI. No cache:
// these are unique per vendor and fetched once at save time.
export function iconForImageUrl(url: string | null): Promise<string | null> {
  return url ? imageDataUri(url) : Promise.resolve(null);
}

// The site's OWN declared favicon — what the browser actually shows. Fetch the
// page, read its <link rel="...icon...">, prefer apple-touch-icon (bigger/crisper),
// resolve relative → absolute, fetch it. Preferred over Google's faviconV2, whose
// cache is often stale/low-res (e.g. yifangtea.com). Null → caller falls back to
// faviconV2. Reuses the same HTML-fetch+regex shape as mapIconDataUri.
async function siteFaviconDataUri(pageUrl: string): Promise<string | null> {
  let html: string;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(pageUrl, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }
  // rel/href appear in either order → grab each <link> tag, then read attrs.
  const icons: { href: string; apple: boolean }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = tag.match(/\brel="([^"]*)"/i)?.[1] ?? "";
    if (!/icon/i.test(rel)) continue;
    const href = tag.match(/\bhref="([^"]+)"/i)?.[1];
    if (href) icons.push({ href, apple: /apple-touch-icon/i.test(rel) });
  }
  icons.sort((a, b) => Number(b.apple) - Number(a.apple)); // apple-touch-icon first
  for (const { href } of icons) {
    let abs: string;
    try {
      abs = new URL(href.replace(/&amp;/g, "&"), pageUrl).href;
    } catch {
      continue;
    }
    const data = await imageDataUri(abs);
    if (data) return data;
  }
  return null;
}

const cache = new Map<string, string | null>(); // key → data URI (or null miss)

// The stored icon for a vendor link: a website favicon or a Maps profile photo.
export async function iconForLink(link: string | null): Promise<string | null> {
  if (!link) return null;
  const key = isMapLink(link) ? `map:${link}` : `web:${hostOf(link) ?? ""}`;
  if (key === "web:") return null;
  if (cache.has(key)) return cache.get(key)!;

  let result: string | null = null;
  if (isMapLink(link)) {
    result = await mapIconDataUri(link);
  } else {
    // Prefer the site's own declared favicon (matches the browser). Only if it
    // declares none / it won't fetch do we fall back to Google's faviconV2, which
    // returns a real 200 favicon when Google has one, 404 (→ null → letter avatar)
    // when it doesn't. faviconV2's cache is sometimes stale/low-res, so the site's
    // own icon wins when present.
    result = await siteFaviconDataUri(link);
    if (!result) {
      const origin = new URL(link).origin;
      const fav = `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(origin)}&size=64`;
      result = await imageDataUri(fav);
    }
  }
  cache.set(key, result);
  return result;
}
