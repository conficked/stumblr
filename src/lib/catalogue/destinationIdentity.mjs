import { createHash } from "node:crypto";

const UNSAFE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const DENIED_HOST_LABEL = /^(?:store|shop|pricing|buy|auth|login|signin|sso|accounts?|checkout|careers?|jobs?|recruit(?:ing|ment)?|agency|docs?|developer|developers|support|donate)(?:-|$)/i;
const DENIED_HOSTS = new Set(["github.com", "gitlab.com", "bitbucket.org", "amazon.com", "etsy.com", "gumroad.com", "patreon.com", "ko-fi.com", "buymeacoffee.com"]);
const DENIED_PATH_SEGMENT = /^(?:stores?|shops?|products?|cart|checkout|pricing|plans-and-pricing|login|log-in|signin|sign-in|signup|sign-up|register|auth|authentication|oauth2?|sso|careers?|jobs?|recruit(?:ing|ment)?|agency|services|docs?|documentation|api-reference|donate|donation|sponsor|repository|coming-soon|under-construction|placeholder)(?:\.(?:html?|php))?$/i;
/** @param {string} value */
export function publicHttpsUrl(value, maxLength = 4096) {
  if (value.length > maxLength || !value.startsWith("https://") || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    const host = url.hostname;
    const authority = /^https:\/\/([^/?#]+)/.exec(value)?.[1].toLowerCase();
    if (url.username || url.password || url.port || (authority !== host && authority !== `${host}:443`) ||
        host.length > 253 || !/\.[a-z]{2,63}$/.test(host) ||
        !host.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
        /(?:^|\.)(?:localhost|local|internal|arpa|onion)$/.test(host)) return null;
    const decoded = decodeURIComponent(url.pathname + url.search + url.hash);
    if (UNSAFE_CONTROL.test(decoded) || /[\\\r\n]/u.test(decoded)) return null;
    return url;
  } catch {
    return null;
  }
}

/** @param {URL} url */
export function deniedUrl(url) {
  const host = url.hostname.replace(/^www\./, "");
  const segments = decodeURIComponent(url.pathname).split("/");
  return DENIED_HOSTS.has(host) || DENIED_HOST_LABEL.test(host.split(".")[0]) ||
    segments.some(segment => DENIED_PATH_SEGMENT.test(segment.replace(/[ _]+/g, "-"))) ||
    /(?:^|[?&])(?:login|signin|auth|checkout|redirect_uri)=/iu.test(decodeURIComponent(url.search));
}

/** @param {string} value */
export function getQualificationUrlIdentity(value) {
  const parsed = new URL(value);
  // Fragments are not sent in document requests.
  parsed.hash = "";
  return {
    final_url_origin: parsed.origin,
    final_url_sha256: createHash("sha256").update(parsed.href).digest("hex"),
  };
}
