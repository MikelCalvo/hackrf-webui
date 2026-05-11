import { expect, test } from "@playwright/test";

const TOKEN = "playwright-token";

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

    const hardware = await page.evaluate(async () => {
      const response = await fetch("/api/hardware");
      return { status: response.status, body: await response.json() };
    });
    expect(hardware.status).toBe(200);
    expect(hardware.body.product).toBe("HackRF Simulator");
    expect(failures).toEqual([]);
  });
});
