import { defineConfig, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const port = Number.parseInt(process.env.PLAYWRIGHT_AUTH_PORT ?? "4013", 10);
const host = "127.0.0.1";
const baseURL = `http://${host}:${port}`;
const apiToken = process.env.HACKRF_WEBUI_TOKEN?.trim();
if (!apiToken) {
  throw new Error("Set HACKRF_WEBUI_E2E_TOKEN before running authenticated Playwright tests.");
}
const e2eRoot = path.join(process.cwd(), ".hermes", "e2e-auth");
const nextDistDir = ".hermes/next-e2e-auth";
const dbPath = path.join(e2eRoot, "app.sqlite");
const captureRoot = path.join(e2eRoot, "captures");
mkdirSync(captureRoot, { recursive: true });

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /auth-token\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `HACKRF_WEBUI_DB_PATH=${JSON.stringify(dbPath)} HACKRF_WEBUI_CAPTURE_ROOT=${JSON.stringify(captureRoot)} HACKRF_WEBUI_NEXT_DIST_DIR=${JSON.stringify(nextDistDir)} HACKRF_WEBUI_SIMULATOR=1 HACKRF_WEBUI_REPLAY=1 HACKRF_WEBUI_TOKEN=${apiToken} NEXT_PUBLIC_HACKRF_WEBUI_TOKEN=${apiToken} NEXT_TELEMETRY_DISABLED=1 npm run db:migrate && HACKRF_WEBUI_DB_PATH=${JSON.stringify(dbPath)} HACKRF_WEBUI_CAPTURE_ROOT=${JSON.stringify(captureRoot)} HACKRF_WEBUI_NEXT_DIST_DIR=${JSON.stringify(nextDistDir)} HACKRF_WEBUI_SIMULATOR=1 HACKRF_WEBUI_REPLAY=1 HACKRF_WEBUI_TOKEN=${apiToken} NEXT_PUBLIC_HACKRF_WEBUI_TOKEN=${apiToken} NEXT_TELEMETRY_DISABLED=1 npm run start -- --hostname ${host} --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium-auth",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
