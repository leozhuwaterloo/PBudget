"use client";
import Link from "next/link";
import { useT } from "@/lib/i18n/context";

// Privacy policy — required by Plaid's production terms (we handle bank data).
// Linked from the landing footer; mirrors the terms page layout.
const SECTIONS = ["collect", "third", "store", "control", "contact"] as const;

export default function PrivacyPage() {
  const t = useT();
  return (
    <div className="card" style={{ maxWidth: 680, margin: "0 auto" }}>
      <h1>{t("privacy.title")}</h1>
      <p className="muted">{t("privacy.updated")}</p>
      <p>{t("privacy.intro")}</p>
      {SECTIONS.map((s) => (
        <div key={s}>
          <h2 style={{ fontSize: 18, marginTop: 20 }}>{t(`privacy.${s}Title`)}</h2>
          <p>{t(`privacy.${s}Body`)}</p>
        </div>
      ))}
      <p className="muted" style={{ marginTop: 24 }}>
        <Link href="/">{t("privacy.back")}</Link>
      </p>
    </div>
  );
}
