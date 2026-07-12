import type { CapacitorConfig } from "@capacitor/cli";

// PBudget ships as a thin native shell around the live server-rendered site
// (SSR + cookie auth + Postgres — nothing to bundle statically). The webview loads
// server.url directly, so every k3s deploy of pbudget.ppvnx.com IS an app update;
// the native binary only changes when the icon, plugins, or store metadata do.
// capacitor-www/ is the required-but-unused local webDir (offline fallback only).
const config: CapacitorConfig = {
  appId: "com.ppvnx.pbudget",
  appName: "PBudget",
  webDir: "capacitor-www",
  server: {
    url: "https://pbudget.ppvnx.com",
    // Cleartext stays off — the site is HTTPS-only, so the webview must be too.
    cleartext: false,
  },
  // The launch imageset only shows during the ~300ms native cold-start; because
  // server.url is remote, Capacitor then shows a white webview for the whole page
  // load. Hold the branded splash over that gap (auto-hide on a timer — the remote
  // web app can't signal readiness). See ppvnx-loading-splash memo.
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#eef1f5",
    },
  },
};

export default config;
