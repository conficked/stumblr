import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.env.STUMBLR_QA_URL || "http://127.0.0.1:43128";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1920, 1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.goto(base, { waitUntil: "networkidle" });
    const title = page.getByRole("heading", { name: "Stumblr", exact: true });
    const tagline = page.getByTestId("brand-tagline");
    const titleStyle = await title.evaluate(x => ({ size: parseFloat(getComputedStyle(x).fontSize), color: getComputedStyle(x).color }));
    const subtitleStyle = await tagline.evaluate(x => ({ size: parseFloat(getComputedStyle(x).fontSize), color: getComputedStyle(x).color, clipped: x.scrollWidth > x.clientWidth }));
    assert(titleStyle.size > subtitleStyle.size);
    assert.equal(titleStyle.color, "rgb(255, 255, 255)");
    assert.notEqual(subtitleStyle.color, titleStyle.color);
    assert.equal(subtitleStyle.clipped, false);
    const geometry = await page.evaluate(() => ({ main: document.querySelector("main").getBoundingClientRect().width, header: document.querySelector("main > header").getBoundingClientRect().width, overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.equal(geometry.main, width); assert.equal(geometry.header, width); assert.equal(geometry.overflow, false);
    const body = await page.locator("body").innerText();
    assert(body.includes("The internet’s a big place. Take a wrong turn."));
    assert(body.includes("Press Stumbl to begin."));
    assert(!body.includes("Private evaluation content is not launch-qualified."));
    assert(!/Pool:\s*\d/.test(body));
    if (width < 768) await page.getByRole("navigation", { name: "Mobile controls" }).getByRole("button", {name: "Save", exact: true}).waitFor({state:"visible"});
    if (process.env.STUMBLR_QA_SCREENSHOTS) await page.screenshot({ path: `${process.env.STUMBLR_QA_SCREENSHOTS}/brand-${width}.png`, fullPage: true });
    console.log(JSON.stringify({ width, titleStyle, subtitleStyle, geometry, pass: true }));
    await page.close();
  }
} finally { await browser.close(); }
