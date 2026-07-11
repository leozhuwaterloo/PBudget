/** @type {import('next').NextConfig} */

// Baseline security headers for a financial app. HSTS forces HTTPS; frame-deny +
// nosniff + referrer/permissions lock down clickjacking and leakage.
// ponytail: no CSP — Plaid Link's iframe/script needs a careful allowlist and a
// wrong one silently breaks bank linking. Add a tested CSP if/when there's time.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
