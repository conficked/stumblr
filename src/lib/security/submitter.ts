import crypto from "node:crypto";

// Never persisted: stored hashes cannot be reversed to an IP, even with the database in hand.
const hashKey = crypto.randomBytes(32);

// Cloudflare overwrites cf-connecting-ip and rejects client-supplied copies, so it is the only
// client IP a caller cannot rotate. X-Forwarded-For is the fallback for non-Cloudflare paths.
export function submitterKeyFromHeaders(headers: Headers): string {
  const cfIp = headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "no-ip";
}

export function hashSubmitter(submitterKey: string): string {
  return crypto.createHmac("sha256", hashKey).update(submitterKey).digest("hex").slice(0, 24);
}
