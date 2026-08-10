import assert from "node:assert/strict";
import test from "node:test";

import {
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
