// Interface tests in the browser: Playwright against `npm run dev` with mock data (src/shared/api/mock.ts).
// Run: npm run test:ui. The browser is the installed Google Chrome, Playwright downloads nothing.
import { defineConfig } from "@playwright/test";

// the project has no @types/node: only this much of it is needed
declare const process: { env: Record<string, string | undefined> };

const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e/ui",
  // .e2e.ts, not .test.ts: vitest (npm test) must not pick these files up
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:1420",
    channel: "chrome",
    // the mock data and the fixed clock are in this zone; dates and week start follow the app language
    timezoneId: "Europe/Warsaw",
    locale: "en-GB",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
});
