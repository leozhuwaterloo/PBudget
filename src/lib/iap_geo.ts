// Client-safe (no crypto/prisma imports, so it's bundleable into the browser).
// Whether the native billing UI may surface a link to the (cheaper) web billing
// page. Anti-steering compliance: iOS only in the US storefront (Epic v. Apple 2025
// struck the US anti-steering rule; Apple still forbids steering elsewhere). Android:
// broadly allowed. StoreKit reports the storefront as a 3-letter ISO code ("USA");
// accept "US" too. Unknown storefront on iOS => hide (safe default).
export function showWebLink(platform: "ios" | "android", storefrontCountry: string | null): boolean {
  if (platform === "android") return true;
  return storefrontCountry === "USA" || storefrontCountry === "US";
}
