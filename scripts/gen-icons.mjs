// One-shot dev generator: extract single-path brand SVGs from the (dev-only,
// --no-save) simple-icons package into a checked-in TS module. Run once; the
// output is committed so runtime never touches node_modules or the network.
import { readFileSync, writeFileSync } from "node:fs";

const ICON_DIR = "node_modules/simple-icons/icons";
// simple-icons filename slugs to bundle. Catalog merchants use the ones present;
// the rest enrich F10's reusable icon picker.
const SLUGS = [
  "ikea", "steam", "ubereats", "aircanada", "starbucks", "mcdonalds", "apple",
  "uniqlo", "adidas", "paypal", "groupon", "airchina", "tripdotcom", "alipay",
  "taobao", "applepay", "googleplay", "playstation", "samsung", "honda",
  "cocacola", "target", "hsbc", "wise", "revolut", "lidl",
];

const entries = [];
for (const slug of SLUGS) {
  let svg;
  try {
    svg = readFileSync(`${ICON_DIR}/${slug}.svg`, "utf8");
  } catch {
    console.warn("skip (missing):", slug);
    continue;
  }
  const path = svg.match(/ d="([^"]+)"/)?.[1];
  const title = svg.match(/<title>([^<]+)<\/title>/)?.[1] ?? slug;
  if (!path) { console.warn("skip (no path):", slug); continue; }
  entries.push({ slug, title, path });
}

const body = entries
  .map((e) => `  ${JSON.stringify(e.slug)}: { title: ${JSON.stringify(e.title)}, path: ${JSON.stringify(e.path)} },`)
  .join("\n");

const out = `// AUTO-GENERATED — do not edit by hand. Regenerate with scripts/gen-icons.mjs.
// Brand icon path data extracted from simple-icons (https://simpleicons.org),
// licensed CC0 1.0. Single 24x24 path, rendered monochrome via currentColor so it
// works in both light and dark themes. Bundled at build time — NO runtime fetch.
export type BrandIcon = { title: string; path: string };
export const BRAND_ICONS: Record<string, BrandIcon> = {
${body}
};
`;
writeFileSync("src/lib/catalog/icons.generated.ts", out);
console.log(`wrote ${entries.length} icons ->`, entries.map((e) => e.slug).join(", "));
