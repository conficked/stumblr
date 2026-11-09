import fs from "node:fs/promises";
import path from "node:path";
import { chromium, devices } from "playwright";

const BASE_URL = process.env.STUMBLR_BASE_URL ?? "http://127.0.0.1:43124";
const STEPS = Number(process.env.SOAK_STEPS ?? 20);
const WAIT_MS = 1800;
const STEP_TIMEOUT_MS = Number(process.env.SOAK_STEP_TIMEOUT_MS ?? 12000);
const RUN_BUDGET_MS = Number(process.env.SOAK_RUN_BUDGET_MS ?? 180000);
const CLOSE_TIMEOUT_MS = 5000;
const outputPath = path.resolve("/workspace/docs/testing/catalogue-soak-results.json");

function timeoutAfter(ms, label) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(label)), ms);
  });
}

function createState() {
  return {
    version: 1,
    preferences: {
      topics: [],
      mode: "wildcard",
      includeEvaluationPool: true,
    },
    excludedIds: [],
    saves: [],
    history: [],
    reports: [],
  };
}

function evaluateStep(step) {
  const hasDomain = Boolean(step.domain);
  const ratioOk = typeof step.ratio === "number" && step.ratio >= 0.65;
  const blocked = step.blockedOverlay || step.blockedContent;
  const meaningful = step.visibleSnippet.trim().length >= 18;
  const pass = hasDomain && ratioOk && !blocked && meaningful;
  return {
    pass,
    hasDomain,
    ratioOk,
    blocked,
    meaningful,
  };
}

async function writePartial(report) {
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
}

async function runSoak(mobile) {
  const runLabel = mobile ? "mobile" : "desktop";
  const runStarted = Date.now();
  const browser = await chromium.launch({ headless: true });
  let context;
  let page;
  const steps = [];
  let status = "ok";
  let statusReason = "";

  try {
    context = mobile
      ? await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 400, height: 985 } })
      : await browser.newContext({ viewport: { width: 1366, height: 900 } });

    await context.addInitScript((state) => {
      localStorage.setItem("stumblr:v1", JSON.stringify(state));
    }, createState());

    page = await context.newPage();
    page.setDefaultTimeout(Math.max(1000, Math.floor(STEP_TIMEOUT_MS / 2)));
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
  } catch (error) {
    status = "error";
    statusReason = String(error);
  }

  const nextSelector = mobile
    ? "nav[aria-label='Mobile controls'] button[aria-label='Stumbl']"
    : "button[aria-label='Stumbl']:visible";

  for (let i = 0; i < STEPS; i += 1) {
    const elapsed = Date.now() - runStarted;
    if (elapsed > RUN_BUDGET_MS) {
      status = "timeout";
      statusReason = `run budget exceeded at step ${i + 1} (${elapsed}ms/${RUN_BUDGET_MS}ms)`;
      break;
    }
    if (!page) break;

    const row = {
      step: i + 1,
      domain: "",
      ratio: null,
      blockedOverlay: false,
      blockedContent: false,
      note: "",
      visibleSnippet: "",
      pass: false,
      error: null,
      elapsedMs: 0,
    };

    const stepStarted = Date.now();
    try {
      await page.locator(nextSelector).first().click({ force: true, timeout: 4000 });
      await page.waitForTimeout(WAIT_MS);

      row.domain = ((await page.getByTestId("active-entry-domain").first().textContent({ timeout: 2000 }).catch(() => "")) || "")
        .trim();
      row.blockedOverlay = await page
        .getByText("Destination needs attention")
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false);
      row.note =
        (await page
          .locator("main[aria-label='Stumblr Explorer'] p.text-sm")
          .first()
          .textContent({ timeout: 500 })
          .catch(() => ""))?.trim() ?? "";

      const iframe = page.locator("iframe").first();
      const box = await iframe.boundingBox();
      const viewportHeight = (await page.viewportSize())?.height ?? 0;
      row.ratio = box && viewportHeight > 0 ? Number((box.height / viewportHeight).toFixed(3)) : null;

      const frameHandle = await iframe.elementHandle();
      const frame = await frameHandle?.contentFrame();
      if (frame) {
        const rawText = await frame
          .evaluate(() => (document.body?.innerText || document.body?.textContent || "").slice(0, 1200))
          .catch(() => "");
        const txt = (rawText || "").replace(/\s+/g, " ");
        row.visibleSnippet = txt.slice(0, 160);
        row.blockedContent = /embedding not allowed|refused to connect|not permitted/i.test(txt);
      }
    } catch (error) {
      row.error = String(error);
    }

    row.elapsedMs = Date.now() - stepStarted;
    if (row.elapsedMs > STEP_TIMEOUT_MS) {
      row.error = row.error ?? `step-budget-exceeded:${row.elapsedMs}ms`;
    }
    row.pass = evaluateStep(row).pass;
    steps.push(row);
    console.log(
      `[soak:${runLabel}] step=${row.step} domain=${row.domain || "none"} pass=${row.pass} ratio=${row.ratio ?? "n/a"} blocked=${
        row.blockedOverlay || row.blockedContent
      } error=${row.error ? "yes" : "no"}`,
    );
  }

  if (context) {
    await Promise.race([context.close(), timeoutAfter(CLOSE_TIMEOUT_MS, `${runLabel}:context-close`)])
      .catch(() => undefined);
  }
  await Promise.race([browser.close(), timeoutAfter(CLOSE_TIMEOUT_MS, `${runLabel}:browser-close`)]).catch(
    () => undefined,
  );

  const uniqueDomains = [...new Set(steps.map((row) => row.domain).filter(Boolean))];
  const blockedCount = steps.filter((row) => row.blockedOverlay || row.blockedContent).length;
  const failedSteps = steps.filter((row) => !row.pass).length;
  const minRatio = steps.length ? Math.min(...steps.map((row) => row.ratio ?? 0)) : 0;
  const failedDomains = [...new Set(steps.filter((row) => !row.pass).map((row) => row.domain).filter(Boolean))];

  return {
    mobile,
    totalSteps: STEPS,
    completedSteps: steps.length,
    uniqueDomains: uniqueDomains.length,
    blockedSteps: blockedCount,
    failedSteps,
    failedDomains,
    minRatio,
    status,
    statusReason,
    steps,
  };
}

const report = {
  checkedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  desktop: null,
  mobile: null,
  pass: false,
};
await writePartial(report);
report.desktop = await runSoak(false);
await writePartial(report);
report.mobile = await runSoak(true);

const desktopPass =
  report.desktop.status === "ok" &&
  report.desktop.completedSteps === STEPS &&
  report.desktop.failedSteps === 0 &&
  report.desktop.blockedSteps === 0;
const mobilePass =
  report.mobile.status === "ok" &&
  report.mobile.completedSteps === STEPS &&
  report.mobile.failedSteps === 0 &&
  report.mobile.blockedSteps === 0;
report.pass = desktopPass && mobilePass;

await writePartial(report);

console.log(
  JSON.stringify(
    {
      outputPath,
      pass: report.pass,
      desktop: {
        uniqueDomains: report.desktop.uniqueDomains,
        blockedSteps: report.desktop.blockedSteps,
        failedSteps: report.desktop.failedSteps,
        completedSteps: report.desktop.completedSteps,
      },
      mobile: {
        uniqueDomains: report.mobile.uniqueDomains,
        blockedSteps: report.mobile.blockedSteps,
        failedSteps: report.mobile.failedSteps,
        completedSteps: report.mobile.completedSteps,
      },
    },
    null,
    2,
  ),
);

if (!report.pass) {
  process.exitCode = 1;
}
