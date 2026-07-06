"use client";
import React from "react";
import { letterAvatar } from "@/lib/catalog/icons";

// Local copy of favicon.ts's map-link test — kept inline so this client component
// doesn't pull the server-only favicon module (Buffer/fetch) into the browser bundle.
const isMapLink = (url: string) => /google\.[^/]*\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(url);

// A vendor's icon. With a cached favicon (a data URI stored on the vendor; see
// lib/favicon) it renders bare — no circle — and the favicon itself is the clickable
// link. Without one, a deterministic letter avatar (first letter + a hue from the
// name); if the vendor still has a link, it's shown as a SEPARATE 📍/🌐 button next
// to the avatar (like before favicons), since a plain letter doesn't read as a link.
// Pass clickable={false} when it sits inside another button (catalog picker), where a
// nested <a> is invalid — then no link is rendered.
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

  const avatar = icon ? (
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

  // Favicon present → the icon is the link.
  if (icon && link && clickable) {
    return (
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        title={name}
        onClick={(e) => e.stopPropagation()}
        style={{ display: "inline-flex", flex: `0 0 ${size}px`, lineHeight: 0, textDecoration: "none" }}
      >
        {avatar}
      </a>
    );
  }

  // No favicon but a link → decorative avatar + a separate 📍/🌐 link button.
  if (!icon && link && clickable) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {avatar}
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          title={link}
          onClick={(e) => e.stopPropagation()}
          style={{ fontSize: Math.max(12, Math.round(size * 0.5)), lineHeight: 1, textDecoration: "none" }}
        >
          {isMapLink(link) ? "📍" : "🌐"}
        </a>
      </span>
    );
  }

  return avatar;
}
