import { defineConfig, devices } from "@playwright/test";

const selectedProjects = process.argv.filter((arg) => arg.startsWith("--project"));
const standaloneOnly = selectedProjects.length === 1 && selectedProjects[0] === "--project=chromium";

const standaloneFixtures = "**/{review-candidate-fixtures,auto-published-candidate-fixtures}.spec.ts";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: {
    baseURL: "http://localhost:43123",
    trace: "retain-on-failure",
  },
  // The standalone qualification fixtures own their HTTP server.
  webServer: standaloneOnly ? undefined : {
    command: "npm run dev -- --hostname 127.0.0.1 --port 43123",
    url: "http://localhost:43123",
    env: { STUMBLR_ACCESS_MODE: "public" },
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  projects: [
    {
      name: "chromium",
      testMatch: standaloneFixtures,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-desktop",
      testIgnore: standaloneFixtures,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile",
      testIgnore: standaloneFixtures,
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 400, height: 985 },
      },
    },
  ],
});
