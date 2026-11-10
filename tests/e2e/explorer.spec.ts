import { expect, test } from "@playwright/test";

test("production chrome keeps its approved responsive styling and geometry", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name.includes("mobile");
  await page.setViewportSize(mobile ? { width: 400, height: 985 } : { width: 1280, height: 720 });
  await page.goto("/");

  const toolbar = page.locator("main > header");
  const toolbarStyle = await toolbar.evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return {
      backgroundColor: style.backgroundColor,
      position: style.position,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    };
  });

  expect(toolbarStyle.backgroundColor).toBe("rgb(44, 47, 51)");
  expect(toolbarStyle.position).toBe("sticky");
  expect(toolbarStyle.bounds.x).toBe(0);
  expect(toolbarStyle.bounds.y).toBe(0);
  expect(toolbarStyle.bounds.width).toBe(mobile ? 400 : 1280);

  const topSave = page.locator("header button[aria-label='Like']");
  const topControls = topSave.locator("..");
  const mobileDock = page.getByRole("navigation", { name: "Mobile controls", includeHidden: true });
  if (mobile) {
    expect(toolbarStyle.bounds.height).toBeGreaterThanOrEqual(50);
    expect(toolbarStyle.bounds.height).toBeLessThan(100);
    await expect(topControls).toHaveCSS("display", "none");
    await expect(mobileDock).toHaveCSS("position", "fixed");
    const dockBounds = await mobileDock.boundingBox();
    expect(dockBounds).toBeTruthy();
    expect(dockBounds?.width).toBe(400);
    expect(Math.round((dockBounds?.y ?? 0) + (dockBounds?.height ?? 0))).toBe(985);
    await expect(mobileDock.getByRole("button", { name: "Like", exact: true })).toBeVisible();
    await expect(mobileDock.getByRole("button", { name: "Open utility menu" })).toHaveCount(0);
  } else {
    expect(toolbarStyle.bounds.height).toBeGreaterThanOrEqual(120);
    expect(toolbarStyle.bounds.height).toBeLessThan(220);
    await expect(topControls).toHaveCSS("display", "flex");
    const saveLayout = await topSave.evaluate((element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      const parentBounds = element.parentElement?.getBoundingClientRect();
      const iconBounds = element.querySelector("svg")?.getBoundingClientRect();
      return {
        alignItems: style.alignItems,
        justifyContent: style.justifyContent,
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        parentBounds: parentBounds
          ? { x: parentBounds.x, y: parentBounds.y, width: parentBounds.width, height: parentBounds.height }
          : null,
        iconBounds: iconBounds
          ? { x: iconBounds.x, y: iconBounds.y, width: iconBounds.width, height: iconBounds.height }
          : null,
      };
    });
    expect(saveLayout.alignItems).toBe("center");
    expect(saveLayout.justifyContent).toBe("center");
    expect(saveLayout.parentBounds).not.toBeNull();
    expect(saveLayout.iconBounds).not.toBeNull();
    expect(saveLayout.bounds.width).toBeGreaterThan(60);
    expect(saveLayout.bounds.height).toBeGreaterThanOrEqual(44);
    expect(saveLayout.bounds.x).toBeGreaterThanOrEqual(saveLayout.parentBounds?.x ?? Number.POSITIVE_INFINITY);
    expect(saveLayout.bounds.x + saveLayout.bounds.width).toBeLessThanOrEqual(
      (saveLayout.parentBounds?.x ?? Number.NEGATIVE_INFINITY) + (saveLayout.parentBounds?.width ?? 0),
    );
    expect(
      Math.abs(
        saveLayout.bounds.y + saveLayout.bounds.height / 2 -
          ((saveLayout.parentBounds?.y ?? 0) + (saveLayout.parentBounds?.height ?? 0) / 2),
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        (saveLayout.iconBounds?.y ?? 0) + (saveLayout.iconBounds?.height ?? 0) / 2 -
          (saveLayout.bounds.y + saveLayout.bounds.height / 2),
      ),
    ).toBeLessThanOrEqual(1);
    await expect(mobileDock).toHaveCSS("display", "none");
  }
});

test("pool size is absent from visible, accessible, and tooltip text", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/evaluation pool/i).first()).toBeAttached();
  await expect(page.getByText(/\b\d+\s+eligible\b/i)).toHaveCount(0);
  const disclosures = await page.locator("body *").evaluateAll((nodes) =>
    nodes.flatMap((node) => [
      node.getAttribute("aria-label") ?? "",
      node.getAttribute("title") ?? "",
      node.getAttribute("aria-description") ?? "",
    ]),
  );
  expect(disclosures.join(" ")).not.toMatch(/\b\d+\s+(?:eligible|sites?|pages?|entries)\b/i);
});

test("desktop loop can load, save, and open history", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"));
  await page.goto("/");
  await page.locator("button[aria-label='Stumbl']:visible").first().click();
  await expect(page.locator("button[aria-label='Open history']:visible").first()).toBeVisible();
  await page.locator("button[aria-label='Like']:visible").first().click();
  await page.locator("button[aria-label='Open liked']:visible").first().click();
  await expect(page.getByRole("dialog").last().getByRole("button", { name: /^Open / }).first()).toBeVisible();
});

test("mobile dock remains reachable during next spam", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"));
  await page.setViewportSize({ width: 400, height: 985 });
  await page.goto("/");
  const dock = page.getByRole("navigation", { name: "Mobile controls" });
  const stumblButton = dock.getByRole("button", { name: "Stumbl" });
  await stumblButton.click({ force: true });
  await stumblButton.click({ force: true });
  await stumblButton.click({ force: true });
  const save = dock.getByRole("button", { name: "Like", exact: true });
  await expect(save).toBeVisible();
  const saveBox = await save.boundingBox();
  expect(saveBox).toBeTruthy();
  expect(saveBox?.width).toBeGreaterThan(0);
  expect(saveBox?.height).toBeGreaterThan(0);
  expect(saveBox?.y).toBeGreaterThanOrEqual(0);
  expect((saveBox?.y ?? 0) + (saveBox?.height ?? 0)).toBeLessThanOrEqual(985);

  await stumblButton.click();
  await expect(page.getByTestId("active-entry-title").first()).toHaveText(/\S/);
  await save.click();
  await page.locator("header button[aria-label='Open utility menu']").click();
  await page.getByRole("tab", { name: "Liked" }).click();
  await expect(page.getByRole("dialog").last().getByRole("button", { name: /^Open / }).first()).toBeVisible();
});

test("fresh sessions have distinct seeds and diverse no-repeat sequences", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"));
  const sessions: Array<{ seed: number; ids: string[]; domains: string[] }> = [];

  for (let sessionIndex = 0; sessionIndex < 3; sessionIndex += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    const stumbl = page.locator("button[aria-label='Stumbl']:visible").first();
    for (let pickIndex = 0; pickIndex < 12; pickIndex += 1) {
      await stumbl.click({ force: true });
    }
    const state = await page.evaluate(() => {
      const raw = window.localStorage.getItem("stumblr:v1");
      return raw
        ? (JSON.parse(raw) as {
            samplerSeed: number;
            history: Array<{ id: string; domain: string }>;
          })
        : null;
    });
    expect(state).not.toBeNull();
    sessions.push({
      seed: state?.samplerSeed ?? -1,
      ids: state?.history.map((item) => item.id) ?? [],
      domains: state?.history.map((item) => item.domain) ?? [],
    });
    await context.close();
  }

  expect(new Set(sessions.map((session) => session.seed)).size).toBe(3);
  expect(new Set(sessions.map((session) => session.ids.join("|"))).size).toBe(3);
  for (const session of sessions) {
    expect(session.ids).toHaveLength(12);
    expect(new Set(session.ids).size).toBe(session.ids.length);
    for (let index = 1; index < session.domains.length; index += 1) {
      expect(session.domains[index]).not.toBe(session.domains[index - 1]);
    }
  }
});

test("desktop chrome has a single utility row", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"));
  await page.goto("/");
  await expect(page.locator("button[aria-label='Open history']:visible")).toHaveCount(1);
  await expect(page.locator("button[aria-label='Open liked']:visible")).toHaveCount(1);
  await expect(page.locator("button[aria-label='Open report']:visible")).toHaveCount(1);
  await expect(page.locator("button[aria-label='Open preferences']:visible")).toHaveCount(1);
});

test("category controls persist preferences and support all-topics reset", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"));
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Discovery categories" }).click();
  await page.getByRole("button", { name: "nature" }).click();
  await page.keyboard.press("Escape");
  const afterPick = await page.evaluate(() => {
    const raw = window.localStorage.getItem("stumblr:v1");
    const parsed = raw ? (JSON.parse(raw) as { preferences?: { topics?: string[] } }) : null;
    return parsed?.preferences?.topics ?? [];
  });
  expect(afterPick).toContain("nature");

  await page.reload();
  const afterReload = await page.evaluate(() => {
    const raw = window.localStorage.getItem("stumblr:v1");
    const parsed = raw ? (JSON.parse(raw) as { preferences?: { topics?: string[] } }) : null;
    return parsed?.preferences?.topics ?? [];
  });
  expect(afterReload).toContain("nature");

  await page.getByRole("button", { name: "All topics" }).click();
  const afterReset = await page.evaluate(() => {
    const raw = window.localStorage.getItem("stumblr:v1");
    const parsed = raw ? (JSON.parse(raw) as { preferences?: { topics?: string[] } }) : null;
    return parsed?.preferences?.topics ?? [];
  });
  expect(afterReset).toHaveLength(0);
});

test("suggestion flow shows honest pending-review state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"));
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Suggest a site" }).first().click();
  await page.locator("input[type='url']").fill("https://example.org/community-suggestion");
  await page.getByRole("button", { name: "Submit suggestion" }).click();
  await expect(page.getByTestId("suggestion-result")).toContainText(/queued|already/i);
});
