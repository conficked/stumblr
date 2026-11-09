import fs from "node:fs/promises";
import path from "node:path";
import { chromium, devices } from "playwright";

const BASE_URL = process.env.STUMBLR_BASE_URL ?? "http://127.0.0.1:43124";
const WAIT_AFTER_NEXT_MS = 1800;

function seedState(overrides = {}) {
  return {
    version: 1,
    preferences: { topics: [], mode: "wildcard", includeEvaluationPool: true },
    excludedIds: [],
    saves: [],
    history: [],
    reports: [],
    ...overrides,
  };
}

function collectLayout(page) {
  return page.evaluate(() => {
    const iframe = document.querySelector("iframe");
    const host = document.querySelector("main[aria-label='Stumblr Explorer'] section div.relative");
    const footer = document.querySelector("main[aria-label='Stumblr Explorer'] section footer");
    const dock = document.querySelector("nav[aria-label='Mobile controls']");
    const fr = iframe?.getBoundingClientRect();
    const hr = host?.getBoundingClientRect();
    const frt = footer?.getBoundingClientRect();
    const dr = dock?.getBoundingClientRect();
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      iframe: fr ? { top: fr.top, bottom: fr.bottom, height: fr.height } : null,
      host: hr ? { top: hr.top, bottom: hr.bottom, height: hr.height } : null,
      footer: frt ? { top: frt.top, bottom: frt.bottom, height: frt.height } : null,
      dockTop: dr?.top ?? null,
    };
  });
}

function assertLayout(layout, mobile) {
  const failures = [];
  if (!layout.iframe || !layout.footer) {
    failures.push("missing iframe or footer geometry");
    return { pass: false, failures };
  }

  const iframeViewportRatio = layout.iframe.height / layout.viewport.height;
  if (iframeViewportRatio < 0.65) {
    failures.push(`iframe/viewport ratio below threshold: ${iframeViewportRatio.toFixed(3)}`);
  }

  if (!mobile) {
    const unusedBeyondFooter = layout.viewport.height - layout.footer.bottom;
    if (unusedBeyondFooter > 40) {
      failures.push(`desktop unused area below footer too large: ${unusedBeyondFooter.toFixed(1)}px`);
    }
  } else {
    if (layout.dockTop == null) {
      failures.push("missing mobile dock geometry");
    } else {
      const unusedToDock = layout.dockTop - layout.footer.bottom;
      if (unusedToDock > 40) {
        failures.push(`mobile gap between footer and dock too large: ${unusedToDock.toFixed(1)}px`);
      }
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    metrics: {
      iframeViewportRatio: Number((layout.iframe.height / layout.viewport.height).toFixed(3)),
      unusedBeyondFooter: Number((layout.viewport.height - layout.footer.bottom).toFixed(1)),
      unusedToDock:
        mobile && layout.dockTop != null ? Number((layout.dockTop - layout.footer.bottom).toFixed(1)) : null,
    },
  };
}

async function clickNext(page, mobile) {
  const nextSelector = mobile
    ? "nav[aria-label='Mobile controls'] button[aria-label='Stumbl']"
    : "button[aria-label='Stumbl']:visible";
  const nextButton = page.locator(nextSelector).first();
  try {
    await nextButton.click({ force: true, timeout: 4000 });
  } catch {
    // Mobile emulation can report the fixed dock as not actionable; dispatch keeps behavior deterministic.
    await nextButton.dispatchEvent("click");
  }
  await page.waitForTimeout(WAIT_AFTER_NEXT_MS);
}

async function runFixtureCheck(mobile) {
  const browser = await chromium.launch({ headless: true });
  const context = mobile
    ? await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 400, height: 985 } })
    : await browser.newContext({ viewport: { width: 1366, height: 900 } });

  await context.addInitScript((state) => {
    localStorage.setItem("stumblr:v1", JSON.stringify(state));
  }, seedState({ preferences: { topics: ["nature"], mode: "topic", includeEvaluationPool: true } }));

  const page = await context.newPage();
  await page.goto(`${BASE_URL}/fixtures-lab`, { waitUntil: "domcontentloaded" });
  let frameHandle = null;
  let attempts = 0;
  while (attempts < 3 && !frameHandle) {
    attempts += 1;
    await clickNext(page, mobile);
    await Promise.race([
      page.locator("iframe").first().waitFor({ timeout: 5000 }),
      page.getByText("Pool exhausted for this cycle").first().waitFor({ timeout: 5000 }),
    ]).catch(() => undefined);
    frameHandle = await page.locator("iframe").first().elementHandle({ timeout: 1000 }).catch(() => null);
  }

  const frame = await frameHandle?.contentFrame();
  if (!frame) {
    const debugScreenshot = `/opt/cursor/artifacts/proof-${mobile ? "mobile" : "desktop"}-fixture-missing-frame.png`;
    const debugDomain =
      ((await page.getByTestId("active-entry-domain").first().textContent().catch(() => "")) || "").trim() ||
      "none";
    await page.screenshot({ path: debugScreenshot, fullPage: false });
    await browser.close();
    return {
      pass: false,
      failures: [`fixture frame not available after ${attempts} attempts (domain=${debugDomain})`],
      screenshot: debugScreenshot,
    };
  }

  await frame.getByTestId("fixture-canvas").waitFor({ timeout: 5000 });
  const beforeCount = await frame.evaluate(() => {
    const canvas = document.querySelector("#fixture-canvas");
    return canvas?.dataset.drawCount ?? "0";
  });
  await frame.locator("#fixture-canvas").click({ position: { x: 40, y: 40 } });
  const afterCount = await frame.evaluate(() => {
    const canvas = document.querySelector("#fixture-canvas");
    return canvas?.dataset.drawCount ?? "0";
  });

  const layout = await collectLayout(page);
  const layoutAssert = assertLayout(layout, mobile);
  const interactionPass = beforeCount === "0" && afterCount === "1";
  const screenshot = `/opt/cursor/artifacts/proof-${mobile ? "mobile" : "desktop"}-fixture-canvas.png`;
  await page.screenshot({ path: screenshot, fullPage: false });

  await browser.close();
  return {
    pass: layoutAssert.pass && interactionPass,
    failures: [
      ...layoutAssert.failures,
      ...(interactionPass ? [] : [`fixture interaction failed drawCount ${beforeCount}->${afterCount}`]),
    ],
    layout,
    layoutMetrics: layoutAssert.metrics,
    screenshot,
  };
}

async function runExternalDesmosCheck(mobile) {
  const browser = await chromium.launch({ headless: true });
  const context = mobile
    ? await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 400, height: 985 } })
    : await browser.newContext({ viewport: { width: 1366, height: 900 } });

  await context.addInitScript((state) => {
    localStorage.setItem("stumblr:v1", JSON.stringify(state));
  }, seedState());

  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  let domain = "";
  for (let i = 0; i < 30; i += 1) {
    await clickNext(page, mobile);
    domain = ((await page.getByTestId("active-entry-domain").first().textContent().catch(() => "")) || "").trim();
    if (domain === "www.desmos.com") break;
  }

  const failures = [];
  if (domain !== "www.desmos.com") {
    failures.push(`desmos not reached, got ${domain || "none"}`);
  }

  const iframe = page.locator("iframe").first();
  const box = await iframe.boundingBox();
  if (!box) {
    failures.push("desmos iframe has no bounding box");
  } else {
    const frameHandle = await iframe.elementHandle();
    const frame = await frameHandle?.contentFrame();
    if (!frame) {
      failures.push("desmos frame unavailable for typing");
    } else {
      await frame.locator(".dcg-expressionitem .dcg-mq-root-block").first().click({ timeout: 5000 });
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.press("Backspace");
      await page.keyboard.type("x^2+1");
      await page.waitForTimeout(900);
    }
  }

  const frameHandle = await iframe.elementHandle();
  const frame = await frameHandle?.contentFrame();
  let normalizedText = "";
  if (frame) {
    const body = await frame.locator("body").innerText().catch(() => "");
    normalizedText = body.replace(/\s+/g, "").toLowerCase();
  } else {
    failures.push("desmos frame unavailable for text verification");
  }

  const expressionVisible = normalizedText.includes("x2+1") || normalizedText.includes("x^2+1");
  if (!expressionVisible) {
    failures.push("typed expression x^2+1 not visible in desmos frame text");
  }

  const layout = await collectLayout(page);
  const layoutAssert = assertLayout(layout, mobile);

  const screenshot = `/opt/cursor/artifacts/stumblr-working-${mobile ? "mobile" : "desktop"}-desmos-final.png`;
  await page.screenshot({ path: screenshot, fullPage: false });

  await browser.close();
  return {
    pass: failures.length === 0 && layoutAssert.pass,
    failures: [...failures, ...layoutAssert.failures],
    layout,
    layoutMetrics: layoutAssert.metrics,
    expressionVisible,
    screenshot,
  };
}

const report = {
  checkedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  fixture: {
    desktop: await runFixtureCheck(false),
    mobile: await runFixtureCheck(true),
  },
  externalDesmos: {
    desktop: await runExternalDesmosCheck(false),
    mobile: await runExternalDesmosCheck(true),
  },
};

report.pass =
  report.fixture.desktop.pass &&
  report.fixture.mobile.pass &&
  report.externalDesmos.desktop.pass &&
  report.externalDesmos.mobile.pass;

const outputPath = path.resolve("/workspace/docs/testing/production-proof-results.json");
await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ outputPath, pass: report.pass }, null, 2));

if (!report.pass) {
  process.exitCode = 1;
}
