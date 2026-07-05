"use client";
import React from "react";
import { letterAvatar } from "@/lib/catalog/icons";

// A deterministic letter avatar for a vendor (first letter + a hue from the name).
// Brand-icon glyphs were retired when vendors moved from icons to links.
export function VendorIcon({ name, size = 28 }: { name: string; size?: number }) {
  const { letter, hue } = letterAvatar(name || "?");
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        background: `hsl(${hue} 42% 88%)`,
        color: `hsl(${hue} 50% 32%)`,
        fontWeight: 600,
        fontSize: size * 0.44,
      }}
    >
      {letter}
    </span>
  );
}

// True for Google-Maps-style URLs (📍); everything else is treated as a website (🌐).
function isMapLink(url: string): boolean {
  return /google\.[^/]*\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(url);
}

// A vendor's link affordance: 📍 for a Google Maps entry (local vendor), 🌐 for a
// website (online). Renders nothing when the vendor has no link. stopPropagation so
// clicking it inside a clickable card/row doesn't also trigger the card.
export function VendorLink({ link, size = 14 }: { link: string | null; size?: number }) {
  if (!link) return null;
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      title={link}
      onClick={(e) => e.stopPropagation()}
      style={{ fontSize: size, textDecoration: "none", lineHeight: 1 }}
    >
      {isMapLink(link) ? "📍" : "🌐"}
    </a>
  );
}
