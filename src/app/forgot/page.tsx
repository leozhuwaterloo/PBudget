"use client";
import { useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/context";

export default function ForgotPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    setSent(true); // always show the same message — no account enumeration
  };

  if (sent) {
    return (
      <div className="auth card">
        <h1>{t("forgot.sentTitle")}</h1>
        <p className="muted">{t("forgot.sentBody")}</p>
        <p className="muted" style={{ marginTop: 16 }}>
          <Link href="/login">{t("nav.login")}</Link>
        </p>
      </div>
    );
  }

  return (
    <form className="auth card" onSubmit={submit}>
      <h1>{t("forgot.title")}</h1>
      <p className="muted">{t("forgot.body")}</p>
      <label htmlFor="email">{t("auth.email")}</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <button className="btn btn-primary" style={{ marginTop: 16, width: "100%" }} disabled={busy}>
        {busy ? "…" : t("forgot.submit")}
      </button>
      <p className="muted" style={{ marginTop: 16 }}>
        <Link href="/login">{t("nav.login")}</Link>
      </p>
    </form>
  );
}
