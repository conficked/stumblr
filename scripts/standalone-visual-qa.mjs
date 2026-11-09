import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.STUMBLR_QA_URL ?? "http://127.0.0.1:43125";
const output = "/workspace/stumblr-review";
await mkdir(output, { recursive: true });
const browser = await chromium.launch();

try {
  for (const [name, viewport] of [
    ["desktop", { width: 1280, height: 720 }],
    ["mobile", { width: 400, height: 985 }],
  ]) {
    const page = await browser.newPage({ viewport });
    await page.goto(baseURL, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(output, `${name}-repaired.png`), fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
}
