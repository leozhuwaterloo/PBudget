"use client";
import Link from "next/link";
import { useT } from "@/lib/i18n/context";

// Terms & liability. Linked from the signup consent checkbox and the footer.
export default function TermsPage() {
  const t = useT();
  return (
    <div className="card" style={{ maxWidth: 680, margin: "0 auto" }}>
      <h1>{t("terms.title")}</h1>
      <p>{t("terms.p1")}</p>
      <p><strong>{t("terms.p2")}</strong></p>
      <p>{t("terms.p3")}</p>
      <p className="muted" style={{ marginTop: 20 }}>
        <Link href="/signup">{t("terms.back")}</Link>
      </p>
    </div>
  );
}
