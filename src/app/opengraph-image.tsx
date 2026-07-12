import { ImageResponse } from "next/og";

// Social/share card (also used as the Twitter image fallback). Rendered from
// JSX by next/og — no static asset to maintain. Text is ASCII/Latin only: any
// other glyph makes next/og fetch a Google font at render time, which fails in
// the offline pod. satori also requires display:flex on any element with >1 child.
export const runtime = "nodejs";
export const alt = "PBudget — the personal budget ledger that balances itself";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const green = "#12b981";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0b1f17",
          color: "#e9f5ef",
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Wordmark: three ascending bars + name */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 44 }}>
            <div style={{ width: 12, height: 20, background: green, borderRadius: 3 }} />
            <div style={{ width: 12, height: 34, background: green, borderRadius: 3 }} />
            <div style={{ width: 12, height: 44, background: green, borderRadius: 3 }} />
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>PBudget</div>
        </div>

        {/* Headline (column so each colored line is a single text child) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 76, fontWeight: 800, lineHeight: 1.06, letterSpacing: -2 }}>
            <div>The ledger that</div>
            <div style={{ color: green }}>balances itself.</div>
          </div>
          <div style={{ fontSize: 30, color: "#a9c7ba", lineHeight: 1.3, maxWidth: 940 }}>
            Link your banks through Plaid — PBudget categorizes, merges, and reconciles every transaction into a monthly budget you can trust.
          </div>
        </div>

        {/* Footer: tagline + reconciled proof */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 26 }}>
          <div style={{ color: "#7fa695" }}>Automated personal bookkeeping · English &amp; Chinese</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ color: green, fontWeight: 700 }}>+1,352.65</div>
            <div style={{ color: "#7fa695" }}>Reconciled</div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
