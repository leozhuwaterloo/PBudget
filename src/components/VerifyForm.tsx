"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import ResendButton from "@/components/ResendButton";

export default function VerifyForm() {
  const router = useRouter();
  const t = useT();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || t("common.genericError"));
      return;
    }
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <form onSubmit={submit} style={{ marginTop: 16 }}>
      <label htmlFor="code">{t("verify.codeLabel")}</label>
      <input
        id="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        style={{ letterSpacing: "8px", fontSize: 24, textAlign: "center" }}
        required
        autoFocus
      />
      {error && <div className="error">{error}</div>}
      <button
        className="btn btn-primary"
        style={{ marginTop: 16, width: "100%" }}
        disabled={busy || code.length !== 6}
      >
        {busy ? "…" : t("verify.submit")}
      </button>
      <div style={{ marginTop: 12 }}>
        <ResendButton />
      </div>
    </form>
  );
}
