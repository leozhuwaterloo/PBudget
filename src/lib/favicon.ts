// Vendor favicons, fetched ONCE server-side and stored as a data URI on the vendor
// row (the deprecated-but-kept `Vendor.icon` column), so the client never live-fetches
// a third party on render. Best-effort: a map link, bad host, timeout, or non-2xx
// yields null and the UI falls back to a letter avatar.
//
// ponytail: Google's s2 favicon service (no key). Ceilings: (1) depends on Google;
// (2) in-process cache only — swap for a shared table if this ever runs hot;
// (3) 2.5s timeout so a slow Google can't wedge a vendor save.

// True for Google-Maps-style URLs (no favicon); everything else is a website.
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

const cache = new Map<string, string | null>(); // host → data URI (or null miss)

export async function faviconDataUri(link: string | null): Promise<string | null> {
  if (!link || isMapLink(link)) return null;
  const host = hostOf(link);
  if (!host) return null;
  if (cache.has(host)) return cache.get(host)!;

  let result: string | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`https://www.google.com/s2/favicons?domain=${host}&sz=64`, {
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const type = res.headers.get("content-type") || "image/png";
      if (buf.length > 0) result = `data:${type};base64,${buf.toString("base64")}`;
    }
  } catch {
    // best-effort — leave null, UI falls back to the letter avatar
  }
  cache.set(host, result);
  return result;
}
