// Vendor icons, fetched ONCE server-side and stored as a data URI on the vendor row
// (the kept-but-unused `Vendor.icon` column), so the client never live-fetches a
// third party on render. Best-effort: any failure yields null and the UI falls back
// to a letter avatar.
//
// - Website link → the site's favicon (Google's s2 service, no key).
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
    result = await imageDataUri(`https://www.google.com/s2/favicons?domain=${hostOf(link)}&sz=64`);
  }
  cache.set(key, result);
  return result;
}
