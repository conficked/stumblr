import { expect, Locator, Page, test } from "@playwright/test";

async function clickNext(page: Page) {
  await page.locator("button[aria-label='Stumbl']:visible").first().click({ force: true });
  await page.waitForTimeout(350);
}

async function pickSingleTopic(page: Page, topic: string) {
  const desktopPrefs = page.locator("button[aria-label='Open preferences']:visible").first();
  let scope: Page | Locator = page;
  if (await desktopPrefs.isVisible().catch(() => false)) {
    await desktopPrefs.click();
    scope = page.locator("[role='dialog']").filter({ hasText: "Preferences" }).last();
  } else {
    await page.locator("button[aria-label='Open utility menu']:visible").first().click();
    const menuDialog = page.locator("[role='dialog']").last();
    await menuDialog.getByRole("tab", { name: "Topics" }).click();
    scope = menuDialog;
  }
  await scope.getByRole("button", { name: "topic" }).first().click();
  await scope.getByRole("button", { name: topic }).first().click();
  await page.keyboard.press("Escape");
}

test("[fixture] blocked entry can be skipped and recover on next", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/fixtures-lab");
  await pickSingleTopic(page, "culture");
  await clickNext(page);
  await expect(page.frameLocator("iframe").getByText("Embedding Not Allowed")).toBeVisible();

  await pickSingleTopic(page, "culture"); // Clear the single blocked interest before exploring another destination.
  await clickNext(page);
  await expect(page.frameLocator("iframe").getByText("Embedding Not Allowed")).not.toBeVisible();
});

test("[fixture] timeout and error states recover with next", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/fixtures-lab");
  await pickSingleTopic(page, "games");
  await clickNext(page);
  await expect(page.getByText("timed out in-frame").first()).toBeVisible({ timeout: 6000 });
  await page.goto("/fixtures-lab");
  await pickSingleTopic(page, "education");
  await clickNext(page);
  await expect(page.getByText("frame failed to load").first()).toBeVisible();
});

test("[fixture] no-repeat within a cycle and automatic continuation", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/fixtures-lab");

  const seenTitles = new Set<string>();
  for (let i = 0; i < 6; i += 1) {
    await clickNext(page);
    const title = await page.getByTestId("active-entry-title").first().textContent();
    expect(title).toBeTruthy();
    if (title) seenTitles.add(title);
  }
  expect(seenTitles.size).toBe(6);

  await clickNext(page);
  await expect(page.getByText("Pool exhausted for this cycle")).not.toBeVisible();
  await expect(page.getByTestId("active-entry-title").first()).toHaveText(/Fixture/);
  await expect(page.locator("iframe")).toBeVisible();
});

test("[fixture] filtered cycles, persistence, and menu access", async ({ page }, testInfo) => {
  await page.goto("/fixtures-lab");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  if (testInfo.project.name.includes("mobile")) {
    await page.locator("button[aria-label='Open utility menu']:visible").first().click();
    for (const tab of ["Topics", "Liked", "History", "Suggest", "Report"]) {
      await expect(page.getByRole("tab", { name: tab })).toBeVisible();
    }
    return;
  }
  await page.locator("button[aria-label='Open preferences']:visible").first().click();
  await page.getByRole("button", { name: "nature" }).click();
  await page.getByRole("button", { name: "topic" }).click();
  await page.keyboard.press("Escape");
  await clickNext(page);
  await clickNext(page);
  await expect(page.getByText("Pool exhausted for this cycle")).not.toBeVisible();
  await expect(page.getByTestId("active-entry-title").first()).toHaveText(/Fixture/);
  await expect(page.locator("iframe")).toBeVisible();

  await page.locator("button[aria-label='Open preferences']:visible").first().click();
  await page.getByRole("button", { name: "nature" }).click();
  await page.keyboard.press("Escape");
  await clickNext(page);
  await page.locator("button[aria-label='Like']:visible").first().click();
  await page.reload();
  await page.locator("button[aria-label='Open liked']:visible").first().click();
  await expect(page.getByRole("dialog").last().getByRole("button", { name: /^Open / }).first()).toBeVisible();
});

test("[fixture] frame consumes destination area and avoids viewport overflow", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/fixtures-lab");
  const desktopPrefs = page.locator("button[aria-label='Open preferences']:visible").first();
  if (await desktopPrefs.isVisible().catch(() => false)) {
    await desktopPrefs.click();
  } else {
    await page.locator("button[aria-label='Open utility menu']:visible").first().click();
    await page.getByRole("tab", { name: "Topics" }).click();
  }
  await page.getByRole("button", { name: "nature" }).first().click();
  await page.getByRole("button", { name: "topic" }).first().click();
  await page.keyboard.press("Escape");
  await clickNext(page);
  await expect(page.getByTestId("active-entry-domain").first()).toHaveText("fixtures.local");

  const frameBounds = await page.locator("iframe").first().boundingBox();
  const hostBounds = await page.locator("section div.relative").first().boundingBox();
  expect(frameBounds).toBeTruthy();
  expect(hostBounds).toBeTruthy();
  if (!frameBounds || !hostBounds) return;

  const ratio = frameBounds.height / hostBounds.height;
  expect(ratio).toBeGreaterThan(0.9);

  const iframeHandle = await page.locator("iframe").first().elementHandle();
  const frame = await iframeHandle?.contentFrame();
  expect(frame).toBeTruthy();
  if (!frame) return;

  await frame.getByTestId("fixture-canvas").waitFor();
  const beforeDrawCount = await frame.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#fixture-canvas");
    return canvas?.dataset.drawCount ?? "0";
  });
  expect(beforeDrawCount).toBe("0");

  await frame.locator("#fixture-canvas").click({ position: { x: 40, y: 40 } });

  const afterInteraction = await frame.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#fixture-canvas");
    return {
      drawCount: canvas?.dataset.drawCount ?? "0",
      lastDraw: canvas?.dataset.lastDraw ?? "",
    };
  });
  expect(afterInteraction.drawCount).toBe("1");
  expect(afterInteraction.lastDraw).not.toBe("");

  const overflow = await page.evaluate(() => ({
    htmlOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.htmlOverflow).toBeLessThanOrEqual(1);
  expect(overflow.bodyOverflow).toBeLessThanOrEqual(1);
});
