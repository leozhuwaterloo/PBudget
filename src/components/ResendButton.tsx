"use client";
import { useState } from "react";
import { useT } from "@/lib/i18n/context";

export default function ResendButton() {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const t = useT();
  return (
    <div style={{ marginTop: 12 }}>
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await fetch("/api/auth/resend", { method: "POST" });
          setBusy(false);
          setMsg(res.ok ? t("resend.sent") : t("resend.failed"));
        }}
      >
        {t("resend.button")}
      </button>
      {msg && <p className="muted">{msg}</p>}
    </div>
  );
}
