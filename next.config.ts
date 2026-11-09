import type { NextConfig } from "next";

const production = process.env.NODE_ENV === "production";
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  // Static Next rendering uses inline hydration scripts. A nonce policy would
  // require request middleware and dynamic rendering; do not break hydration.
  `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https://tiles.openfreemap.org https://s3.amazonaws.com data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://tiles.openfreemap.org https://api.open-meteo.com https://s3.amazonaws.com",
  "worker-src 'self' blob:",
  "media-src 'self'",
  "manifest-src 'self'",
  ...(production ? ["upgrade-insecure-requests"] : []),
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), serial=(self)" },
        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ...(production ? [{
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        }] : []),
      ],
    }];
  },
};

export default nextConfig;
