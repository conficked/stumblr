import { createHash } from "node:crypto";

const UNSAFE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const GENERIC_TITLE = /^(?:(?:welcome to )?(?:(?:my|our|the) )?(?:home(?:page)?|web ?site|site|blog|personal blog|personal website)|welcome|official site|test page|index|untitled(?: document)?|default page|index of\b.*|read more|click here|learn more|loading|error|not found|access denied|just a moment)$/iu;
const DENIED_TITLE = [
  /\b(?:online (?:store|shop)|print shop|print store|buy now|shopping cart|checkout|plans and pricing|pricing plans|pricing|sign[ -]?in|log[ -]?in|sign[ -]?up|create an account|verify (?:your identity|you are human)|job openings|we.re hiring|careers at|recruitment|digital agency|design agency)\b/iu,
  /\b(?:api reference|developer documentation|documentation portal|generic documentation|installation guide|donation page|make a donation|donate now|coming soon|under construction|domain (?:is )?for sale|parked domain|template preview|sample page)\b/iu,
  /\bclone\b|\bmirror (?:of|for)\b|\bmirror$/iu,
];

export function titleHasQuality(title) {
  if (GENERIC_TITLE.test(title) || /[<>]|^(?:https?:|www\.)|^[\w-]+\.(?:com|org|net|io|dev)$/iu.test(title)) return false;
  return (title.match(/\p{L}/gu)?.length ?? 0) >= 5;
}

export function deniedText(value) {
  const normalized = value.normalize("NFKC").replace(/[\p{Cf}]/gu, "").replace(/[_-]+/g, " ").trim();
  return UNSAFE_CONTROL.test(normalized) || DENIED_TITLE.some(pattern => pattern.test(normalized));
}

export function titleKey(cleaned) {
  return cleaned.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    .replace(/ (?:part|vol(?:ume)?|episode) (?:[ivxlcdm]+|\d+)$/u, "");
}

export function titleDigest(cleaned) {
  const key = titleKey(cleaned);
  return key ? createHash("sha256").update(key).digest("hex") : undefined;
}

export function classifyCollectorTitle(raw, cleaned) {
  const quality = titleHasQuality(cleaned);
  const denied = deniedText(raw) || deniedText(cleaned);
  const digest = quality && !denied ? titleDigest(cleaned) : undefined;
  return { quality, denied, ...(digest ? { digest } : {}) };
}
