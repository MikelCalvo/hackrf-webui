import assert from "node:assert/strict";
import test from "node:test";

import {
  applySigintFilterView,
  buildSigintFilterChips,
  countSigintFilterOptions,
  hasActiveSigintCaptureFilters,
  matchesSigintCaptureFilters,
  nextVisibleCaptureId,
  resetSigintCaptureFilters,
} from "@/lib/sigint-filters";
import type { SigintCaptureListFilters, SigintCaptureSummary } from "@/lib/sigint";

function capture(overrides: Partial<SigintCaptureSummary> = {}): SigintCaptureSummary {
  return {
    id: "capture-1",
    activityEventId: null,
    burstEventId: null,
    module: "pmr",
    mode: "scan",
    reason: "activity",
    label: "Test capture",
    freqMhz: 145.5,
    demodMode: "nfm",
    startedAt: "2026-08-10T00:00:00.000Z",
    endedAt: "2026-08-10T00:00:01.000Z",
    durationMs: 1000,
    reviewStatus: "pending",
    reviewPriority: "normal",
    reviewNotes: "",
    reviewedAt: null,
    locationLabel: "Test",
    locationSource: null,
    locationSourceDetail: null,
    cityName: null,
    countryName: null,
    countryCode: null,
    resolvedLatitude: null,
    resolvedLongitude: null,
    deviceLabel: null,
    deviceSerial: null,
    rmsAvg: null,
    rmsPeak: null,
    rfPeak: null,
    squelch: null,
    lna: null,
    vga: null,
    audioGain: null,
    audioCapture: null,
    rawIqCapture: null,
    tagCount: 0,
    transcriptCount: 0,
    analysisJobCount: 1,
    analysisSummary: {
      status: "completed",
      engine: "sigint-audio-v2",
      isCurrentEngine: true,
      model: "base",
      classification: "unknown",
      subclass: null,
      confidence: 0.5,
      errorText: null,
      updatedAt: null,
      audioSeconds: 1,
      rms: 0.1,
      sceneLabel: null,
      sceneConfidence: null,
      voiceDetected: true,
      voiceConfidence: 0.8,
      voiceRatio: 0.2,
      voiceSeconds: 0.2,
      voiceDetector: "silero",
      transcriptAccepted: false,
      transcriptConfidence: null,
      transcriptLanguage: null,
      transcriptLanguageConfidence: null,
      explanation: null,
      topLabels: [],
    },
    ...overrides,
  };
}

const filters: SigintCaptureListFilters = {
  module: "all",
  reviewStatus: "all",
  analysis: "all",
  hasAudio: false,
  hasRawIq: false,
  q: "",
  limit: 200,
};

test("voice filter includes VAD-positive captures even when broad class is unknown", () => {
  assert.equal(matchesSigintCaptureFilters(capture(), { ...filters, analysis: "voice" }), true);
  assert.equal(matchesSigintCaptureFilters(capture({
    analysisSummary: { ...capture().analysisSummary, voiceDetected: false },
  }), { ...filters, analysis: "voice" }), false);
});

test("speech filter remains a narrower broad-class filter", () => {
  assert.equal(matchesSigintCaptureFilters(capture(), { ...filters, analysis: "speech" }), false);
  assert.equal(matchesSigintCaptureFilters(capture({
    analysisSummary: { ...capture().analysisSummary, classification: "speech" },
  }), { ...filters, analysis: "speech" }), true);
});

test("review queue advances to the next visible capture when an item leaves the active filter", () => {
  const items = [capture({ id: "a" }), capture({ id: "b" }), capture({ id: "c" })];
  assert.equal(nextVisibleCaptureId(items, "a"), "b");
  assert.equal(nextVisibleCaptureId(items, "b"), "c");
  assert.equal(nextVisibleCaptureId(items, "c"), "b");
});

test("clear filters resets the complete capture filter set while preserving the result limit", () => {
  const active: SigintCaptureListFilters = {
    module: "maritime",
    reviewStatus: "pending",
    analysis: "voice",
    hasAudio: true,
    hasRawIq: true,
    q: "bilbao",
    limit: 75,
  };

  assert.equal(hasActiveSigintCaptureFilters(active), true);
  assert.deepEqual(resetSigintCaptureFilters(active), {
    module: "all",
    reviewStatus: "all",
    analysis: "all",
    hasAudio: false,
    hasRawIq: false,
    q: "",
    limit: 75,
  });
  assert.equal(hasActiveSigintCaptureFilters(resetSigintCaptureFilters(active)), false);
});

test("saved filter views replace active filters without changing the result limit", () => {
  const active: SigintCaptureListFilters = { ...filters, reviewStatus: "kept", q: "old", limit: 75 };
  assert.deepEqual(applySigintFilterView(active, "unreviewed-voice"), {
    ...filters,
    reviewStatus: "pending",
    analysis: "voice",
    limit: 75,
  });
  assert.deepEqual(applySigintFilterView(active, "failed-ai"), {
    ...filters,
    analysis: "failed",
    limit: 75,
  });
  assert.deepEqual(applySigintFilterView(active, "raw-iq"), {
    ...filters,
    hasRawIq: true,
    limit: 75,
  });
});

test("active filter chips describe every removable filter", () => {
  const active: SigintCaptureListFilters = {
    module: "airband",
    reviewStatus: "flagged",
    analysis: "voice",
    hasAudio: true,
    hasRawIq: true,
    q: "guard",
    limit: 200,
  };
  assert.deepEqual(buildSigintFilterChips(active).map((chip) => chip.id), [
    "query",
    "reviewStatus",
    "module",
    "analysis",
    "hasAudio",
    "hasRawIq",
  ]);
  const withoutAnalysis = buildSigintFilterChips(active).find((chip) => chip.id === "analysis")?.clear(active);
  assert.equal(withoutAnalysis?.analysis, "all");
  assert.equal(withoutAnalysis?.reviewStatus, "flagged");
});

test("filter option counts are calculated independently of the option being counted", () => {
  const items = [
    capture({ id: "pending-voice", module: "pmr", reviewStatus: "pending", audioCapture: { id: "wav", kind: "audio", format: "wav", relativePath: "a.wav", url: "/wav" } }),
    capture({ id: "kept-speech", module: "airband", reviewStatus: "kept", analysisSummary: { ...capture().analysisSummary, classification: "speech", voiceDetected: true } }),
    capture({ id: "failed-sea", module: "maritime", reviewStatus: "flagged", analysisSummary: { ...capture().analysisSummary, status: "failed", voiceDetected: null } }),
  ];
  const active = { ...filters, reviewStatus: "pending" as const };
  const counts = countSigintFilterOptions(items, active);
  assert.equal(counts.reviewStatus.pending, 1);
  assert.equal(counts.reviewStatus.kept, 1);
  assert.equal(counts.module.pmr, 1);
  assert.equal(counts.module.airband, 0);
  assert.equal(counts.analysis.voice, 1);
  assert.equal(counts.analysis.failed, 0);
  assert.equal(counts.media.audio, 1);
});
