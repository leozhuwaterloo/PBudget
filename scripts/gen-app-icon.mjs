// Generates PlaidBudget's app icon + splash source art from the brand palette
// (ledger green on cool paper — see src/app/globals.css). @capacitor/assets
// expands resources/icon.png + these splashes into every Android/iOS density.
// Run once; re-run only if the palette/icon changes. sharp ships transitively
// via @capacitor/assets.
import sharp from "sharp";

const GREEN = "#15684a";   // --primary (ledger green): app-icon field
const PAPER = "#e9ebe5";   // --bg (cool paper): splash field
const ICON = 1024;         // real app-icon source size
const SPLASH = 2732;       // @capacitor/assets source splash size
const TILE = 1000;         // icon size centered on the splash field
const RADIUS = Math.round(TILE * 0.22);   // iOS-ish rounded square

// 1024² placeholder app icon: white serif "P" on the ledger-green field.
const icon = await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON}" height="${ICON}">
       <rect width="${ICON}" height="${ICON}" fill="${GREEN}"/>
       <text x="50%" y="52%" text-anchor="middle" dominant-baseline="central"
             font-family="Georgia, 'Times New Roman', serif" font-weight="600"
             font-size="680" fill="#ffffff">P</text>
     </svg>`,
  ),
).png().toBuffer();
await sharp(icon).toFile("resources/icon.png");
console.log("wrote resources/icon.png");

// Round the icon's corners so it reads as an app tile on the paper field.
const rounded = await sharp(icon)
  .resize(TILE, TILE)
  .composite([{
    input: Buffer.from(
      `<svg width="${TILE}" height="${TILE}"><rect width="${TILE}" height="${TILE}" rx="${RADIUS}" ry="${RADIUS}"/></svg>`,
    ),
    blend: "dest-in",
  }])
  .png()
  .toBuffer();

const splash = () =>
  sharp({ create: { width: SPLASH, height: SPLASH, channels: 4, background: PAPER } })
    .composite([{ input: rounded, gravity: "center" }])
    .png();

// light + dark are identical: the paper field suits both.
for (const f of ["resources/splash.png", "resources/splash-dark.png"]) {
  await splash().toFile(f);
  console.log("wrote", f);
}
