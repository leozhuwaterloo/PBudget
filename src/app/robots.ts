import type { MetadataRoute } from "next";

// Prod origin as fallback: this route bakes at build time, where APP_URL is unset.
const SITE_URL = process.env.APP_URL || "https://pbudget.ppvnx.com";

// Auth-gated / secret-carrying routes: no SEO value, and /reset & /verify carry
// secrets that must never be indexed. Reused for every user-agent rule below.
const DISALLOW = ["/api/", "/dashboard", "/review", "/accounts", "/vendors", "/customizations", "/verify", "/reset", "/forgot"];

// AI / generative crawlers are EXPLICITLY allowed (allow = citable in ChatGPT,
// Claude, Perplexity, Google AI Overviews) so PBudget can surface in generative
// answers (GEO). Each gets the same page scope as normal search bots.
const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "anthropic-ai", "PerplexityBot", "Google-Extended"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      ...AI_BOTS.map((userAgent) => ({ userAgent, allow: "/", disallow: DISALLOW })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
