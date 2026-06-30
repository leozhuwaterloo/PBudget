"use client";
import { useState } from "react";

export default function ResendButton() {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ marginTop: 12 }}>
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await fetch("/api/auth/resend", { method: "POST" });
          setBusy(false);
          setMsg(res.ok ? "Verification email sent." : "Could not send — are you logged in?");
        }}
      >
        Resend verification email
      </button>
      {msg && <p className="muted">{msg}</p>}
    </div>
  );
}
