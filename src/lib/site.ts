// Canonical public origin. APP_URL is set at runtime in the k8s deployment; the
// fallback is the prod host (used when APP_URL is unset). Same value the
// robots/sitemap/layout metadata already hardcode — centralized here for the
// OAuth routes that need to build absolute redirect URIs.
export const SITE_URL = process.env.APP_URL || "https://pbudget.ppvnx.com";
