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
  const patchPayloads: Array<{ status: string; priority: string; notes: string }> = [];
  let delayFirstPatch = false;
  let releaseFirstPatch: (() => void) | null = null;
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
      patchPayloads.push(update);
      if (delayFirstPatch && patchPayloads.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstPatch = resolve;
        });
      }
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

  const notes = page.getByLabel("Analyst notes");
  await notes.fill("Confirmed voice traffic");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.waitForRequest((request) => request.method() === "PATCH" && request.url().endsWith("/review-layout-capture") && request.postDataJSON().notes === "Confirmed voice traffic");
  await expect(page.getByText("Notes saved")).toBeVisible();

  delayFirstPatch = true;
  patchPayloads.length = 0;
  await notes.fill("Race-safe note");
  await page.waitForRequest((request) => request.method() === "PATCH" && request.url().endsWith("/review-layout-capture") && request.postDataJSON().notes === "Race-safe note");
  await reviewBar.getByLabel("Review decision: flagged").click();
  await expect(reviewBar.getByText("Choose priority to save")).toBeVisible();
  const priorityClick = reviewBar.getByLabel("Review priority: high").click();
  const release = releaseFirstPatch as (() => void) | null;
  if (!release) throw new Error("Expected delayed note request.");
  release();
  await priorityClick;
  await expect.poll(() => patchPayloads.at(-1)).toMatchObject({ status: "flagged", priority: "high", notes: "Race-safe note" });
  await expect(page.getByLabel("Analyst notes")).toHaveValue("Race-safe note");
  delayFirstPatch = false;

  await expect(page.getByLabel("Collapse filters")).toBeVisible();
  await page.getByLabel("Collapse filters").click();
  await expect(page.getByLabel("Expand filters")).toBeVisible();
  await page.getByLabel("Expand filters").click();
  await expect(page.getByRole("button", { name: /unreviewed voice/i })).toBeVisible();
  await page.getByRole("button", { name: /unreviewed voice/i }).click();
  await page.getByRole("button", { name: "Save current" }).click();
  await page.getByLabel("Saved view name").fill("Pending PMR");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pending PMR", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pending PMR", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pending review" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /All AI/ }).click();

  await page.getByLabel("Collapse evidence detail").click();
  await expect(page.getByLabel("Expand evidence detail")).toBeVisible();
  await page.getByLabel("Expand evidence detail").click();
  await expect(page.getByLabel("Analyst notes")).toHaveValue("Race-safe note");

  const keptRequest = page.waitForRequest((request) => request.method() === "PATCH" && request.url().endsWith("/review-layout-capture"));
  await reviewBar.getByLabel("Review decision: kept").click();
  await expect(reviewBar.getByText("Choose priority to save")).toBeVisible();
  await reviewBar.getByLabel("Review priority: high").click();
  expect((await keptRequest).postDataJSON()).toMatchObject({ status: "kept", priority: "high" });

  const discardedRequest = page.waitForRequest((request) => request.method() === "PATCH" && request.url().endsWith("/review-layout-capture"));
  await reviewBar.getByLabel("Review decision: discarded").click();
  expect((await discardedRequest).postDataJSON()).toMatchObject({ status: "discarded", priority: "normal" });
});
