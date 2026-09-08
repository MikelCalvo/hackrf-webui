import { expect, test } from "@playwright/test";

const configuredLocation = {
  version: 2,
  configured: true,
  sourceMode: "catalog",
  gpsdFallbackMode: "catalog",
  catalogScope: {
    regionId: null,
    regionName: null,
    countryId: "ES",
    countryCode: "ES",
    countryName: "Spain",
    cityId: "bilbao",
    cityName: "Bilbao",
    latitude: 43.263,
    longitude: -2.935,
  },
  mapPin: null,
  updatedAt: "2026-08-11T00:00:00.000Z",
};

const analysisSummary = {
  status: "none",
  engine: null,
  isCurrentEngine: null,
  model: null,
  classification: null,
  subclass: null,
  confidence: null,
  errorText: null,
  updatedAt: null,
  audioSeconds: null,
  rms: null,
  sceneLabel: null,
  sceneConfidence: null,
  voiceDetected: null,
  voiceConfidence: null,
  voiceRatio: null,
  voiceSeconds: null,
  voiceDetector: null,
  transcriptAccepted: null,
  transcriptConfidence: null,
  transcriptLanguage: null,
  transcriptLanguageConfidence: null,
  explanation: null,
  topLabels: [],
};

const morseSummary = {
  engine: "morse-timing@1.0.0",
  status: "completed",
  decodedText: "BLV",
  rawMorse: "-... .-.. ...-",
  confidence: 0.93,
  unresolvedCount: 0,
  frontEnd: "am_tone",
  toneHz: 1020,
  wordsPerMinute: 15,
  dotMs: 80,
  snrDb: 12.4,
  noiseFloorDb: -54.2,
  tunedFrequencyHz: 115_900_000,
  detectedFrequencyHz: 115_900_015,
  frequencyOffsetHz: 15,
  expectedIdentifier: "BLV",
  identifierMatch: true,
  catalog: { source: "ourairports", recordId: "ES-BLV", version: "2026-08-11" },
  updatedAt: "2026-08-11T18:00:20.000Z",
};

const summary = {
  id: "morse-review-capture",
  activityEventId: null,
  burstEventId: null,
  module: "morse",
  mode: "scan",
  reason: "scan-hit",
  label: "BLV Bilbao VOR-DME",
  freqMhz: 115.9,
  demodMode: "am",
  startedAt: "2026-08-11T18:00:00.000Z",
  endedAt: "2026-08-11T18:00:20.000Z",
  durationMs: 20_000,
  reviewStatus: "pending",
  reviewPriority: "normal",
  reviewNotes: "",
  reviewedAt: null,
  locationLabel: "Bilbao, ES",
  locationSource: "catalog",
  locationSourceDetail: "Catalog",
  cityName: "Bilbao",
  countryName: "Spain",
  countryCode: "ES",
  resolvedLatitude: 43.263,
  resolvedLongitude: -2.935,
  deviceLabel: "HackRF Simulator",
  deviceSerial: "[redacted]",
  rmsAvg: 0.1,
  rmsPeak: 0.2,
  rfPeak: 0.3,
  squelch: 0.01,
  lna: 16,
  vga: 20,
  audioGain: 1,
  audioCapture: { id: "morse-wav", kind: "audio", format: "wav", relativePath: "morse.wav", url: "/fixtures/morse.wav" },
  rawIqCapture: { id: "morse-iq", kind: "raw_iq", format: "cs8", relativePath: "morse.iq", url: "/fixtures/morse.iq" },
  tagCount: 3,
  transcriptCount: 1,
  analysisJobCount: 1,
  analysisSummary,
  transcriptPreview: { engine: "morse-timing@1.0.0", language: "morse", text: "BLV", rawMorse: "-... .-.. ...-", confidence: 0.93 },
  morseSummary,
};

const detail = {
  ...summary,
  metadata: null,
  location: null,
  tags: [],
  transcripts: [{
    id: "morse-transcript",
    engine: "morse-timing@1.0.0",
    language: "morse",
    text: "BLV",
    rawMorse: "-... .-.. ...-",
    confidence: 0.93,
    unresolvedCount: 0,
    createdAt: "2026-08-11T18:00:20.000Z",
  }],
  analysisJobs: [{
    id: "morse-job",
    burstEventId: null,
    engine: "morse-timing@1.0.0",
    status: "completed",
    errorText: null,
    createdAt: "2026-08-11T18:00:00.000Z",
    startedAt: "2026-08-11T18:00:00.000Z",
    endedAt: "2026-08-11T18:00:20.000Z",
  }],
};

test("SIGINT searches and reviews complete MORSE evidence", async ({ page }) => {
  const listQueries: string[] = [];
  const patchPayloads: Array<{ status: string; priority: string; notes: string }> = [];
  await page.addInitScript((location) => {
    window.localStorage.setItem("hackrf-webui.location.v2", JSON.stringify(location));
  }, configuredLocation);
  await page.route("**/api/sigint/captures?**", async (route) => {
    const url = new URL(route.request().url());
    listQueries.push(url.searchParams.get("q") ?? "");
    await route.fulfill({
      json: {
        items: [summary],
        counts: { total: 1, pending: 1, kept: 0, discarded: 0, flagged: 0, withAudio: 1, withRawIq: 1 },
      },
    });
  });
  await page.route("**/api/sigint/captures/morse-review-capture", async (route) => {
    if (route.request().method() === "PATCH") {
      const update = route.request().postDataJSON() as { status: string; priority: string; notes: string };
      patchPayloads.push(update);
      await route.fulfill({ json: { ...detail, reviewStatus: update.status, reviewPriority: update.priority, reviewNotes: update.notes } });
      return;
    }
    await route.fulfill({ json: detail });
  });

  await page.goto("/sigint");
  await expect(page.getByTestId("sigint-global-search")).toBeVisible();
  await page.getByLabel("Search all SIGINT evidence text").fill("-... .-.. ...-");
  await expect.poll(() => listQueries.at(-1)).toBe("-... .-.. ...-");

  await expect(page.getByText("Decoded MORSE", { exact: true })).toBeVisible();
  await expect(page.getByText("MORSE decode", { exact: true })).toBeVisible();
  await expect(page.getByText("BLV", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("-... .-.. ...-", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Expected identifier/)).toBeVisible();
  await expect(page.getByText(/Catalog provenance/)).toBeVisible();
  await expect(page.getByText(/ourairports · ES-BLV/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Download WAV" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download IQ" })).toBeVisible();
  await expect(page.getByText("AI summary", { exact: true })).toHaveCount(0);

  const reviewBar = page.getByTestId("sigint-capture-queue-review-bar");
  await reviewBar.getByLabel("Review decision: flagged").click();
  await reviewBar.getByLabel("Review priority: high").click();
  await expect.poll(() => patchPayloads.at(-1)).toMatchObject({ status: "flagged", priority: "high" });
});
