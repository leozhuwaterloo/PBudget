"use client";
import React, { useState } from "react";
import { useT } from "@/lib/i18n/context";

// Bottom-of-rail badge: the user's own id — their sharing handle for the community
// vendor catalog (others filter to it to find your shared rules). Click to copy.
export default function UserIdBadge({ id }: { id: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const short = id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked (insecure context / denied) — no-op */
    }
  }

  return (
    <button type="button" className="userid-badge" onClick={copy} title={t("nav.copyId")}>
      <span className="userid-label">{t("nav.yourId")}</span>
      <span className="userid-value">{copied ? t("nav.copied") : short}</span>
    </button>
  );
}
