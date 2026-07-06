"use client";
import React from "react";
import { letterAvatar } from "@/lib/catalog/icons";

// A vendor's icon. When we have a cached favicon (a data URI stored on the vendor;
// see lib/favicon), it renders bare — no background circle. Otherwise a deterministic
// letter avatar (first letter + a hue from the name). With a link the whole icon is a
// clickable anchor that opens the site/map in a new tab; pass clickable={false} when
// it sits inside another button (e.g. the catalog picker), where a nested <a> is invalid.
export function VendorIcon({
  name,
  link = null,
  icon = null,
  size = 28,
  clickable = true,
}: {
  name: string;
  link?: string | null;
  icon?: string | null;
  size?: number;
  clickable?: boolean;
}) {
  const { letter, hue } = letterAvatar(name || "?");

  const glyph = icon ? (
    <img
      src={icon}
      alt=""
      width={size}
      height={size}
      style={{ display: "block", flex: `0 0 ${size}px`, borderRadius: 4, objectFit: "contain" }}
    />
  ) : (
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

  if (link && clickable) {
    return (
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        title={name}
        onClick={(e) => e.stopPropagation()}
        style={{ display: "inline-flex", flex: `0 0 ${size}px`, lineHeight: 0, textDecoration: "none" }}
      >
        {glyph}
      </a>
    );
  }
  return glyph;
}
