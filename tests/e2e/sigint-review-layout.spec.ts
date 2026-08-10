import { expect, test } from "@playwright/test";

const configuredLocation = {
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
  updatedAt: "2026-08-11T00:00:00.000Z",
};

const captureSummary = {
  id: "review-layout-capture",
  activityEventId: null,
  module: "pmr",
  reason: "activity",
  status: "completed",
  mode: "scan",
  burstEventId: null,
  startedAt: "2026-08-11T00:00:00.000Z",
  endedAt: "2026-08-11T00:00:03.000Z",
  durationMs: 3000,
  freqMhz: 446.01875,
  label: "PMR446 CH2",
  locationLabel: "Bilbao, ES",
  cityName: "Bilbao",
  countryName: "Spain",
  countryCode: "ES",
  resolvedLatitude: 43.263,
  resolvedLongitude: -2.935,
  locationSource: "catalog",
  locationSourceDetail: "Catalog",
  deviceLabel: "HackRF Simulator",
  deviceSerial: "[redacted]",
  sampleRate: 2000000,
  bandwidth: 200000,
  lna: 16,
  vga: 20,
  ampEnabled: false,
  demodMode: "fm",
  audioGain: 1,
  squelch: 0.01,
  rmsAvg: 0.1,
  rmsPeak: 0.2,
  rfPeak: 0.3,
  tagCount: 0,
  transcriptCount: 0,
  rawIqCapture: null,
  audioCapture: null,
  analysisJobCount: 0,
  analysisSummary: {
    status: "none",
    engine: null,
    isCurrentEngine: false,
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
  },
  reviewStatus: "pending",
  reviewPriority: "normal",
  reviewNotes: "",
  reviewedAt: null,
};

test("SIGINT review decisions float over the recording queue without a submit button", async ({ page }) => {
  await page.addInitScript((location) => {
    window.localStorage.setItem("hackrf-webui.location.v2", JSON.stringify(location));
  }, configuredLocation);
  await page.route("**/api/sigint/captures?**", async (route) => {
    await route.fulfill({
      json: {
        items: [{ captureSessionId: captureSummary.id, ...captureSummary }],
        counts: { total: 1, pending: 1, kept: 0, discarded: 0, flagged: 0, withAudio: 0, withRawIq: 0 },
      },
    });
  });
  await page.route("**/api/sigint/captures/review-layout-capture", async (route) => {
    if (route.request().method() === "PATCH") {
      const update = route.request().postDataJSON() as { status: string; priority: string; notes: string };
      await route.fulfill({ json: {
        ...captureSummary,
        reviewStatus: update.status,
        reviewPriority: update.priority,
        reviewNotes: update.notes,
        reviewedAt: "2026-08-11T00:01:00.000Z",
        metadata: null,
        location: null,
        tags: [],
        transcripts: [],
        analysisJobs: [],
      } });
      return;
    }
    await route.fulfill({ json: { ...captureSummary, metadata: null, location: null, tags: [], transcripts: [], analysisJobs: [] } });
  });

  await page.goto("/sigint");
  const reviewBar = page.getByTestId("sigint-capture-queue-review-bar");
  await expect(reviewBar).toBeVisible();
  await expect(reviewBar.getByLabel("Review decision: pending")).toBeVisible();
  await expect(reviewBar.getByRole("button", { name: /save review/i })).toHaveCount(0);
  await expect(page.getByTestId("sigint-evidence-detail").getByLabel("Review decision: pending")).toHaveCount(0);

  const keptRequest = page.waitForRequest((request) => request.method() === "PATCH" && request.url().endsWith("/review-layout-capture"));
  await reviewBar.getByLabel("Review decision: kept").click();
  await expect(reviewBar.getByText("Choose priority to save")).toBeVisible();
  await reviewBar.getByLabel("Review priority: high").click();
  expect((await keptRequest).postDataJSON()).toMatchObject({ status: "kept", priority: "high" });

  const discardedRequest = page.waitForRequest((request) => request.method() === "PATCH" && request.url().endsWith("/review-layout-capture"));
  await reviewBar.getByLabel("Review decision: discarded").click();
  expect((await discardedRequest).postDataJSON()).toMatchObject({ status: "discarded", priority: "normal" });
});
