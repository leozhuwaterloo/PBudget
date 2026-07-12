"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { showWebLink } from "@/lib/iap_geo";

// Native store-IAP billing UI (iOS StoreKit / Google Play Billing). Renders ONLY in
// the Capacitor app; the web keeps Stripe (BillingSection swaps by platform). Apple
// & Google mandate their own billing for in-app subscriptions, so this path uses the
// store and hands the receipt to /api/iap/verify for SELF-HOSTED validation.
//
// Uses cordova-plugin-purchase (Fovea) via its injected global `window.CdvPurchase`
// (added to package.json; bundled into the native app by `cap sync`). Everything is
// guarded: no plugin / not configured => dormant fallback (web-billing link only).
//
// NOTE: the on-device purchase glue (product load, receipt fields) is verifiable only
// on a real device against real store products — it cannot run in CI/web. The SECURITY
// boundary (receipt verification) is entirely server-side and is what the check covers.

type Tier = "pro" | "max";
type IapConfig = { enabled: boolean; products: { pro: string; max: string } | null; webUrl: string };
type Product = { tier: Tier; id: string; price: string };

// Minimal shape of the cordova-plugin-purchase global we touch (avoids importing the
// package into the web bundle; the native shell injects it at runtime).
type CdvStore = any;
function getStore(): CdvStore | null {
  const g = (typeof window !== "undefined" ? (window as any).CdvPurchase : undefined) as any;
  return g?.store ?? null;
}

export default function NativeBilling({
  platform,
  iap,
  currentPlan,
  active,
  onGranted,
}: {
  platform: "ios" | "android";
  iap: IapConfig;
  currentPlan: string;
  active: boolean;
  onGranted: () => void;
}) {
  const t = useT();
  const [products, setProducts] = useState<Product[]>([]);
  const [busy, setBusy] = useState<Tier | null>(null);
  const [error, setError] = useState("");
  // Storefront country drives the geo-gated web link (iOS: US only). null until read.
  const [storefront, setStorefront] = useState<string | null>(null);
  const inited = useRef(false);

  useEffect(() => {
    if (inited.current || !iap.enabled || !iap.products) return;
    const store = getStore();
    if (!store) return; // plugin absent (older build / web) — dormant fallback below
    inited.current = true;
    const P = (window as any).CdvPurchase;
    const tiers: Product[] = [
      { tier: "pro", id: iap.products.pro, price: "" },
      { tier: "max", id: iap.products.max, price: "" },
    ];
    const storePlatform = platform === "ios" ? P.Platform.APPLE_APPSTORE : P.Platform.GOOGLE_PLAY;

    store.register(
      tiers.map((p) => ({ id: p.id, type: P.ProductType.PAID_SUBSCRIPTION, platform: storePlatform }))
    );

    // Self-hosted validation: hand the store receipt to our server before finishing.
    // token = the SK2 signed-transaction JWS (iOS) / the Play purchase token (Android).
    store.validator = (receipt: any, callback: (r: any) => void) => {
      const productId = receipt?.id ?? receipt?.transaction?.products?.[0]?.id;
      const token =
        platform === "ios"
          ? receipt?.transaction?.jwsRepresentation ?? receipt?.transaction?.appStoreReceipt
          : receipt?.transaction?.purchaseToken ?? receipt?.purchaseToken;
      fetch("/api/iap/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform, productId, token }),
      })
        .then((r) => r.json())
        .then((d) => callback(d?.ok ? { ok: true } : { ok: false, code: P.ErrorCode?.VALIDATOR_SUBSCRIPTION_EXPIRED }))
        .catch(() => callback({ ok: false }));
    };

    store
      .when()
      .productUpdated(() => {
        setProducts(
          tiers.map((p) => ({ ...p, price: store.get(p.id, storePlatform)?.pricing?.price ?? "" }))
        );
      })
      .approved((tx: any) => tx.verify())
      .verified((r: any) => {
        r.finish();
        onGranted();
      });

    store.initialize([storePlatform]).then(() => {
      // StoreKit exposes the storefront country (3-letter ISO); Play doesn't gate.
      try {
        setStorefront(store.getStorefront?.()?.countryCode ?? P.AppleAppStore?.storefront?.countryCode ?? null);
      } catch {
        setStorefront(null);
      }
    });
  }, [iap, platform, onGranted]);

  const buy = (tier: Tier) => async () => {
    setError("");
    setBusy(tier);
    try {
      const store = getStore();
      const P = (window as any).CdvPurchase;
      const storePlatform = platform === "ios" ? P.Platform.APPLE_APPSTORE : P.Platform.GOOGLE_PLAY;
      const id = tier === "pro" ? iap.products!.pro : iap.products!.max;
      const offer = store.get(id, storePlatform)?.getOffer();
      if (!offer) throw new Error("offer unavailable");
      await store.order(offer);
    } catch {
      setError(t("cust.billing.iap.error"));
    } finally {
      setBusy(null);
    }
  };

  const webLink = showWebLink(platform, storefront) ? (
    <p className="muted" style={{ marginTop: 12 }}>
      <a href={iap.webUrl}>{t("cust.billing.iap.webLink")}</a>
    </p>
  ) : null;

  // Dormant / plugin absent: no purchase UI, just the web-billing link.
  if (!iap.enabled || !getStore()) {
    return (
      <div>
        <p className="muted" style={{ marginTop: 0 }}>{t("cust.billing.iap.unavailable")}</p>
        {webLink}
      </div>
    );
  }

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>{t("cust.billing.iap.help")}</p>
      <table>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td>{t(`cust.billing.plan.${p.tier}`)}</td>
              <td>{p.price || "—"}</td>
              <td style={{ textAlign: "right" }}>
                {active && currentPlan === p.tier ? (
                  <span className="muted">{t("cust.billing.current")}</span>
                ) : (
                  <button className="btn btn-sm btn-primary" disabled={busy !== null} onClick={buy(p.tier)}>
                    {busy === p.tier ? t("common.loading") : t("cust.billing.subscribe")}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
      {webLink}
    </div>
  );
}
