"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useT } from "@/lib/i18n/context";

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || t("common.genericError"));
      return;
    }
    router.push(mode === "signup" ? "/verify" : "/dashboard");
    router.refresh();
  };

  return (
    <form className="auth card" onSubmit={submit}>
      <h1>{mode === "signup" ? t("auth.signupTitle") : t("auth.loginTitle")}</h1>
      <label htmlFor="email">{t("auth.email")}</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <label htmlFor="password">{t("auth.password")}</label>
      <input
        id="password"
        type="password"
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <div className="error">{error}</div>}
      <button className="btn btn-primary" style={{ marginTop: 16, width: "100%" }} disabled={busy}>
        {busy ? "…" : mode === "signup" ? t("nav.signup") : t("nav.login")}
      </button>
      <p className="muted" style={{ marginTop: 16 }}>
        {mode === "signup" ? (
          <>{t("auth.haveAccount")} <Link href="/login">{t("nav.login")}</Link></>
        ) : (
          <>{t("auth.newHere")} <Link href="/signup">{t("auth.createAccount")}</Link></>
        )}
      </p>
    </form>
  );
}
