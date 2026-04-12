import { buildContentSecurityPolicy } from "./csp";

type SecurityHeaderOptions = {
  nonce: string;
  isDevelopment: boolean;
  upgradeInsecureRequests?: boolean;
};

export function getSecurityHeaders({
  nonce,
  isDevelopment,
  upgradeInsecureRequests = true,
}: SecurityHeaderOptions): Record<string, string> {
  return {
    "Content-Security-Policy": buildContentSecurityPolicy({
      nonce,
      isDevelopment,
      upgradeInsecureRequests,
    }),
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Strict-Transport-Security":
      "max-age=63072000; includeSubDomains; preload",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-DNS-Prefetch-Control": "off",
    "X-Permitted-Cross-Domain-Policies": "none",
  };
}
