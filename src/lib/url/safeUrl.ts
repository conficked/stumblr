import dns from "node:dns/promises";
import { isIP } from "node:net";

const DISALLOWED_HOST_SNIPPETS = [".local", ".internal", ".arpa"];
const DISALLOWED_HOSTS = new Set(["localhost"]);
const TRACKING_PREFIXES = ["utm_", "fbclid", "gclid", "ref_"];

type HostSafetyResult = {
  ok: boolean;
  reason?: string;
};

function isIpAddress(value: string): boolean {
  return isIP(value) !== 0;
}

function parseIpClass(ip: string): HostSafetyResult {
  if (ip.startsWith("127.") || ip === "::1") return { ok: false, reason: "loopback_ip" };
  if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) {
    return { ok: false, reason: "private_ip" };
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return { ok: false, reason: "private_ip" };
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) {
    return { ok: false, reason: "private_ipv6" };
  }
  return { ok: true };
}

export function canonicalizeHttpsUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:") return null;
    if (!parsed.hostname) return null;

    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    parsed.hostname = host;
    if (parsed.port === "443") parsed.port = "";

    const kept = new URLSearchParams();
    for (const [key, value] of parsed.searchParams.entries()) {
      const lower = key.toLowerCase();
      if (TRACKING_PREFIXES.some((prefix) => lower === prefix || lower.startsWith("utm_"))) continue;
      kept.append(key, value);
    }
    parsed.search = kept.toString();
    parsed.hash = "";

    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function basicHostSafety(hostname: string): HostSafetyResult {
  const host = hostname.toLowerCase();
  if (DISALLOWED_HOSTS.has(host)) return { ok: false, reason: "localhost_disallowed" };
  if (DISALLOWED_HOST_SNIPPETS.some((snippet) => host.includes(snippet))) {
    return { ok: false, reason: "local_domain_disallowed" };
  }
  if (isIpAddress(host)) {
    return parseIpClass(host);
  }
  return { ok: true };
}

export async function resolveHostSafety(hostname: string): Promise<HostSafetyResult> {
  const basic = basicHostSafety(hostname);
  if (!basic.ok) return basic;
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records.length) return { ok: false, reason: "dns_no_records" };
    for (const record of records) {
      const cls = parseIpClass(record.address);
      if (!cls.ok) return cls;
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "dns_lookup_failed" };
  }
}
