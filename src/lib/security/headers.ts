export function buildSecurityHeaders(
  frameAllowlist: string[],
  opts?: { frameAncestors?: "'none'" | "'self'" },
) {
  const frameSrc = ["'self'", ...frameAllowlist].join(" ");
  const frameAncestors = opts?.frameAncestors ?? "'none'";

  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      `frame-src ${frameSrc}`,
      "connect-src 'self' https:",
      "base-uri 'self'",
      "form-action 'none'",
      `frame-ancestors ${frameAncestors}`,
      "object-src 'none'",
    ].join("; "),
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), accelerometer=()",
  };
}
