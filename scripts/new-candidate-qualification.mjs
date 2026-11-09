#!/usr/bin/env node
/**
 * Bounded browser qualification for newly discovered private-evaluation candidates.
 * Finite candidate list, per-site timeout, whole-run budget, nonzero exit on hard failure
 * only when zero interaction-qualified sites are found from the target set.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, devices } from "playwright";

const BASE_URL = process.env.STUMBLR_BASE_URL ?? "http://127.0.0.1:43124";
const WHOLE_RUN_BUDGET_MS = Number(process.env.STUMBLR_QUAL_BUDGET_MS ?? 180000);
const PER_SITE_MS = Number(process.env.STUMBLR_QUAL_PER_SITE_MS ?? 18000);
const MAX_NEXT = Number(process.env.STUMBLR_QUAL_MAX_NEXT ?? 40);
const BLOCKED_RE =
  /embedding not allowed|embedding is not permitted|refused to connect|x-frame-options|not permitted/i;

const TARGETS = [
  { domain: "checkboxrace.com", interaction: "click-checkbox" },
  { domain: "onesquareminesweeper.com", interaction: "click-square" },
  { domain: "mondrianandme.com", interaction: "paint-click" },
  { domain: "jspaint.app", interaction: "canvas-drag" },
  { domain: "longdogechallenge.com", interaction: "visible-scroll" },
  { domain: "puginarug.com", interaction: "visible-content" },
  { domain: "cat-bounce.com", interaction: "visible-content" },
  { domain: "gameaboutsquares.com", interaction: "board-click" },
  { domain: "projects.playables.net", interaction: "pointer-move" },
  { domain: "lab.nationalmedals.org", interaction: "canvas-drag" },
  { domain: "theremin.site", interaction: "pointer-move" },
  { domain: "sliding.toys", interaction: "tile-click" },
];

function now() {
  return Date.now();
}

async function clickNext(page, mobile) {
  const selector = mobile
    ? "nav[aria-label='Mobile controls'] button[aria-label='Stumbl']"
    : "button[aria-label='Stumbl']:visible";
  const button = page.locator(selector).first();
  try {
    await button.click({ force: true, timeout: 3000 });
  } catch {
    await button.dispatchEvent("click");
  }
  await page.waitForTimeout(900);
}

async function collectSnippet(frame) {
  if (!frame) return "";
  const text = await frame
    .locator("body")
    .innerText({ timeout: 2500 })
    .catch(() => "");
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 220);
}

async function proveInteraction(kind, page, frame, iframe) {
  const box = await iframe.boundingBox();
  if (!box) return { ok: false, proof: "no-iframe-box" };

  if (kind === "click-checkbox") {
    const checkbox = frame.locator('input[type="checkbox"]').first();
    const before = await checkbox.isChecked().catch(() => null);
    await checkbox.click({ timeout: 4000 });
    const after = await checkbox.isChecked().catch(() => null);
    return {
      ok: before !== null && after !== null && before !== after,
      proof: `checkbox ${before}->${after}`,
    };
  }

  if (kind === "click-square" || kind === "paint-click" || kind === "board-click" || kind === "tile-click") {
    const before = await page.screenshot({ type: "png" });
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55);
    await page.waitForTimeout(500);
    const after = await page.screenshot({ type: "png" });
    const changed = before.compare(after) !== 0;
    return { ok: changed, proof: changed ? "click-visual-delta" : "click-no-visual-delta" };
  }

  if (kind === "canvas-drag" || kind === "pointer-move") {
    const before = await page.screenshot({ type: "png" });
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.65, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const after = await page.screenshot({ type: "png" });
    const changed = before.compare(after) !== 0;
    return { ok: changed, proof: changed ? "drag-visual-delta" : "drag-no-visual-delta" };
  }

  if (kind === "visible-scroll") {
    const beforeY = await frame.evaluate(() => window.scrollY).catch(() => 0);
    await frame.evaluate(() => window.scrollBy(0, 400)).catch(() => undefined);
    await page.waitForTimeout(300);
    const afterY = await frame.evaluate(() => window.scrollY).catch(() => 0);
    const snippet = await collectSnippet(frame);
    const ok = afterY > beforeY || snippet.length > 20;
    return { ok, proof: ok ? `scroll-or-content y:${beforeY}->${afterY}` : "no-scroll-or-content" };
  }

  if (kind === "visible-content") {
    const snippet = await collectSnippet(frame);
    const canvasCount = await frame.locator("canvas,img,svg,video").count().catch(() => 0);
    const ok = snippet.length > 8 || canvasCount > 0;
    return { ok, proof: ok ? `content-or-media snippet=${snippet.slice(0, 40)}` : "empty-content" };
  }

  return { ok: false, proof: "unsupported-interaction" };
}

async function runPass(mobile, startedAt) {
  const browser = await chromium.launch({ headless: true });
  const context = mobile
    ? await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 400, height: 985 } })
    : await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem(
      "stumblr:v1",
      JSON.stringify({
        version: 1,
        preferences: { topics: [], mode: "wildcard", includeEvaluationPool: true },
        excludedIds: [],
        saves: [],
        history: [],
        reports: [],
      }),
    );
  });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  const targetMap = new Map(TARGETS.map((item) => [item.domain, item]));
  const found = new Map();
  const sequence = [];

  for (let i = 0; i < MAX_NEXT; i += 1) {
    if (now() - startedAt > WHOLE_RUN_BUDGET_MS - 20000) break;
    await clickNext(page, mobile);
    const domain = (
      (await page.getByTestId("active-entry-domain").first().textContent().catch(() => "")) || ""
    ).trim();
    if (!domain) continue;
    sequence.push(domain);
    if (!targetMap.has(domain) || found.has(domain)) continue;

    const siteStarted = now();
    const iframe = page.locator("iframe").first();
    await iframe.waitFor({ timeout: 5000 }).catch(() => undefined);
    const handle = await iframe.elementHandle({ timeout: 1000 }).catch(() => null);
    const frame = await handle?.contentFrame();
    const layout = await page.evaluate(() => {
      const iframeEl = document.querySelector("iframe");
      const rect = iframeEl?.getBoundingClientRect();
      return {
        viewportHeight: window.innerHeight,
        iframeHeight: rect?.height ?? 0,
        ratio: rect ? rect.height / window.innerHeight : 0,
      };
    });
    const snippet = await collectSnippet(frame);
    const blocked = BLOCKED_RE.test(snippet);
    let interaction = { ok: false, proof: "skipped" };
    if (!blocked && frame && layout.ratio >= 0.65) {
      interaction = await Promise.race([
        proveInteraction(targetMap.get(domain).interaction, page, frame, iframe),
        new Promise((resolve) =>
          setTimeout(() => resolve({ ok: false, proof: "interaction-timeout" }), PER_SITE_MS),
        ),
      ]);
    }
    const screenshot = `/opt/cursor/artifacts/newcand-${mobile ? "mobile" : "desktop"}-${domain.replace(/[^a-z0-9.-]/gi, "_")}.png`;
    await page.screenshot({ path: screenshot, fullPage: false });
    found.set(domain, {
      domain,
      blocked,
      layout,
      snippet,
      interaction,
      loadQualified: !blocked && layout.ratio >= 0.65 && Boolean(frame) && (snippet.length > 0 || interaction.ok),
      interactionQualified: Boolean(interaction.ok),
      elapsedMs: now() - siteStarted,
      screenshot,
    });
    if (found.size >= TARGETS.length) break;
  }

  await browser.close();
  return {
    mobile,
    sequence,
    uniqueDomains: [...new Set(sequence)],
    observations: [...found.values()],
  };
}

const startedAt = now();
const report = {
  checkedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  targets: TARGETS.map((item) => item.domain),
  desktop: await runPass(false, startedAt),
  mobile: await runPass(true, startedAt),
};

const allObs = [...report.desktop.observations, ...report.mobile.observations];
report.counts = {
  harvestedTargetsConfigured: TARGETS.length,
  uniqueObservedDesktop: new Set(report.desktop.observations.map((item) => item.domain)).size,
  uniqueObservedMobile: new Set(report.mobile.observations.map((item) => item.domain)).size,
  loadQualified: new Set(allObs.filter((item) => item.loadQualified).map((item) => item.domain)).size,
  interactionQualified: new Set(
    allObs.filter((item) => item.interactionQualified).map((item) => item.domain),
  ).size,
  blocked: new Set(allObs.filter((item) => item.blocked).map((item) => item.domain)).size,
};
report.pass = report.counts.interactionQualified >= 3 && report.counts.loadQualified >= 3;

const out = path.resolve("/workspace/docs/testing/new-candidate-qualification-results.json");
await fs.writeFile(out, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      outputPath: out,
      pass: report.pass,
      counts: report.counts,
      desktopDomains: report.desktop.observations.map((item) => item.domain),
      mobileDomains: report.mobile.observations.map((item) => item.domain),
    },
    null,
    2,
  ),
);
process.exitCode = report.pass ? 0 : 1;
