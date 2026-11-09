import { createHash, timingSafeEqual } from "node:crypto";

export type PrivateAccessConfig =
  | { ok: true; username: string; passwordSha256: Buffer }
  | { ok: false };

type RuntimeEnv = Record<string, string | undefined>;

const BASE64_SHA256 = /^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{3}=$/;

export function readPrivateAccessConfig(env: RuntimeEnv): PrivateAccessConfig {
  const username = env.STUMBLR_BASIC_AUTH_USERNAME;
  const verifier = env.STUMBLR_BASIC_AUTH_PASSWORD_SHA256;
  if (
    !username ||
    username.includes(":") ||
    /[\u0000-\u001f\u007f]/.test(username) ||
    !verifier ||
    !BASE64_SHA256.test(verifier)
  ) {
    return { ok: false };
  }

  const passwordSha256 = Buffer.from(verifier, "base64");
  if (passwordSha256.length !== 32 || passwordSha256.toString("base64") !== verifier) {
    return { ok: false };
  }
  return { ok: true, username, passwordSha256 };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function authorizeBasicHeader(
  header: string | null,
  config: PrivateAccessConfig,
): boolean {
  if (!config.ok || !header?.startsWith("Basic ")) return false;
  const encoded = header.slice(6);
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;

  const decodedBytes = Buffer.from(encoded, "base64");
  if (decodedBytes.toString("base64") !== encoded) return false;
  const decoded = decodedBytes.toString("utf8");
  if (Buffer.from(decoded, "utf8").compare(decodedBytes) !== 0) return false;
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;

  const suppliedUsername = decoded.slice(0, separator);
  const suppliedPassword = decoded.slice(separator + 1);
  const usernameMatches = timingSafeEqual(digest(suppliedUsername), digest(config.username));
  const passwordMatches = timingSafeEqual(digest(suppliedPassword), config.passwordSha256);
  return usernameMatches && passwordMatches;
}
