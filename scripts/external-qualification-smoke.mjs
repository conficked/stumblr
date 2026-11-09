import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { chromium, devices } from "playwright";

const BASE_URL = process.env.STUMBLR_BASE_URL ?? "http://127.0.0.1:43123";
const ACCEPTANCE_POOL = ["weavesilk.com", "www.desmos.com", "stellarium-web.org"];
// Root cause (2026-11-08): with eligible pool grown to 46, default wildcard seed 97 places
// stellarium-web.org at Next #27 while MAX_NEXT_CLICKS=24 stopped early. Keep assertions
// strict; bound clicks to full eligible pool so required verified targets can appear.
const MAX_NEXT_CLICKS = Number(process.env.STUMBLR_EXTERNAL_MAX_NEXT ?? 64);
const PER_SITE_TIMEOUT_MS = 20000;
const AFTER_INTERACTION_WAIT_MS = 1000;
const BLOCKED_RE = /embedding not allowed|embedding is not permitted|refused to connect|not permitted/i;

function sanitize(domain) {
  return domain.replace(/[^a-z0-9.-]/gi, "_");
}

function hash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function runInteractionProof({ domain, page, iframeLocator, frame }) {
  const frameBox = await iframeLocator.boundingBox();
  if (!frameBox) {
    return { ok: false, reason: "iframe-bounding-box-unavailable" };
  }

  if (domain === "weavesilk.com") {
    await page.mouse.move(frameBox.x + frameBox.width * 0.35, frameBox.y + frameBox.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(frameBox.x + frameBox.width * 0.62, frameBox.y + frameBox.height * 0.56, { steps: 12 });
    await page.mouse.up();
    return {
      ok: true,
      proof: "drag-gesture-executed",
    };
  }

  if (domain === "www.desmos.com") {
    await frame.locator(".dcg-expressionitem .dcg-mq-root-block").first().click({ timeout: 5000 });
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("x^2+1");
    const expressionVisibleRaw = await frame
      .locator("body")
      .innerText();
    const normalized = expressionVisibleRaw.replace(/\s+/g, "").toLowerCase();
    const expressionVisible = normalized.includes("x2+1") || normalized.includes("x^2+1");
    return {
      ok: expressionVisible,
      proof: expressionVisible ? "typed-expression-x^2+1-visible" : "typed-expression-not-visible",
    };
  }

  if (domain === "stellarium-web.org") {
    const searchBox = frame.getByRole("textbox", { name: /search/i }).first();
    await searchBox.click({ timeout: 5000 });
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("mars");
    await page.waitForTimeout(250);
    const value = await searchBox.inputValue().catch(() => "");
    const searchVisible = value.trim().toLowerCase() === "mars";
    return {
      ok: searchVisible,
      proof: searchVisible ? "search-term-input-value-mars" : "search-term-not-visible",
    };
  }

  if (domain === "www.openstreetmap.org") {
    const beforeTile = await frame
      .locator("img.leaflet-tile-loaded")
      .first()
      .getAttribute("src")
      .catch(() => null);
    await frame.locator(".leaflet-control-zoom-in").first().click({ timeout: 5000 });
    await page.waitForTimeout(600);
    const afterTile = await frame
      .locator("img.leaflet-tile-loaded")
      .first()
      .getAttribute("src")
      .catch(() => null);
    const changed = Boolean(beforeTile && afterTile && beforeTile !== afterTile);
    return {
      ok: changed,
      proof: changed ? "zoom-control-changed-loaded-tile" : "zoom-did-not-change-tile-src",
    };
  }

  return { ok: false, reason: "unsupported-domain" };
}

async function captureRun({ mobile }) {
  const browser = await chromium.launch({ headless: true });
  const context = mobile
    ? await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 400, height: 985 } })
    : await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(() => {
    const key = "stumblr:v1";
    const state = {
      version: 1,
      preferences: { topics: [], mode: "wildcard", includeEvaluationPool: true },
      excludedIds: [],
      saves: [],
      history: [],
      reports: [],
    };
    window.localStorage.setItem(key, JSON.stringify(state));
  });
  const page = await context.newPage();
  const consoleEvents = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleEvents.push({ type: msg.type(), text: msg.text().slice(0, 240) });
    }
  });

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const observed = new Map();
  const destinationSequence = [];
  const targetSet = new Set(ACCEPTANCE_POOL);

  for (let i = 0; i < MAX_NEXT_CLICKS; i += 1) {
    const nextSelector = mobile
      ? "nav[aria-label='Mobile controls'] button[aria-label='Stumbl']"
      : "button[aria-label='Stumbl']:visible";
    const nextButton = page.locator(nextSelector).first();
    try {
      await nextButton.click({ force: true, timeout: 4000 });
    } catch {
      await nextButton.dispatchEvent("click");
    }
    await page.waitForTimeout(2400);

    let domain = "";
    try {
      await page
        .getByTestId("active-entry-domain")
        .first()
        .waitFor({ timeout: 5000 });
      domain = (await page.getByTestId("active-entry-domain").first().textContent()) ?? "";
    } catch {
      const exhausted = await page
        .getByText("Pool exhausted for this cycle")
        .isVisible()
        .catch(() => false);
      if (exhausted) break;
      continue;
    }
    if (!domain) continue;
    destinationSequence.push(domain);
    if (!targetSet.has(domain) || observed.has(domain)) continue;

    const frameHost = page.locator("section div.relative").first();
    const iframeLocator = page.locator("iframe").first();
    const frameHostBox = await frameHost.boundingBox();
    const iframeBox = await iframeLocator.boundingBox();
    const areaRatio =
      frameHostBox && iframeBox && frameHostBox.height > 0
        ? Number((iframeBox.height / frameHostBox.height).toFixed(3))
        : null;

    const frameHandle = await iframeLocator.elementHandle();
    const frame = await frameHandle?.contentFrame();
    const bodyText = ((await frame?.locator("body").innerText().catch(() => "")) ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const blocked = BLOCKED_RE.test(bodyText);

    const beforePath = `/opt/cursor/artifacts/external-${mobile ? "mobile" : "desktop"}-${sanitize(domain)}-before.png`;
    const beforeImage = await iframeLocator.screenshot({ timeout: 6000 });
    await fs.writeFile(beforePath, beforeImage);
    const beforeHash = hash(beforeImage);

    let interaction = "not-attempted";
    let interactionProof = "none";
    let interactionOk = false;
    let interactionError = null;
    try {
      if (!frame) {
        throw new Error("content-frame-unavailable");
      }
      const proof = await Promise.race([
        runInteractionProof({ domain, page, iframeLocator, frame }),
        new Promise((resolve) =>
          setTimeout(() => resolve({ ok: false, reason: "interaction-timeout" }), PER_SITE_TIMEOUT_MS),
        ),
      ]);
      interactionOk = Boolean(proof.ok);
      interactionProof = proof.proof ?? proof.reason ?? "unknown";
      interaction = interactionOk ? "interaction-verified" : "interaction-failed";
    } catch (error) {
      interaction = "interaction-failed";
      interactionError = String(error).slice(0, 180);
    }

    await page.waitForTimeout(AFTER_INTERACTION_WAIT_MS);
    const afterPath = `/opt/cursor/artifacts/external-${mobile ? "mobile" : "desktop"}-${sanitize(domain)}-after.png`;
    const afterImage = await iframeLocator.screenshot({ timeout: 6000 });
    await fs.writeFile(afterPath, afterImage);
    const afterHash = hash(afterImage);
    const visualChanged = beforeHash !== afterHash;
    const screenshot = `/opt/cursor/artifacts/external-${mobile ? "mobile" : "desktop"}-${sanitize(domain)}-host.png`;
    await page.screenshot({ path: screenshot, fullPage: false });

    observed.set(domain, {
      domain,
      blocked,
      frameAreaRatio: areaRatio,
      frameHostBox,
      iframeBox,
      viewport: page.viewportSize(),
      visibleTextSnippet: bodyText.slice(0, 220),
      interactionVerified: interactionOk,
      interaction,
      interactionProof,
      interactionError,
      visualChanged,
      beforeScreenshot: beforePath,
      afterScreenshot: afterPath,
      screenshot,
    });

    if (observed.size >= targetSet.size) break;
  }

  await browser.close();
  const observations = Array.from(observed.values());
  const verifiedCount = observations.filter(
    (item) => !item.blocked && item.interactionVerified && item.visualChanged && (item.frameAreaRatio ?? 0) >= 0.9,
  ).length;

  return {
    mobile,
    observations,
    destinationSequence,
    acceptance: {
      requiredDomains: ACCEPTANCE_POOL,
      seenRequiredDomains: observations.map((item) => item.domain),
      missingRequiredDomains: ACCEPTANCE_POOL.filter((domain) => !observations.some((item) => item.domain === domain)),
      clicksUsed: destinationSequence.length,
      maxNextClicks: MAX_NEXT_CLICKS,
      verifiedCount,
      passed: verifiedCount >= ACCEPTANCE_POOL.length,
    },
    consoleEvents,
  };
}

const desktopRun = await captureRun({ mobile: false });
const mobileRun = await captureRun({ mobile: true });

const report = {
  checkedAt: new Date().toISOString(),
  desktop: desktopRun,
  mobile: mobileRun,
};

const outputPath = path.resolve("/workspace/docs/testing/external-qualification-results.json");
await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
const strictPass = desktopRun.acceptance.passed && mobileRun.acceptance.passed;
console.log(
  JSON.stringify(
    {
      outputPath,
      observedDesktop: desktopRun.observations.length,
      observedMobile: mobileRun.observations.length,
      desktopVerified: desktopRun.acceptance.verifiedCount,
      mobileVerified: mobileRun.acceptance.verifiedCount,
      strictPass,
    },
    null,
    2,
  ),
);

if (!strictPass) {
  process.exitCode = 1;
}
