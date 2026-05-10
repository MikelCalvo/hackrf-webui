import { expect, test } from "@playwright/test";

test.describe("Replay map feeds", () => {
  test("serves AIS replay fixtures through the API and UI", async ({ page, request }) => {
    const feedResponse = await request.get("/api/ais");
    expect(feedResponse.ok()).toBe(true);
    const feed = await feedResponse.json();
    expect(feed.runtime.state).toBe("running");
    expect(feed.runtime.binaryPath).toBe("replay://ais");
    expect(feed.vesselCount).toBeGreaterThanOrEqual(2);
    expect(feed.vessels.map((vessel: { name: string }) => vessel.name)).toContain("BILBAO EXPRESS");
    expect(feed.warnings.join("\n")).toContain("replay AIS fixture data");

    const historyResponse = await request.get(`/api/ais/history?mmsi=${feed.vessels[0].mmsi}&limit=2`);
    expect(historyResponse.ok()).toBe(true);
    const history = await historyResponse.json();
    expect(history.pointCount).toBe(2);
    expect(history.points[0].metadata.replay).toBe(true);

    await page.goto("/ais");
    await expect(page.getByText("Maritime Picture")).toBeVisible();
    await expect(page.getByText("BILBAO EXPRESS")).toBeVisible();
    await expect(page.getByText("Using replay AIS fixture data")).toBeVisible();
  });

  test("serves ADS-B replay fixtures through the API and UI", async ({ page, request }) => {
    const feedResponse = await request.get("/api/adsb");
    expect(feedResponse.ok()).toBe(true);
    const feed = await feedResponse.json();
    expect(feed.runtime.state).toBe("running");
    expect(feed.runtime.binaryPath).toBe("replay://adsb");
    expect(feed.aircraftCount).toBeGreaterThanOrEqual(2);
    expect(feed.aircraft.map((aircraft: { flight: string }) => aircraft.flight)).toContain("IBE042L");
    expect(feed.receiver.version).toContain("replay");
    expect(feed.warnings.join("\n")).toContain("replay ADS-B fixture data");

    const historyResponse = await request.get(`/api/adsb/history?hex=${feed.aircraft[0].hex.toLowerCase()}&limit=2`);
    expect(historyResponse.ok()).toBe(true);
    const history = await historyResponse.json();
    expect(history.pointCount).toBe(2);
    expect(history.points[0].metadata.replay).toBe(true);

    await page.goto("/adsb");
    await expect(page.getByText("Air Picture")).toBeVisible();
    await expect(page.getByText("IBE042L")).toBeVisible();
    await expect(page.getByText("Using replay ADS-B fixture data")).toBeVisible();
  });
});
