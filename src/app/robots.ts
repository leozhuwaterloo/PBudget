import type { MetadataRoute } from "next";

// Prod origin as fallback: this route bakes at build time, where APP_URL is unset.
const SITE_URL = process.env.APP_URL || "https://pbudget.ppvnx.com";

// AI/generative crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended…)
// fall under the "*" rule and are intentionally allowed, so PBudget can surface
// in generative answers (GEO). Only auth-gated and tokened routes are blocked —
// no SEO value, and /reset & /verify carry secrets that must never be indexed.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard", "/review", "/accounts", "/vendors", "/customizations", "/verify", "/reset", "/forgot"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
