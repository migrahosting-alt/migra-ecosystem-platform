type ContentSecurityPolicyOptions = {
  nonce: string;
  isDevelopment: boolean;
  upgradeInsecureRequests?: boolean;
};

export function buildContentSecurityPolicy({
  nonce,
  isDevelopment,
  upgradeInsecureRequests = true,
}: ContentSecurityPolicyOptions): string {
  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
  ];

  if (isDevelopment) {
    scriptSources.push("'unsafe-eval'");
  }

  const styleSources = ["'self'", "'unsafe-inline'"];

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src ${scriptSources.join(" ")}`,
    `style-src ${styleSources.join(" ")}`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ];

  if (upgradeInsecureRequests) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}
