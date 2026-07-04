"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useT } from "@/lib/i18n/context";

export default function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const t = useT();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || t("common.genericError"));
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <div className="auth card">
        <h1>{t("reset.doneTitle")}</h1>
        <p className="muted">{t("reset.doneBody")}</p>
        <Link className="btn btn-primary" style={{ marginTop: 16 }} href="/login">
          {t("nav.login")}
        </Link>
      </div>
    );
  }

  return (
    <form className="auth card" onSubmit={submit}>
      <h1>{t("reset.title")}</h1>
      <label htmlFor="password">{t("reset.newPassword")}</label>
      <input
        id="password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <div className="error">{error}</div>}
      <button className="btn btn-primary" style={{ marginTop: 16, width: "100%" }} disabled={busy}>
        {busy ? "…" : t("reset.submit")}
      </button>
    </form>
  );
}
