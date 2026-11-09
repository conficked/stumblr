import { setTimeout as sleep } from "node:timers/promises";

const candidates = [
  "https://earth.nullschool.net/",
  "https://radio.garden/",
  "https://zoomquilt.org/",
  "https://patatap.com/",
  "https://weavesilk.com/",
  "https://littlealchemy2.com/",
];

async function probe(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "stumblr-health-check/0.1" },
    });
    const xfo = response.headers.get("x-frame-options");
    const csp = response.headers.get("content-security-policy");
    return {
      url,
      finalUrl: response.url,
      status: response.status,
      xFrameOptions: xfo ?? null,
      hasFrameAncestorsDirective: Boolean(csp?.includes("frame-ancestors")),
      frameAncestorsSnippet: csp?.match(/frame-ancestors[^;]*/i)?.[0] ?? null,
    };
  } catch (error) {
    return {
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
    await sleep(150);
  }
}

const results = [];
for (const url of candidates) {
  // Keep this bounded and polite.
  results.push(await probe(url));
}

console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
