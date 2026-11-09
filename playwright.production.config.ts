import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:43125",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/standalone-server.mjs",
    env: { STUMBLR_ACCESS_MODE: "public", STUMBLR_DB_PATH: `${process.cwd()}/.next/e2e-production.sqlite` },
    url: "http://localhost:43125",
    reuseExistingServer: false,
    timeout: 120000,
  },
  projects: [
    {
      name: "chromium-desktop-production",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } },
    },
    {
      name: "chromium-mobile-production",
      use: { ...devices["Pixel 7"], viewport: { width: 400, height: 985 } },
    },
  ],
});
