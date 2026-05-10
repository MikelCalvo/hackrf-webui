import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? "4012", 10);
const host = "127.0.0.1";
const baseURL = `http://${host}:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
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
    command: `HACKRF_WEBUI_SIMULATOR=1 HACKRF_WEBUI_REPLAY=1 NEXT_TELEMETRY_DISABLED=1 npm run start -- --hostname ${host} --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
