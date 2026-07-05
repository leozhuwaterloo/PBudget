"use client";
import React, { useState } from "react";
import { getBrandIcon, letterAvatar, ICON_SLUGS } from "@/lib/catalog/icons";
import { useT } from "@/lib/i18n/context";

// Render a vendor's icon (F10): a bundled brand glyph (monochrome, currentColor)
// or a deterministic letter avatar when there's no slug. Reuses F4's icon library.
export function VendorIcon({ icon, name, size = 28 }: { icon: string | null; name: string; size?: number }) {
  const brand = getBrandIcon(icon);
  const box: React.CSSProperties = {
    display: "inline-flex",
    width: size,
    height: size,
    flex: `0 0 ${size}px`,
    alignItems: "center",
    justifyContent: "center",
  };
  if (brand) {
    return (
      <span title={brand.title} style={{ ...box, color: "var(--fg)" }}>
        <svg viewBox="0 0 24 24" width={size * 0.82} height={size * 0.82} aria-hidden="true">
          <path d={brand.path} fill="currentColor" />
        </svg>
      </span>
    );
  }
  const { letter, hue } = letterAvatar(name || "?");
  return (
    <span
      aria-hidden="true"
      style={{
        ...box,
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

// Icon picker: current icon as a button; click opens a searchable grid of every
// bundled slug plus a "letter avatar" (null) option. `name` drives the avatar preview.
export function IconPicker({
  value,
  name,
  onChange,
}: {
  value: string | null;
  name: string;
  onChange: (icon: string | null) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const slugs = query ? ICON_SLUGS.filter((s) => s.includes(query)) : ICON_SLUGS;

  const pick = (icon: string | null) => {
    onChange(icon);
    setOpen(false);
    setQ("");
  };

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="btn"
        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <VendorIcon icon={value} name={name} size={24} />
        <span className="muted" style={{ fontSize: 12 }}>{t("cust.vendors.iconChange")}</span>
      </button>
      {open && (
        <div
          className="card"
          style={{
            position: "absolute",
            zIndex: 20,
            top: "calc(100% + 6px)",
            left: 0,
            width: 300,
            maxHeight: 320,
            overflowY: "auto",
            margin: 0,
            padding: 12,
          }}
        >
          <input
            autoFocus
            placeholder={t("cust.vendors.iconSearch")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <button
            type="button"
            className="btn btn-sm"
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginBottom: 10 }}
            onClick={() => pick(null)}
          >
            <VendorIcon icon={null} name={name} size={22} />
            {t("cust.vendors.iconLetter")}
          </button>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4 }}>
            {slugs.map((s) => (
              <button
                key={s}
                type="button"
                title={getBrandIcon(s)?.title ?? s}
                onClick={() => pick(s)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 6,
                  cursor: "pointer",
                  border: `1px solid ${value === s ? "var(--primary)" : "transparent"}`,
                  borderRadius: 6,
                  background: value === s ? "var(--bg-3)" : "transparent",
                }}
              >
                <VendorIcon icon={s} name={s} size={22} />
              </button>
            ))}
            {slugs.length === 0 && <p className="muted" style={{ gridColumn: "1 / -1", margin: 4 }}>{t("cust.vendors.iconNone")}</p>}
          </div>
        </div>
      )}
    </span>
  );
}
