"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";

// F11 billing section, fills the slot F9 left in /customizations. Shows the
// current tier + live connection usage + the tier table. First subscription goes
// through Stripe Checkout (only when there's no active subscription — Checkout
// can't modify one); tier switches / cancel / payment go through the billing portal.

type Plan = "free" | "pro" | "max";
type Summary = {
  plan: Plan;
  used: number;
  limit: number; // -1 = unlimited (admin)
  admin: boolean;
  active: boolean;
  hasCustomer: boolean;
  onTrial: boolean;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  tiers: { id: Plan; price: number; limit: number }[];
};

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function BillingSection() {
  const t = useT();
  const [s, setS] = useState<Summary | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<"success" | "cancelled" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch("/api/billing")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setS)
      .catch(() => setLoadError(true));
    // post-Checkout round-trip lands here as ?billing=success|cancelled
    const b = new URLSearchParams(window.location.search).get("billing");
    if (b === "success" || b === "cancelled") setFlash(b);
  }, []);

  const go = (url: string, body?: unknown) => async () => {
    setBusy(true);
    setError("");
    try {
      const { url: redirect } = await postJson(url, body);
      window.location.href = redirect;
    } catch (e: any) {
      setError(e?.message || t("cust.billing.error"));
      setBusy(false);
    }
  };

  const onDelete = async () => {
    setDeleting(true);
    setError("");
    try {
      await postJson("/api/auth/delete");
      window.location.href = "/"; // full reload — clears all authed client state
    } catch (e: any) {
      setError(e?.message || t("cust.billing.error"));
      setDeleting(false);
    }
  };

  if (loadError) return <p className="error">{t("cust.billing.loadFailed")}</p>;
  if (!s) return <p className="muted">{t("common.loading")}</p>;

  const planName = (id: Plan) => t(`cust.billing.plan.${id}`);

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>{t("cust.billing.help")}</p>

      {flash && (
        <div className="banner row" style={{ justifyContent: "space-between" }}>
          <span>{t(`cust.billing.${flash}`)}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setFlash(null)}>✕</button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div>{t("cust.billing.currentPlan")}: <strong>{planName(s.plan)}</strong></div>
        <div className="muted" style={{ marginTop: 4 }}>
          {t("cust.billing.usage", { used: s.used, limit: s.limit < 0 ? "∞" : s.limit })}
        </div>
        {s.admin && <div style={{ marginTop: 4 }}>{t("cust.billing.admin")}</div>}
        {s.onTrial && (
          <div style={{ marginTop: 4 }}>{t("cust.billing.trial", { days: s.trialDaysLeft ?? 0 })}</div>
        )}
        {!s.admin && !s.active && !s.onTrial && (
          <div className="error" style={{ marginTop: 4 }}>{t("cust.billing.trialEnded")}</div>
        )}
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>{t("cust.billing.colPlan")}</th>
            <th style={{ textAlign: "left" }}>{t("cust.billing.colPrice")}</th>
            <th style={{ textAlign: "left" }}>{t("cust.billing.colConnections")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {s.tiers.map((tier) => (
            <tr key={tier.id}>
              <td>{planName(tier.id)}</td>
              <td>{tier.price === 0 ? t("cust.billing.priceFree") : t("cust.billing.perMonth", { price: tier.price })}</td>
              <td>{tier.limit}</td>
              <td style={{ textAlign: "right" }}>
                {tier.id === s.plan ? (
                  <span className="muted">{t("cust.billing.current")}</span>
                ) : tier.id !== "free" && !s.active && !s.admin ? (
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={busy}
                    onClick={go("/api/stripe/checkout", { tier: tier.id })}
                  >
                    {t("cust.billing.subscribe")}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {s.hasCustomer && (
        <div style={{ marginTop: 16 }}>
          <button className="btn" disabled={busy} onClick={go("/api/stripe/portal")}>
            {t("cust.billing.manage")}
          </button>
          <p className="muted" style={{ marginTop: 6 }}>{t("cust.billing.manageHelp")}</p>
        </div>
      )}

      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

      <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        {!confirmDelete ? (
          <button className="btn btn-sm" style={{ color: "var(--danger)" }} onClick={() => setConfirmDelete(true)}>
            {t("cust.delete.button")}
          </button>
        ) : (
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="error" style={{ margin: 0 }}>{t("cust.delete.confirm")}</span>
            <button
              className="btn btn-sm"
              style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
              disabled={deleting}
              onClick={onDelete}
            >
              {deleting ? t("cust.delete.deleting") : t("cust.delete.confirmBtn")}
            </button>
            <button className="btn btn-sm btn-ghost" disabled={deleting} onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </button>
          </div>
        )}
        <p className="muted" style={{ marginTop: 6 }}>{t("cust.delete.help")}</p>
      </div>
    </div>
  );
}
