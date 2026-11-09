import { z } from "zod";

// Collector titles have no authenticated provenance and may reflect an undisclosed
// redirect component, including a fragment absent from the destination identity.
export function collectorDomainTitle(domain: string) {
  return `Website at ${domain}`.slice(0, 180);
}

const titleSignals = z.strictObject({
  quality: z.boolean(), denied: z.boolean(), digest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export function readCollectorTitleSignals(value: unknown): z.infer<typeof titleSignals> {
  const parsed = titleSignals.safeParse(value);
  return parsed.success ? parsed.data : {
    quality: false, denied: Boolean(value && typeof value === "object" && "denied" in value && value.denied === true),
  };
}

const urlLike = /(?:[a-z][a-z\d+.-]*:\/\/|\bwww\.)[^\s<>]+|(?:^|(?<=[\s(]))(?:\/\/[^\s<>]+|[\w.-]+\.[a-z]{2,63}\/[^\s<>]*)/giu;

export function redactTitleUrls(title: string) {
  return title.normalize("NFKC").replace(/&(?:#(\d{1,7})|#x([a-f\d]{1,6})|(colon|sol|period|quest|num));/gi,
    (entity: string, decimal: string | undefined, hex: string | undefined, named: string | undefined) => {
      if (named) return ({ colon: ":", sol: "/", period: ".", quest: "?", num: "#" })[named.toLowerCase()] ?? entity;
      const codePoint = decimal ? Number(decimal) : Number.parseInt(hex ?? "", 16);
      return ":/.?#".includes(String.fromCharCode(codePoint)) && codePoint < 128 ? String.fromCharCode(codePoint) : entity;
    }).replace(urlLike, " ").replace(/[^\s<>\[\](){}]+/gu, token => /[/#?]./u.test(token) ? " " : token)
    .replace(/\[\s*\]|\(\s*\)|\{\s*\}|[\[({]\s*$/gu, " ").replace(/\s+/gu, " ").trim();
}

export function classifyLegacyFraming(xfo: string | null | undefined, csp: string | null | undefined) {
  const ancestors = (csp ?? "").split(";").filter(directive => /^\s*frame-ancestors\b/i.test(directive));
  return {
    xfo_present: Boolean(xfo?.trim()),
    csp_present: Boolean(csp?.trim()),
    csp_frame_ancestors: ancestors.length > 0,
    denied: /(?:^|[\s,])(?:deny|sameorigin)(?:[\s,]|$)/i.test(xfo ?? "") ||
      ancestors.some(directive => /(?:^|\s)'(?:none|self)'(?:\s|$)/i.test(directive)),
  };
}
