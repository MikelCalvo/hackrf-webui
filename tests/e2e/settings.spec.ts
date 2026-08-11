import { expect, test } from "@playwright/test";

const DEFAULT_VISIBLE_MODULES = ["sigint", "fm", "pmr", "airband", "maritime", "adsb", "ais", "morse"];

test.describe("Persistent Settings", () => {
  test.beforeEach(async ({ page, request }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("hackrf-webui.location.v2", JSON.stringify({
        version: 2,
        configured: true,
        sourceMode: "catalog",
        gpsdFallbackMode: "catalog",
        catalogScope: {
          regionId: null,
          regionName: null,
          countryId: null,
          countryCode: null,
          countryName: null,
          cityId: null,
          cityName: null,
          latitude: null,
          longitude: null,
        },
        mapPin: null,
        updatedAt: "2026-08-12T00:00:00.000Z",
      }));
    });
    await request.patch("/api/settings", {
      data: {
        general: { restoreLastModule: true, defaultModule: null },
        sidebar: { compact: false, visibleModules: DEFAULT_VISIBLE_MODULES },
        ai: { enabled: false, cpuThreads: 4, hotwords: "", modules: ["pmr", "airband", "maritime"] },
      },
    });
  });

  test("Settings remains pinned at the bottom and persists sidebar preferences", async ({ page, request }) => {
    await page.goto("/fm");
    const settingsLink = page.getByRole("link", { name: "Settings" });
    await expect(settingsLink).toBeVisible();
    await settingsLink.click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Sidebar", exact: false }).click();
    const compact = page.getByRole("switch", { name: "Compact sidebar" });
    await expect(compact).toHaveAttribute("aria-checked", "false");
    await compact.click();
    await expect(compact).toHaveAttribute("aria-checked", "true");

    await page.reload();
    await page.getByRole("button", { name: "Sidebar", exact: false }).click();
    await expect(page.getByRole("switch", { name: "Compact sidebar" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();

    const response = await request.get("/api/settings");
    expect(response.ok()).toBe(true);
    const settings = await response.json();
    expect(settings.snapshot.values.sidebar.compact).toBe(true);
  });

  test("AI toggle pauses new analysis without touching radio hardware", async ({ page, request }) => {
    const before = await request.get("/api/radio/sessions");
    expect(before.ok()).toBe(true);
    const beforeSessions = await before.json();

    await page.goto("/settings");
    await page.getByRole("button", { name: "AI & Analysis", exact: false }).click();
    const aiToggle = page.getByRole("switch", { name: "Enable local AI analysis" });
    await expect(aiToggle).toHaveAttribute("aria-checked", "false");
    await aiToggle.click();
    await expect(aiToggle).toHaveAttribute("aria-checked", "true");
    await aiToggle.click();
    await expect(aiToggle).toHaveAttribute("aria-checked", "false");
    const maritimeModule = page.getByRole("button", { name: "maritime", exact: true });
    await expect(maritimeModule).toHaveAttribute("aria-pressed", "true");
    await maritimeModule.click();
    await expect(maritimeModule).toHaveAttribute("aria-pressed", "false");

    const after = await request.get("/api/radio/sessions");
    expect(after.ok()).toBe(true);
    expect(await after.json()).toEqual(beforeSessions);

    const settingsResponse = await request.get("/api/settings");
    const settings = await settingsResponse.json();
    expect(settings.snapshot.values.ai.enabled).toBe(false);
    expect(settings.snapshot.values.ai.modules).toEqual(["pmr", "airband"]);
  });

  test("Settings is never restored as the operational startup module", async ({ page }) => {
    await page.goto("/settings");
    await page.goto("/");
    await page.waitForURL(/\/(fm|pmr|airband|maritime|adsb|ais|morse|sigint)$/);
    expect(new URL(page.url()).pathname).not.toBe("/settings");
  });
});
