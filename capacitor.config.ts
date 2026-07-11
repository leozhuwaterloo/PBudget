import type { CapacitorConfig } from "@capacitor/cli";

// PlaidBudget ships as a thin native shell around the live server-rendered site
// (SSR + cookie auth + Postgres — nothing to bundle statically). The webview loads
// server.url directly, so every k3s deploy of pbudget.ppvnx.com IS an app update;
// the native binary only changes when the icon, plugins, or store metadata do.
// capacitor-www/ is the required-but-unused local webDir (offline fallback only).
const config: CapacitorConfig = {
  appId: "com.ppvnx.pbudget",
  appName: "PlaidBudget",
  webDir: "capacitor-www",
  server: {
    url: "https://pbudget.ppvnx.com",
    // Cleartext stays off — the site is HTTPS-only, so the webview must be too.
    cleartext: false,
  },
};

export default config;
