import { expect, test } from "@playwright/test";

const ROUTES = [
  { path: "/fm", label: "FM Broadcast" },
  { path: "/pmr", label: "PMR" },
  { path: "/airband", label: "AIRBAND" },
  { path: "/maritime", label: "MARITIME" },
  { path: "/ais", label: "Maritime Picture" },
  { path: "/adsb", label: "Air Picture" },
  { path: "/sigint", label: "SIGINT" },
  { path: "/runtime", label: "Runtime diagnostics" },
] as const;

test.describe("Release smoke", () => {
  test("main routes render without browser console errors", async ({ page }) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => {
      failures.push(`pageerror: ${error.message}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        failures.push(`console error: ${message.text()}`);
      }
    });

    for (const route of ROUTES) {
      const response = await page.goto(route.path);
      expect(response?.ok(), `${route.path} should return HTTP 2xx`).toBe(true);
      await expect(page.getByText(route.label, { exact: false }).first()).toBeVisible();
    }

    expect(failures).toEqual([]);
  });

  test("core release APIs expose simulator, replay and diagnostics state", async ({ request }) => {
    const hardwareResponse = await request.get("/api/hardware");
    expect(hardwareResponse.ok()).toBe(true);
    const hardware = await hardwareResponse.json();
    expect(hardware.state).toBe("connected");
    expect(hardware.product).toBe("HackRF Simulator");

    const diagnosticsResponse = await request.get("/api/runtime/diagnostics");
    expect(diagnosticsResponse.ok()).toBe(true);
    expect(diagnosticsResponse.headers()["cache-control"]).toContain("no-store");
    const diagnostics = await diagnosticsResponse.json();
    expect(diagnostics.app.name).toBe("hackrf-webui");
    expect(diagnostics.modes.simulator).toBe(true);
    expect(diagnostics.modes.replay).toBe(true);
    expect(diagnostics.hardware.serial).toBe("[redacted]");
    expect(JSON.stringify(diagnostics)).not.toContain("SIMULATED");

    const aisResponse = await request.get("/api/ais");
    expect(aisResponse.ok()).toBe(true);
    const ais = await aisResponse.json();
    expect(ais.runtime.binaryPath).toBe("replay://ais");

    const adsbResponse = await request.get("/api/adsb");
    expect(adsbResponse.ok()).toBe(true);
    const adsb = await adsbResponse.json();
    expect(adsb.runtime.binaryPath).toBe("replay://adsb");
  });
});
