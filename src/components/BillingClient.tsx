"use client";
import { useState } from "react";

async function postJson(url: string) {
  const res = await fetch(url, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function BillingClient({
  active,
  hasCustomer,
}: {
  active: boolean;
  hasCustomer: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const go = (url: string) => async () => {
    setBusy(true);
    setError("");
    try {
      const { url: redirectUrl } = await postJson(url);
      window.location.href = redirectUrl;
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="row wrap" style={{ marginTop: 12 }}>
      {!active && (
        <button className="btn btn-primary" disabled={busy} onClick={go("/api/stripe/checkout")}>
          Subscribe
        </button>
      )}
      {hasCustomer && (
        <button className="btn" disabled={busy} onClick={go("/api/stripe/portal")}>
          Manage billing
        </button>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
