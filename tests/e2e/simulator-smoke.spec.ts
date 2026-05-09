import { expect, test } from "@playwright/test";

test.describe("HackRF simulator smoke", () => {
  test.afterEach(async ({ request }) => {
    await request.delete("/api/stream").catch(() => undefined);
  });

  test("loads FM UI and exercises simulator hardware, audio, retune and spectrum APIs", async ({ page, request }) => {
    await page.goto("/fm");
    await expect(page.getByText("HackRF").first()).toBeVisible();
    await expect(page.getByText("FM Broadcast")).toBeVisible();

    const hardware = await request.get("/api/hardware");
    await expect(hardware).toBeOK();
    const hardwareJson = await hardware.json();
    expect(hardwareJson).toMatchObject({
      state: "connected",
      product: "HackRF Simulator",
      serial: "SIMULATED",
    });

    const firstAudioBytes = await page.evaluate(async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 1500);
      try {
        const response = await fetch("/api/stream?freqMHz=100.5&label=SimulatorSmoke&lna=24&vga=20&audioGain=1", {
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`stream failed: ${response.status}`);
        }
        const reader = response.body.getReader();
        const chunk = await reader.read();
        await reader.cancel();
        return chunk.value?.byteLength ?? 0;
      } finally {
        window.clearTimeout(timeout);
        controller.abort();
      }
    });
    expect(firstAudioBytes).toBeGreaterThan(0);

    await expect.poll(async () => {
      const response = await request.get("/api/spectrum");
      const json = await response.json();
      return {
        owner: json.owner,
        state: json.state,
        bins: Array.isArray(json.frame?.bins) ? json.frame.bins.length : 0,
      };
    }).toEqual({ owner: "audio", state: "ready", bins: 96 });

    const retune = await request.patch("/api/stream?freqMHz=101.7&label=SimulatorRetune");
    await expect(retune).toBeOK();

    await expect.poll(async () => {
      const response = await request.get("/api/hardware");
      const json = await response.json();
      return {
        freqHz: json.activeStream?.freqHz,
        label: json.activeStream?.label,
      };
    }).toEqual({ freqHz: 101_700_000, label: "SimulatorRetune" });

    const stop = await request.delete("/api/stream");
    expect([204, 404]).toContain(stop.status());

    await expect.poll(async () => {
      const response = await request.get("/api/hardware");
      const json = await response.json();
      return json.activeStream ?? null;
    }).toBeNull();
  });
});
