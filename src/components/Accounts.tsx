"use client";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PlaidOpener from "./PlaidOpener";
import { VendorIcon } from "./VendorIcon";
import TransactionBrowser from "./TransactionBrowser";
import { useT } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n";
import type { UpgradeCTA } from "@/lib/stripe";

type AccountLite = {
  accountId: string;
  name: string;
  current: number | null;
  currency: string | null;
  transactionCount: number;
};
type ItemLite = {
  itemId: string;
  institutionName: string;
  institutionLogo: string | null;
  lastUpdated: string;
  syncAllowed: boolean;
  accounts: AccountLite[];
};
type Connect = { canAdd: boolean; cta: UpgradeCTA | null };

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function InstitutionLogo({ logo, name }: { logo: string | null; name: string }) {
  if (logo) {
    const src = logo.startsWith("http") || logo.startsWith("data:") ? logo : `data:image/png;base64,${logo}`;
    return <img src={src} alt="" width={28} height={28} style={{ borderRadius: 6, objectFit: "contain" }} />;
  }
  return <VendorIcon icon={null} name={name} size={28} />;
}

export default function Accounts({
  items,
  connect,
  plan,
  limit,
  locale,
}: {
  items: ItemLite[];
  connect: Connect;
  plan: string;
  limit: number;
  locale: Locale;
}) {
  const router = useRouter();
  const t = useT();
  const [connectToken, setConnectToken] = useState<string | null>(null);
  const [reauth, setReauth] = useState<{ itemId: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openAccount, setOpenAccount] = useState<string | null>(null);
  // A limit hit surfaced from a live 402 (defensive — the server pre-computes the
  // CTA, so the button is already replaced when at the limit).
  const [limitHit, setLimitHit] = useState<UpgradeCTA | null>(connect.cta);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const startConnect = () =>
    run(async () => {
      const res = await fetch("/api/plaid/link-token", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 402) return setLimitHit(data as UpgradeCTA);
      if (!res.ok) throw new Error(data.error || "Request failed");
      setConnectToken(data.link_token);
    });

  const startReauth = (itemId: string) =>
    run(async () => {
      const { link_token } = await postJson("/api/plaid/link-token-update", { item_id: itemId });
      setReauth({ itemId, token: link_token });
    });

  const sync = (itemId: string) =>
    run(async () => {
      await postJson("/api/plaid/item/sync", { item_id: itemId });
      router.refresh();
    });

  const cta = limitHit && (
    <div className="banner">
      <strong>{t("accounts.limitTitle")}</strong>{" "}
      {t("accounts.limitBody", { used: limitHit.used, limit: limitHit.limit, plan: limitHit.plan })}
      <div style={{ marginTop: 10 }}>
        <Link className="btn btn-primary" href="/customizations">
          {t("accounts.upgrade")}
        </Link>
      </div>
    </div>
  );

  return (
    <div>
      <h1>{t("accounts.title")}</h1>
      <p className="muted">{t("accounts.subtitle")}</p>

      {error && <div className="error">{error}</div>}
      {cta}

      {items.length === 0 && <p className="muted">{t("accounts.noBanks")}</p>}

      {items.map((it) => (
        <div className="card" key={it.itemId}>
          <div className="row wrap" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <div className="row" style={{ gap: 10 }}>
              <InstitutionLogo logo={it.institutionLogo} name={it.institutionName} />
              <div>
                <div className="card-header" style={{ margin: 0 }}>{it.institutionName}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {t("accounts.lastUpdated")} {new Date(it.lastUpdated).toLocaleString()}
                </div>
              </div>
            </div>
            <div className="row wrap">
              <button
                className="btn btn-sm"
                disabled={busy || !it.syncAllowed}
                title={it.syncAllowed ? undefined : t("accounts.syncBlocked", { limit })}
                onClick={() => sync(it.itemId)}
              >
                {t("accounts.sync")}
              </button>
              <button className="btn btn-sm" disabled={busy} onClick={() => startReauth(it.itemId)}>
                {t("accounts.reauth")}
              </button>
            </div>
          </div>

          {!it.syncAllowed && (
            <p className="muted" style={{ marginTop: 0 }}>
              ⚠ {t("accounts.syncBlocked", { limit })}{" "}
              <Link href="/customizations">{t("accounts.upgrade")}</Link>
            </p>
          )}

          <table>
            <thead>
              <tr>
                <th>{t("accounts.colAccount")}</th>
                <th>{t("accounts.colCurrent")}</th>
                <th>{t("accounts.colTxns")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {it.accounts.map((a) => {
                const open = openAccount === a.accountId;
                return (
                  <Fragment key={a.accountId}>
                    <tr>
                      <td>{a.name}</td>
                      <td>{a.current == null ? "" : `${a.currency ?? ""} ${a.current.toFixed(2)}`.trim()}</td>
                      <td>{a.transactionCount}</td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          className="btn btn-sm"
                          onClick={() => setOpenAccount(open ? null : a.accountId)}
                        >
                          {open ? t("accounts.hide") : t("accounts.browse")}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={4} style={{ background: "var(--bg)" }}>
                          <TransactionBrowser accountId={a.accountId} locale={locale} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      <button
        className="btn btn-primary"
        onClick={connect.canAdd && !limitHit ? startConnect : () => setLimitHit(connect.cta ?? limitHit)}
        disabled={busy}
      >
        {t("accounts.connect")}
      </button>

      {connectToken && (
        <PlaidOpener
          token={connectToken}
          onExit={() => setConnectToken(null)}
          onSuccess={(publicToken) =>
            run(async () => {
              setConnectToken(null);
              await postJson("/api/plaid/item/update", { public_token: publicToken });
              router.refresh();
            })
          }
        />
      )}

      {reauth && (
        <PlaidOpener
          token={reauth.token}
          onExit={() => setReauth(null)}
          onSuccess={() =>
            run(async () => {
              const itemId = reauth.itemId;
              setReauth(null);
              await postJson("/api/plaid/item/sync", { item_id: itemId });
              router.refresh();
            })
          }
        />
      )}
    </div>
  );
}
