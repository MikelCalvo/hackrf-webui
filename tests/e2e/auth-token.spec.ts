import { expect, test } from "@playwright/test";

const TOKEN = process.env.HACKRF_WEBUI_TOKEN;
if (!TOKEN) {
  throw new Error("HACKRF_WEBUI_TOKEN is required for authenticated E2E tests.");
}

test.describe("Token-protected release smoke", () => {
  test("sensitive release APIs require and accept bearer tokens", async ({ request }) => {
    const missing = await request.get("/api/runtime/diagnostics");
    expect(missing.status()).toBe(401);
    expect(missing.headers()["cache-control"]).toContain("no-store");
    const missingBody = await missing.json();
    expect(missingBody.message).toContain("Missing API token");

    const invalid = await request.get("/api/runtime/diagnostics", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(invalid.status()).toBe(403);

    const authorized = await request.get("/api/runtime/diagnostics", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(authorized.ok()).toBe(true);
    const diagnostics = await authorized.json();
    expect(diagnostics.modes.authTokenConfigured).toBe(true);
    expect(diagnostics.modes.publicTokenConfigured).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain(TOKEN);
  });

  test("capture evidence APIs reject anonymous reads and accept the browser token", async ({ request }) => {
    for (const [endpoint, authorizedStatus] of [
      ["/api/sigint/captures", 200],
      ["/api/sigint/captures/missing-capture", 404],
      ["/api/capture-files/missing-file", 404],
    ] as const) {
      const missing = await request.get(endpoint);
      expect(missing.status()).toBe(401);
      expect(missing.headers()["cache-control"]).toContain("no-store");

      const authorized = await request.get(endpoint, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(authorized.status()).toBe(authorizedStatus);
    }
  });

  test("capture evidence rejects credentials in URLs", async ({ request }) => {
    const response = await request.get(`/api/capture-files/missing-file?apiToken=${TOKEN}`);

    expect(response.status()).toBe(401);
  });

  test("receiver, location, tracking, and activity reads require bearer tokens", async ({ request }) => {
    for (const endpoint of [
      "/api/hardware",
      "/api/spectrum",
      "/api/location/gpsd",
      "/api/location/maps",
      "/api/ais",
      "/api/ais/history?mmsi=123456789",
      "/api/adsb",
      "/api/adsb/history?hex=ABC123",
      "/api/activity-events?module=pmr",
      "/api/sigint/routes?kind=activity",
    ]) {
      const missing = await request.get(endpoint);
      expect(missing.status(), endpoint).toBe(401);

      const authorized = await request.get(endpoint, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(authorized.status(), endpoint).not.toBe(401);
      expect(authorized.status(), endpoint).not.toBe(403);
    }
  });

  test("browser UI keeps working when the public token is injected", async ({ page }) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") {
        failures.push(`console error: ${message.text()}`);
      }
    });

    const response = await page.goto("/fm");
    expect(response?.ok()).toBe(true);
    await expect(page.getByText("HackRF Simulator", { exact: false }).first()).toBeVisible();

    const runtimeResponse = await page.goto("/runtime");
    expect(runtimeResponse?.ok()).toBe(true);
    await expect(page.getByRole("heading", { name: "Runtime diagnostics" })).toBeVisible();
    await expect(page.getByText("API token: on")).toBeVisible();
    await expect(page.getByText("Replay: on")).toBeVisible();

    const hardware = await page.evaluate(async (token) => {
      const response = await fetch("/api/hardware", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { status: response.status, body: await response.json() };
    }, TOKEN);
    expect(hardware.status).toBe(200);
    expect(hardware.body.product).toBe("HackRF Simulator");
    expect(failures).toEqual([]);
  });
});
