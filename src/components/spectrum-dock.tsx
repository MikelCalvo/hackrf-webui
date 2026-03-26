"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { cx } from "@/components/module-ui";
import type { AudioDemodMode, SpectrumFeedSnapshot, SpectrumFrame, SpectrumOwner } from "@/lib/types";

const STORAGE_PREFIX = "hackrf-webui.spectrum-dock.v1";
const CLOSED_POLL_MS = 1500;
const OPEN_POLL_MS = 250;
const LINE_HEIGHT = 56;
const TIGHT_LINE_HEIGHT = 40;
const DEFAULT_WATERFALL_HEIGHT = 160;
const MIN_WATERFALL_HEIGHT = 20;
const MAX_WATERFALL_HEIGHT = 360;
const TIGHT_WATERFALL_THRESHOLD = 64;
const WATERFALL_HISTORY_LIMIT = MAX_WATERFALL_HEIGHT;
const DEFAULT_ZOOM = 1;
const MIN_ZOOM = 1;
const MAX_ZOOM = 24;
const SCAN_ACTIVITY_DECAY = 0.97;
const SCAN_ACTIVITY_PROFILE_BINS = 1024;
const AIS_FRAME_HISTORY_LIMIT = 18;
const AIS_CENTER_SPUR_SUPPRESSION_WIDTH_HZ = 6_000;
const AIS_SPECTRUM_SMOOTHING_RADIUS = 2;

type SpectrumDockProps = {
  moduleId: string;
  viewRangeHz?: { minFreqHz: number; maxFreqHz: number } | null;
  maxZoom?: number;
  lockViewToRange?: boolean;
  profile?: "default" | "ais" | "wfm";
  expectedOwner?: SpectrumOwner;
  expectedDemodMode?: AudioDemodMode | null;
  markers?: Array<{
    freqHz: number;
    label: string;
    tone?: "accent" | "muted" | "danger" | "ops" | "weather" | "saved";
  }>;
};

type SpectrumDockPrefs = {
  expanded: boolean;
  open: boolean;
  waterfallHeight: number;
  zoom: number;
  hideCenterSpur: boolean;
  lineMode: "live" | "average" | "peak";
};

const DEFAULT_PREFS: SpectrumDockPrefs = {
  expanded: false,
  open: false,
  waterfallHeight: DEFAULT_WATERFALL_HEIGHT,
  zoom: DEFAULT_ZOOM,
  hideCenterSpur: true,
  lineMode: "live",
};

function storageKey(moduleId: string): string {
  return `${STORAGE_PREFIX}.${moduleId}`;
}

function loadPrefs(moduleId: string): SpectrumDockPrefs {
  try {
    const raw = window.localStorage.getItem(storageKey(moduleId));
    if (!raw) {
      return DEFAULT_PREFS;
    }
    const parsed = JSON.parse(raw) as Partial<SpectrumDockPrefs>;
    return {
      expanded: parsed.expanded === true,
      open: parsed.open === true,
      waterfallHeight:
        Number.isFinite(parsed.waterfallHeight)
          ? Math.max(MIN_WATERFALL_HEIGHT, Math.min(MAX_WATERFALL_HEIGHT, Number(parsed.waterfallHeight)))
          : DEFAULT_WATERFALL_HEIGHT,
      zoom:
        Number.isFinite(parsed.zoom) && Number(parsed.zoom) > 0 ? clampZoom(Number(parsed.zoom)) : DEFAULT_ZOOM,
      hideCenterSpur: parsed.hideCenterSpur !== false,
      lineMode:
        parsed.lineMode === "average" || parsed.lineMode === "peak" || parsed.lineMode === "live"
          ? parsed.lineMode
          : "live",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function maxWaterfallHeight(): number {
  if (typeof window === "undefined") {
    return MAX_WATERFALL_HEIGHT;
  }
  return Math.max(MIN_WATERFALL_HEIGHT, Math.min(MAX_WATERFALL_HEIGHT, Math.round(window.innerHeight * 0.42)));
}

function clampWaterfallHeight(value: number): number {
  return Math.max(MIN_WATERFALL_HEIGHT, Math.min(maxWaterfallHeight(), Math.round(value)));
}

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(value.toFixed(2))));
}

function clampZoomToBounds(value: number, minZoom: number, maxZoom: number): number {
  return Math.max(minZoom, Math.min(maxZoom, clampZoom(value)));
}

type FrequencyWindow = {
  minFreqHz: number;
  maxFreqHz: number;
  tunedFreqHz: number;
};

type WaterfallColor = [number, number, number] | null;

type WaterfallRow = {
  colors: WaterfallColor[];
  minFreqHz: number;
  maxFreqHz: number;
};

type ScanActivityState = {
  values: Float32Array;
  minFreqHz: number;
  maxFreqHz: number;
};

type SpectrumMarker = NonNullable<SpectrumDockProps["markers"]>[number];

function markerColor(
  tone: SpectrumMarker["tone"],
  variant: "strong" | "mid" | "soft",
  profile: "default" | "ais" | "wfm" = "default",
): string {
  switch (tone) {
    case "danger":
      return variant === "strong"
        ? "rgba(248, 122, 122, 0.82)"
        : variant === "mid"
          ? "rgba(248, 122, 122, 0.44)"
          : "rgba(248, 122, 122, 0.22)";
    case "ops":
      return variant === "strong"
        ? "rgba(255, 194, 107, 0.82)"
        : variant === "mid"
          ? "rgba(255, 194, 107, 0.42)"
          : "rgba(255, 194, 107, 0.2)";
    case "weather":
      return variant === "strong"
        ? "rgba(126, 170, 255, 0.82)"
        : variant === "mid"
          ? "rgba(126, 170, 255, 0.42)"
          : "rgba(126, 170, 255, 0.2)";
    case "saved":
      return variant === "strong"
        ? "rgba(196, 162, 255, 0.8)"
        : variant === "mid"
          ? "rgba(196, 162, 255, 0.4)"
          : "rgba(196, 162, 255, 0.18)";
    case "muted":
      return variant === "strong"
        ? "rgba(193, 210, 224, 0.52)"
        : variant === "mid"
          ? "rgba(193, 210, 224, 0.24)"
          : "rgba(193, 210, 224, 0.12)";
    case "accent":
    default:
      if (profile === "wfm") {
        return variant === "strong"
          ? "rgba(102, 219, 255, 0.86)"
          : variant === "mid"
            ? "rgba(102, 219, 255, 0.3)"
            : "rgba(102, 219, 255, 0.18)";
      }
      return variant === "strong"
        ? "rgba(87, 215, 255, 0.78)"
        : variant === "mid"
          ? "rgba(87, 215, 255, 0.34)"
          : "rgba(87, 215, 255, 0.22)";
  }
}

async function fetchSpectrumFeed(): Promise<SpectrumFeedSnapshot> {
  const response = await fetch("/api/spectrum", {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as SpectrumFeedSnapshot;
}

function isExpectedSpectrumFeed(
  snapshot: SpectrumFeedSnapshot | null,
  expectedOwner: SpectrumOwner,
  expectedDemodMode: AudioDemodMode | null | undefined,
): boolean {
  if (!snapshot) {
    return false;
  }
  if (expectedOwner !== null && snapshot.owner !== expectedOwner) {
    return false;
  }
  if (expectedDemodMode === undefined) {
    return true;
  }
  return snapshot.stream?.demodMode === expectedDemodMode;
}

function sanitizeSnapshotForModule(
  snapshot: SpectrumFeedSnapshot | null,
  expectedOwner: SpectrumOwner,
  expectedDemodMode: AudioDemodMode | null | undefined,
): SpectrumFeedSnapshot | null {
  if (!snapshot) {
    return null;
  }
  if (isExpectedSpectrumFeed(snapshot, expectedOwner, expectedDemodMode)) {
    return snapshot;
  }
  return {
    ...snapshot,
    frame: null,
    stream: null,
  };
}

function formatFreqMHz(freqHz: number | null): string {
  return freqHz === null ? "—" : `${(freqHz / 1_000_000).toFixed(3)} MHz`;
}

function toneForState(state: SpectrumFeedSnapshot["state"]): string {
  switch (state) {
    case "ready":
      return "bg-emerald-300";
    case "waiting":
      return "bg-amber-300";
    case "blocked":
      return "bg-rose-300";
    default:
      return "bg-white/25";
  }
}

function textToneForState(state: SpectrumFeedSnapshot["state"]): string {
  switch (state) {
    case "ready":
      return "text-emerald-100";
    case "waiting":
      return "text-amber-100";
    case "blocked":
      return "text-rose-100";
    default:
      return "text-[var(--muted-strong)]";
  }
}

function paletteForValue(
  value: number,
  profile: "default" | "ais" | "wfm" = "default",
): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, value));
  if (profile === "wfm") {
    if (clamped < 0.22) {
      const t = clamped / 0.22;
      return [
        Math.round(6 + (18 - 6) * t),
        Math.round(12 + (38 - 12) * t),
        Math.round(24 + (82 - 24) * t),
      ];
    }
    if (clamped < 0.5) {
      const t = (clamped - 0.22) / 0.28;
      return [
        Math.round(18 + (37 - 18) * t),
        Math.round(38 + (110 - 38) * t),
        Math.round(82 + (176 - 82) * t),
      ];
    }
    if (clamped < 0.8) {
      const t = (clamped - 0.5) / 0.3;
      return [
        Math.round(37 + (86 - 37) * t),
        Math.round(110 + (203 - 110) * t),
        Math.round(176 + (228 - 176) * t),
      ];
    }
    const t = (clamped - 0.8) / 0.2;
    return [
      Math.round(86 + (246 - 86) * t),
      Math.round(203 + (237 - 203) * t),
      Math.round(228 + (173 - 228) * t),
    ];
  }
  if (clamped < 0.22) {
    const t = clamped / 0.22;
    return [
      Math.round(7 + (20 - 7) * t),
      Math.round(15 + (55 - 15) * t),
      Math.round(28 + (92 - 28) * t),
    ];
  }
  if (clamped < 0.5) {
    const t = (clamped - 0.22) / 0.28;
    return [
      Math.round(20 + (33 - 20) * t),
      Math.round(55 + (118 - 55) * t),
      Math.round(92 + (170 - 92) * t),
    ];
  }
  if (clamped < 0.78) {
    const t = (clamped - 0.5) / 0.28;
    return [
      Math.round(33 + (74 - 33) * t),
      Math.round(118 + (208 - 118) * t),
      Math.round(170 + (187 - 170) * t),
    ];
  }
  const t = (clamped - 0.78) / 0.22;
  return [
    Math.round(74 + (248 - 74) * t),
    Math.round(208 + (232 - 208) * t),
    Math.round(187 + (160 - 187) * t),
  ];
}

function sortNumeric(values: number[]): number[] {
  return [...values].sort((left, right) => left - right);
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = sortNumeric(values);
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * clampedRatio)));
  return sorted[index] ?? 0;
}

function suppressBinsRegion(
  bins: number[],
  centerIndex: number,
  halfWidthBins: number,
): number[] {
  if (bins.length === 0 || halfWidthBins <= 0) {
    return bins;
  }

  const next = [...bins];
  const boundedCenterIndex = Math.max(0, Math.min(next.length - 1, centerIndex));
  const leftAnchorIndex = Math.max(0, boundedCenterIndex - halfWidthBins - 1);
  const rightAnchorIndex = Math.min(next.length - 1, boundedCenterIndex + halfWidthBins + 1);
  const leftAnchor = next[leftAnchorIndex] ?? 0;
  const rightAnchor = next[rightAnchorIndex] ?? leftAnchor;
  const fillBase = Math.min(leftAnchor, rightAnchor);

  for (let offset = -halfWidthBins; offset <= halfWidthBins; offset += 1) {
    const index = boundedCenterIndex + offset;
    if (index < 0 || index >= next.length) {
      continue;
    }
    const ratio = (offset + halfWidthBins) / Math.max(1, halfWidthBins * 2);
    const bridge = leftAnchor + (rightAnchor - leftAnchor) * ratio;
    next[index] = fillBase * 0.78 + bridge * 0.22;
  }

  return next;
}

function suppressRegionByFrequency(
  bins: number[],
  spanHz: number,
  widthHz: number,
  centerRatio: number,
): number[] {
  if (bins.length === 0 || widthHz <= 0 || spanHz <= 0) {
    return bins;
  }

  const halfWidthBins = Math.max(1, Math.round((widthHz / spanHz) * bins.length * 0.5));
  const centerIndex = Math.round(Math.max(0, Math.min(1, centerRatio)) * Math.max(0, bins.length - 1));
  return suppressBinsRegion(bins, centerIndex, halfWidthBins);
}

function normalizeBinsForDisplay(
  bins: number[],
  frame: SpectrumFrame,
  profile: "default" | "ais" | "wfm",
  hideCenterSpur: boolean,
  centerRatio: number | null = null,
  spanHzOverride: number | null = null,
): number[] {
  if (bins.length === 0) {
    return bins;
  }

  let working = bins;
  if (profile === "ais" && hideCenterSpur) {
    working = suppressRegionByFrequency(
      working,
      spanHzOverride ?? frame.spanHz,
      AIS_CENTER_SPUR_SUPPRESSION_WIDTH_HZ,
      centerRatio ?? 0.5,
    );
  }

  const floorRatio = profile === "ais" ? 0.64 : profile === "wfm" ? 0.48 : 0.56;
  const floor = percentile(working, floorRatio);
  const lifted = working.map((value) => Math.max(0, value - floor));
  const maxValue = Math.max(...lifted, 0);
  if (maxValue <= 1e-6) {
    return lifted.map(() => 0);
  }

  const gamma = profile === "ais" ? 1.18 : profile === "wfm" ? 0.92 : 1;
  let normalized = lifted.map((value) => {
    const normalized = Math.max(0, Math.min(1, value / maxValue));
    return Math.pow(normalized, gamma);
  });

  if (profile === "ais" && hideCenterSpur) {
    normalized = suppressRegionByFrequency(
      normalized,
      spanHzOverride ?? frame.spanHz,
      AIS_CENTER_SPUR_SUPPRESSION_WIDTH_HZ,
      centerRatio ?? 0.5,
    );
  }

  if (profile === "ais") {
    normalized = smoothBins(normalized, AIS_SPECTRUM_SMOOTHING_RADIUS);
  }

  return normalized;
}

function smoothBins(bins: number[], radius: number): number[] {
  if (bins.length < 3 || radius <= 0) {
    return bins;
  }

  return bins.map((_, index) => {
    let total = 0;
    let totalWeight = 0;

    for (let offset = -radius; offset <= radius; offset += 1) {
      const sample = bins[index + offset];
      if (sample === undefined) {
        continue;
      }

      const weight = radius + 1 - Math.abs(offset);
      total += sample * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? total / totalWeight : bins[index] ?? 0;
  });
}

function formatViewFreqMHz(freqHz: number | null, spanHz: number | null): string {
  if (freqHz === null) {
    return "—";
  }
  const absSpanHz = spanHz === null ? null : Math.abs(spanHz);
  let digits = 3;
  if (absSpanHz !== null && absSpanHz <= 1_000_000) {
    digits = 4;
  }
  if (absSpanHz !== null && absSpanHz <= 250_000) {
    digits = 5;
  }
  if (absSpanHz !== null && absSpanHz <= 25_000) {
    digits = 6;
  }
  return `${(freqHz / 1_000_000).toFixed(digits)} MHz`;
}

function rulerTickCount(spanHz: number | null): number {
  if (spanHz === null) {
    return 3;
  }
  if (spanHz <= 120_000) {
    return 11;
  }
  if (spanHz <= 300_000) {
    return 9;
  }
  if (spanHz <= 900_000) {
    return 7;
  }
  if (spanHz <= 2_000_000) {
    return 5;
  }
  return 3;
}

function frameBounds(frame: SpectrumFrame): { minFreqHz: number; maxFreqHz: number } {
  return {
    minFreqHz: frame.centerFreqHz - frame.spanHz / 2,
    maxFreqHz: frame.centerFreqHz + frame.spanHz / 2,
  };
}

function intersectRange(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
): { minFreqHz: number; maxFreqHz: number } | null {
  const minFreqHz = Math.max(aMin, bMin);
  const maxFreqHz = Math.min(aMax, bMax);
  return maxFreqHz > minFreqHz ? { minFreqHz, maxFreqHz } : null;
}

function resolveZoomBounds(
  frame: SpectrumFrame | null,
  viewRangeHz: { minFreqHz: number; maxFreqHz: number } | null,
  maxZoom: number,
): { minZoom: number; maxZoom: number } {
  const boundedMaxZoom = clampZoom(maxZoom);
  if (!frame || !viewRangeHz) {
    return { minZoom: MIN_ZOOM, maxZoom: boundedMaxZoom };
  }
  return { minZoom: MIN_ZOOM, maxZoom: boundedMaxZoom };
}

function resolveFrequencyWindow(
  frame: SpectrumFrame,
  zoom: number,
  viewRangeHz: { minFreqHz: number; maxFreqHz: number } | null,
  lockViewToRange: boolean,
): FrequencyWindow {
  const tunedFreqHz = frame.centerFreqHz;

  if (!viewRangeHz) {
    const spanHz = frame.spanHz / zoom;
    return {
      minFreqHz: tunedFreqHz - spanHz / 2,
      maxFreqHz: tunedFreqHz + spanHz / 2,
      tunedFreqHz,
    };
  }

  const allowedSpanHz = viewRangeHz.maxFreqHz - viewRangeHz.minFreqHz;
  const requestedSpanHz = allowedSpanHz / zoom;
  if (requestedSpanHz >= allowedSpanHz - 1) {
    return {
      minFreqHz: viewRangeHz.minFreqHz,
      maxFreqHz: viewRangeHz.maxFreqHz,
      tunedFreqHz,
    };
  }

  const anchorFreqHz = lockViewToRange
    ? viewRangeHz.minFreqHz + allowedSpanHz / 2
    : tunedFreqHz;
  let minFreqHz = anchorFreqHz - requestedSpanHz / 2;
  let maxFreqHz = anchorFreqHz + requestedSpanHz / 2;
  if (minFreqHz < viewRangeHz.minFreqHz) {
    maxFreqHz += viewRangeHz.minFreqHz - minFreqHz;
    minFreqHz = viewRangeHz.minFreqHz;
  }
  if (maxFreqHz > viewRangeHz.maxFreqHz) {
    minFreqHz -= maxFreqHz - viewRangeHz.maxFreqHz;
    maxFreqHz = viewRangeHz.maxFreqHz;
  }

  return {
    minFreqHz,
    maxFreqHz,
    tunedFreqHz,
  };
}

function extractBinsForWindow(frame: SpectrumFrame, window: FrequencyWindow): number[] {
  if (frame.bins.length === 0) {
    return [];
  }
  const frameRange = frameBounds(frame);
  const overlap = intersectRange(frameRange.minFreqHz, frameRange.maxFreqHz, window.minFreqHz, window.maxFreqHz);
  if (!overlap) {
    return [];
  }

  const startRatio = (overlap.minFreqHz - frameRange.minFreqHz) / (frameRange.maxFreqHz - frameRange.minFreqHz);
  const endRatio = (overlap.maxFreqHz - frameRange.minFreqHz) / (frameRange.maxFreqHz - frameRange.minFreqHz);
  const startIndex = Math.max(0, Math.floor(startRatio * (frame.bins.length - 1)));
  const endIndex = Math.min(frame.bins.length, Math.ceil(endRatio * (frame.bins.length - 1)) + 1);
  return frame.bins.slice(startIndex, Math.max(startIndex + 1, endIndex));
}

function drawSpectrumLine(
  canvas: HTMLCanvasElement,
  frame: SpectrumFrame | null,
  theme: "active" | "inactive",
  window: FrequencyWindow | null,
  profile: "default" | "ais" | "wfm",
  markers: SpectrumMarker[],
  hideCenterSpur: boolean,
): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  context.fillStyle = theme === "active" ? "rgba(7, 16, 28, 0.98)" : "rgba(7, 16, 28, 0.84)";
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(255, 255, 255, 0.05)";
  context.lineWidth = 1;
  for (let row = 1; row <= 3; row++) {
    const y = (height / 4) * row;
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(width, y + 0.5);
    context.stroke();
  }

  if (!frame || !window || frame.bins.length === 0) {
    return;
  }

  const extractedBins = extractBinsForWindow(frame, window);
  const centerRatio =
    (frame.centerFreqHz - window.minFreqHz) / Math.max(1, window.maxFreqHz - window.minFreqHz);
  const bins = normalizeBinsForDisplay(
    extractedBins,
    frame,
    profile,
    hideCenterSpur,
    centerRatio,
    window.maxFreqHz - window.minFreqHz,
  );
  if (bins.length === 0) {
    return;
  }
  if (profile === "wfm") {
    const channelHalfWidthHz = 95_000;
    const startRatio = (window.tunedFreqHz - channelHalfWidthHz - window.minFreqHz) / Math.max(1, window.maxFreqHz - window.minFreqHz);
    const endRatio = (window.tunedFreqHz + channelHalfWidthHz - window.minFreqHz) / Math.max(1, window.maxFreqHz - window.minFreqHz);
    const startX = Math.max(0, Math.min(width, startRatio * width));
    const endX = Math.max(startX + 1, Math.min(width, endRatio * width));
    context.fillStyle = "rgba(87, 215, 255, 0.06)";
    context.fillRect(startX, 0, endX - startX, height);
  }

  const gradient = context.createLinearGradient(0, 0, 0, height);
  if (profile === "wfm") {
    gradient.addColorStop(0, "rgba(103, 212, 255, 0.62)");
    gradient.addColorStop(0.6, "rgba(95, 198, 255, 0.18)");
    gradient.addColorStop(1, "rgba(95, 198, 255, 0.02)");
  } else {
    gradient.addColorStop(0, "rgba(108, 232, 198, 0.55)");
    gradient.addColorStop(1, "rgba(108, 232, 198, 0.04)");
  }

  traceSpectrumPath(context, bins, width, height, profile === "ais");
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();

  traceSpectrumPath(context, bins, width, height, profile === "ais");
  context.strokeStyle =
    profile === "wfm"
      ? "rgba(112, 224, 255, 0.98)"
      : profile === "ais"
        ? "rgba(116, 238, 225, 0.98)"
        : "rgba(119, 241, 206, 0.95)";
  context.lineWidth = profile === "wfm" ? 1.6 : profile === "ais" ? 1.7 : 1.4;
  context.stroke();

  const visiblePeakIndex = bins.reduce((bestIndex, value, index, values) => {
    if (value > values[bestIndex]) {
      return index;
    }
    return bestIndex;
  }, 0);
  const peakX = bins.length <= 1 ? width / 2 : (visiblePeakIndex / (bins.length - 1)) * width;
  context.strokeStyle = "rgba(248, 232, 160, 0.22)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(peakX + 0.5, 0);
  context.lineTo(peakX + 0.5, height);
  context.stroke();

  const tunedRatio = (window.tunedFreqHz - window.minFreqHz) / Math.max(1, window.maxFreqHz - window.minFreqHz);
  const tunedX = Math.max(0, Math.min(width, tunedRatio * width));
  context.strokeStyle = "rgba(113, 236, 184, 0.9)";
  context.lineWidth = 1.2;
  context.beginPath();
  context.moveTo(tunedX + 0.5, 0);
  context.lineTo(tunedX + 0.5, height);
  context.stroke();

  context.fillStyle = "rgba(113, 236, 184, 0.95)";
  context.beginPath();
  context.moveTo(tunedX, 3);
  context.lineTo(tunedX - 4, 9);
  context.lineTo(tunedX + 4, 9);
  context.closePath();
  context.fill();

  for (const marker of markers) {
    if (marker.freqHz < window.minFreqHz || marker.freqHz > window.maxFreqHz) {
      continue;
    }

    const ratio = (marker.freqHz - window.minFreqHz) / Math.max(1, window.maxFreqHz - window.minFreqHz);
    const x = Math.max(0, Math.min(width, ratio * width));
    const color = markerColor(marker.tone, "strong", profile);

    context.strokeStyle = color;
    context.lineWidth = marker.tone === "accent" ? 1.1 : 1;
    context.beginPath();
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, height);
    context.stroke();
  }

  context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  let lastLabelRight = -Infinity;
  for (const marker of markers) {
    if (marker.freqHz < window.minFreqHz || marker.freqHz > window.maxFreqHz) {
      continue;
    }

    const ratio = (marker.freqHz - window.minFreqHz) / Math.max(1, window.maxFreqHz - window.minFreqHz);
    const x = Math.max(0, Math.min(width, ratio * width));
    const color = markerColor(marker.tone, "strong", profile);
    const align = x > width - 84 ? "right" : x < 84 ? "left" : "center";
    context.textAlign = align;
    const measuredWidth = context.measureText(marker.label).width;
    const labelLeft =
      align === "right"
        ? x - measuredWidth
        : align === "left"
          ? x
          : x - measuredWidth / 2;
    const labelRight =
      align === "right"
        ? x
        : align === "left"
          ? x + measuredWidth
          : x + measuredWidth / 2;

    if (labelLeft <= lastLabelRight + 10) {
      continue;
    }

    context.fillStyle = color;
    context.fillText(marker.label, x, 14);
    lastLabelRight = labelRight;
  }
}

function buildWaterfallPaletteRow(
  frame: SpectrumFrame | null,
  profile: "default" | "ais" | "wfm",
  hideCenterSpur: boolean,
): WaterfallRow | null {
  if (!frame || frame.bins.length === 0) {
    return null;
  }

  const bounds = frameBounds(frame);
  return {
    colors: normalizeBinsForDisplay(frame.bins, frame, profile, hideCenterSpur).map((bin) =>
      paletteForValue(bin, profile),
    ),
    minFreqHz: bounds.minFreqHz,
    maxFreqHz: bounds.maxFreqHz,
  };
}

function buildAggregateFrame(
  frames: SpectrumFrame[],
  mode: "live" | "average" | "peak",
): SpectrumFrame | null {
  if (frames.length === 0) {
    return null;
  }
  if (mode === "live" || frames.length === 1) {
    return frames[frames.length - 1] ?? null;
  }

  const latest = frames[frames.length - 1]!;
  const binCount = latest.bins.length;
  if (binCount === 0) {
    return latest;
  }

  const compatible = frames.filter(
    (frame) =>
      frame.bins.length === binCount
      && frame.centerFreqHz === latest.centerFreqHz
      && frame.spanHz === latest.spanHz,
  );
  if (compatible.length === 0) {
    return latest;
  }

  const bins = Array.from({ length: binCount }, (_, index) => {
    if (mode === "peak") {
      let maxValue = 0;
      for (const frame of compatible) {
        maxValue = Math.max(maxValue, frame.bins[index] ?? 0);
      }
      return maxValue;
    }

    let sum = 0;
    for (const frame of compatible) {
      sum += frame.bins[index] ?? 0;
    }
    return sum / compatible.length;
  });

  let peakIndex = 0;
  for (let index = 1; index < bins.length; index += 1) {
    if ((bins[index] ?? 0) > (bins[peakIndex] ?? 0)) {
      peakIndex = index;
    }
  }

  return {
    bins,
    centerFreqHz: latest.centerFreqHz,
    spanHz: latest.spanHz,
    peakIndex,
    updatedAt: latest.updatedAt,
  };
}

function traceSpectrumPath(
  context: CanvasRenderingContext2D,
  bins: number[],
  width: number,
  height: number,
  smooth: boolean,
): void {
  if (bins.length === 0) {
    return;
  }

  const points = bins.map((bin, index) => ({
    x: bins.length === 1 ? width / 2 : (index / (bins.length - 1)) * width,
    y: height - bin * (height - 10) - 5,
  }));

  context.beginPath();
  context.moveTo(points[0]!.x, points[0]!.y);

  if (smooth && points.length > 2) {
    for (let index = 1; index < points.length - 1; index += 1) {
      const current = points[index]!;
      const next = points[index + 1]!;
      context.quadraticCurveTo(current.x, current.y, (current.x + next.x) * 0.5, (current.y + next.y) * 0.5);
    }

    const beforeLast = points[points.length - 2]!;
    const last = points[points.length - 1]!;
    context.quadraticCurveTo(beforeLast.x, beforeLast.y, last.x, last.y);
    return;
  }

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    context.lineTo(point.x, point.y);
  }
}

function createScanActivityState(viewRangeHz: { minFreqHz: number; maxFreqHz: number }): ScanActivityState {
  return {
    minFreqHz: viewRangeHz.minFreqHz,
    maxFreqHz: viewRangeHz.maxFreqHz,
    values: new Float32Array(SCAN_ACTIVITY_PROFILE_BINS),
  };
}

function drawBandActivity(
  canvas: HTMLCanvasElement,
  activity: ScanActivityState | null,
  window: FrequencyWindow | null,
  markers: SpectrumMarker[],
): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgba(5, 10, 18, 0.94)";
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(255, 255, 255, 0.05)";
  context.lineWidth = 1;
  for (let row = 1; row <= 3; row += 1) {
    const y = (height / 4) * row;
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(width, y + 0.5);
    context.stroke();
  }

  if (!window) {
    return;
  }
  if (!activity) {
    return;
  }

  const bandSpanHz = activity.maxFreqHz - activity.minFreqHz;
  if (bandSpanHz <= 0 || activity.values.length === 0) {
    return;
  }
  const drawableHeight = Math.max(12, height - 10);

  for (let x = 0; x < width; x += 1) {
    const ratio = width <= 1 ? 0.5 : x / (width - 1);
    const freqHz = window.minFreqHz + ratio * (window.maxFreqHz - window.minFreqHz);
    if (freqHz < activity.minFreqHz || freqHz > activity.maxFreqHz) {
      continue;
    }
    const activityRatio = (freqHz - activity.minFreqHz) / bandSpanHz;
    const activityIndex = Math.max(
      0,
      Math.min(activity.values.length - 1, Math.round(activityRatio * (activity.values.length - 1))),
    );
    const persistence = activity.values[activityIndex] ?? 0;
    if (persistence <= 0.015) {
      continue;
    }

    const [r, g, b] = paletteForValue(Math.min(1, persistence));
    const barHeight = Math.max(2, Math.round(persistence * drawableHeight));
    const y = height - barHeight;
    context.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(0.88, 0.18 + persistence * 0.55)})`;
    context.fillRect(x, y, 1, barHeight);
  }

  const tunedRatio = (window.tunedFreqHz - window.minFreqHz) / Math.max(1, window.maxFreqHz - window.minFreqHz);
  const tunedX = Math.max(0, Math.min(width, tunedRatio * width));
  context.strokeStyle = "rgba(113, 236, 184, 0.9)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(tunedX + 0.5, 0);
  context.lineTo(tunedX + 0.5, height);
  context.stroke();

  for (const marker of markers) {
    if (marker.freqHz < window.minFreqHz || marker.freqHz > window.maxFreqHz) {
      continue;
    }
    const ratio = (marker.freqHz - window.minFreqHz) / Math.max(1, window.maxFreqHz - window.minFreqHz);
    const x = Math.max(0, Math.min(width, ratio * width));
    context.strokeStyle =
      markerColor(marker.tone, "mid");
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, height);
    context.stroke();
  }
}

function drawWaterfall(
  canvas: HTMLCanvasElement,
  rows: Array<WaterfallRow | null>,
  window: FrequencyWindow | null,
  markers: SpectrumMarker[],
  profile: "default" | "ais" | "wfm",
): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);

  if (window && profile === "wfm") {
    const channelHalfWidthHz = 95_000;
    const startRatio =
      (window.tunedFreqHz - channelHalfWidthHz - window.minFreqHz) / Math.max(1, window.maxFreqHz - window.minFreqHz);
    const endRatio =
      (window.tunedFreqHz + channelHalfWidthHz - window.minFreqHz) / Math.max(1, window.maxFreqHz - window.minFreqHz);
    const startX = Math.max(0, Math.min(width, startRatio * width));
    const endX = Math.max(startX + 1, Math.min(width, endRatio * width));
    context.fillStyle = "rgba(93, 198, 255, 0.08)";
    context.fillRect(startX, 0, endX - startX, height);
  }

  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const row = rows[rowIndex] ?? null;
    if (!row || !window || row.colors.length === 0) {
      context.fillStyle = profile === "wfm" ? "rgba(4, 9, 18, 0.9)" : "rgba(5, 10, 18, 0.92)";
      context.fillRect(0, rowIndex, width, 1);
      continue;
    }

    context.fillStyle = profile === "wfm" ? "rgba(4, 9, 18, 0.9)" : "rgba(5, 10, 18, 0.92)";
    context.fillRect(0, rowIndex, width, 1);

    const overlap = intersectRange(row.minFreqHz, row.maxFreqHz, window.minFreqHz, window.maxFreqHz);
    if (!overlap) {
      continue;
    }

    const rowSpanHz = row.maxFreqHz - row.minFreqHz;
    const visibleSpanHz = window.maxFreqHz - window.minFreqHz;
    const rowStartRatio = (overlap.minFreqHz - row.minFreqHz) / rowSpanHz;
    const rowEndRatio = (overlap.maxFreqHz - row.minFreqHz) / rowSpanHz;
    const viewStartRatio = (overlap.minFreqHz - window.minFreqHz) / visibleSpanHz;
    const viewEndRatio = (overlap.maxFreqHz - window.minFreqHz) / visibleSpanHz;
    const startIndex = Math.max(0, Math.floor(rowStartRatio * (row.colors.length - 1)));
    const endIndex = Math.min(row.colors.length, Math.ceil(rowEndRatio * (row.colors.length - 1)) + 1);
    const visibleRow = row.colors.slice(startIndex, Math.max(startIndex + 1, endIndex));

    visibleRow.forEach((color, index) => {
      if (!color) {
        return;
      }
      const [r, g, b] = color;
      const start = Math.floor((viewStartRatio + (index / visibleRow.length) * (viewEndRatio - viewStartRatio)) * width);
      const end = Math.max(
        start + 1,
        Math.floor((viewStartRatio + ((index + 1) / visibleRow.length) * (viewEndRatio - viewStartRatio)) * width),
      );
      context.fillStyle = `rgb(${r}, ${g}, ${b})`;
      context.fillRect(start, rowIndex, end - start, 1);
    });
  }

  if (window) {
    const tunedRatio = (window.tunedFreqHz - window.minFreqHz) / Math.max(1, window.maxFreqHz - window.minFreqHz);
    const tunedX = Math.max(0, Math.min(width, tunedRatio * width));
    context.strokeStyle = "rgba(113, 236, 184, 0.9)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(tunedX + 0.5, 0);
    context.lineTo(tunedX + 0.5, height);
    context.stroke();

    for (const marker of markers) {
      if (marker.freqHz < window.minFreqHz || marker.freqHz > window.maxFreqHz) {
        continue;
      }
      const ratio = (marker.freqHz - window.minFreqHz) / Math.max(1, window.maxFreqHz - window.minFreqHz);
      const x = Math.max(0, Math.min(width, ratio * width));
      context.strokeStyle = markerColor(marker.tone, "soft", profile);
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, height);
      context.stroke();
    }
  }
}

export function SpectrumDock({
  moduleId,
  viewRangeHz = null,
  maxZoom = MAX_ZOOM,
  lockViewToRange = false,
  profile = "default",
  expectedOwner = "audio",
  expectedDemodMode,
  markers = [],
}: SpectrumDockProps) {
  const [prefs, setPrefs] = useState<SpectrumDockPrefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  const [snapshot, setSnapshot] = useState<SpectrumFeedSnapshot | null>(null);
  const [error, setError] = useState("");
  const lineCanvasRef = useRef<HTMLCanvasElement>(null);
  const waterfallCanvasRef = useRef<HTMLCanvasElement>(null);
  const dragStateRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const waterfallRowsRef = useRef<Array<WaterfallRow | null>>([]);
  const scanActivityRef = useRef<ScanActivityState | null>(null);
  const frameHistoryRef = useRef<SpectrumFrame[]>([]);

  useEffect(() => {
    const nextPrefs = loadPrefs(moduleId);
    setPrefs(nextPrefs);
    setReady(true);
  }, [moduleId]);

  useEffect(() => {
    if (!ready || prefs.open) {
      return;
    }
    window.localStorage.setItem(storageKey(moduleId), JSON.stringify(prefs));
  }, [moduleId, prefs, ready]);

  const startResize = (pointerId: number, clientY: number, startHeight: number) => {
    dragStateRef.current = {
      pointerId,
      startY: clientY,
      startHeight,
    };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    if (!prefs.open) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      const nextHeight = drag.startHeight + (drag.startY - event.clientY);
      setPrefs((current) => ({
        ...current,
        expanded: false,
        waterfallHeight: clampWaterfallHeight(nextHeight),
      }));
    };

    const onPointerEnd = (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      dragStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      dragStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [prefs.open]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    let cancelled = false;

    void fetchSpectrumFeed()
      .then((next) => {
        if (!cancelled) {
          setSnapshot(next);
          setError("");
        }
      })
      .catch((pollError) => {
        if (!cancelled) {
          setError(pollError instanceof Error ? pollError.message : "Could not refresh the spectrum feed.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [moduleId, prefs.open, ready]);

  useEffect(() => {
    if (!ready || !prefs.open) {
      return;
    }

    let timeoutId: number | null = null;
    let cancelled = false;

    const poll = async () => {
      try {
        const next = await fetchSpectrumFeed();
        if (cancelled) {
          return;
        }
        setSnapshot(next);
        setError("");
      } catch (pollError) {
        if (cancelled) {
          return;
        }
        setError(pollError instanceof Error ? pollError.message : "Could not refresh the spectrum feed.");
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(poll, prefs.open ? OPEN_POLL_MS : CLOSED_POLL_MS);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [prefs.open, ready]);

  const compatibleSnapshot = useMemo(
    () => sanitizeSnapshotForModule(snapshot, expectedOwner, expectedDemodMode),
    [expectedDemodMode, expectedOwner, snapshot],
  );

  const waterfallHeight = prefs.expanded ? maxWaterfallHeight() : clampWaterfallHeight(prefs.waterfallHeight);
  const isTight = prefs.open && !prefs.expanded && waterfallHeight <= TIGHT_WATERFALL_THRESHOLD;
  const lineHeight = isTight ? TIGHT_LINE_HEIGHT : LINE_HEIGHT;
  const zoomBounds = useMemo(
    () => resolveZoomBounds(compatibleSnapshot?.frame ?? null, viewRangeHz, maxZoom),
    [compatibleSnapshot?.frame, maxZoom, viewRangeHz],
  );
  const effectiveZoom = clampZoomToBounds(prefs.zoom, zoomBounds.minZoom, zoomBounds.maxZoom);
  const visibleWindow = useMemo(
    () =>
      compatibleSnapshot?.frame
        ? resolveFrequencyWindow(compatibleSnapshot.frame, effectiveZoom, viewRangeHz, lockViewToRange)
        : null,
    [compatibleSnapshot?.frame, effectiveZoom, lockViewToRange, viewRangeHz],
  );
  const visibleSpanHz = visibleWindow ? visibleWindow.maxFreqHz - visibleWindow.minFreqHz : null;
  const rulerTicks = useMemo(() => {
    const count = rulerTickCount(visibleSpanHz);
    if (!visibleWindow || count < 2) {
      return [];
    }
    return Array.from({ length: count }, (_, index) => {
      const ratio = count === 1 ? 0.5 : index / (count - 1);
      return visibleWindow.minFreqHz + ratio * (visibleWindow.maxFreqHz - visibleWindow.minFreqHz);
    });
  }, [visibleSpanHz, visibleWindow]);
  const spanLabel = useMemo(() => {
    if (visibleSpanHz === null) {
      return "—";
    }
    return `${(visibleSpanHz / 1_000).toFixed(0)} kHz view${effectiveZoom > 1 ? ` · ${effectiveZoom.toFixed(1)}x` : ""}`;
  }, [effectiveZoom, visibleSpanHz]);

  const handleWheelZoom = (deltaY: number) => {
    if (!prefs.open || !compatibleSnapshot?.frame) {
      return;
    }
    const direction = Math.sign(deltaY);
    if (direction === 0) {
      return;
    }
    setPrefs((current) => ({
      ...current,
      zoom: clampZoomToBounds(
        direction < 0 ? effectiveZoom * 1.18 : effectiveZoom / 1.18,
        zoomBounds.minZoom,
        zoomBounds.maxZoom,
      ),
    }));
  };

  useEffect(() => {
    if (prefs.zoom === effectiveZoom) {
      return;
    }
    setPrefs((current) => ({ ...current, zoom: effectiveZoom }));
  }, [effectiveZoom, prefs.zoom]);

  useEffect(() => {
    waterfallRowsRef.current = [];
    scanActivityRef.current = null;
    frameHistoryRef.current = [];
  }, [moduleId, viewRangeHz?.maxFreqHz, viewRangeHz?.minFreqHz]);

  useEffect(() => {
    const lineCanvas = lineCanvasRef.current;
    const waterfallCanvas = waterfallCanvasRef.current;
    if (!lineCanvas || !waterfallCanvas) {
      return;
    }

    if (compatibleSnapshot?.frame) {
      const history = frameHistoryRef.current;
      const latest = compatibleSnapshot.frame;
      const last = history[history.length - 1];
      const isNewFrame =
        !last
        || last.updatedAt !== latest.updatedAt
        || last.centerFreqHz !== latest.centerFreqHz
        || last.spanHz !== latest.spanHz;
      if (isNewFrame) {
        if (
          last
          && (last.centerFreqHz !== latest.centerFreqHz
            || last.spanHz !== latest.spanHz
            || last.bins.length !== latest.bins.length)
        ) {
          history.length = 0;
        }
        history.push(latest);
        if (history.length > AIS_FRAME_HISTORY_LIMIT) {
          history.splice(0, history.length - AIS_FRAME_HISTORY_LIMIT);
        }
      }
    } else {
      frameHistoryRef.current = [];
    }

    const lineFrame =
      profile === "ais"
        ? buildAggregateFrame(frameHistoryRef.current, prefs.lineMode)
        : compatibleSnapshot?.frame ?? null;

    drawSpectrumLine(
      lineCanvas,
      lineFrame,
      compatibleSnapshot?.state === "ready" ? "active" : "inactive",
      visibleWindow,
      profile,
      markers,
      prefs.hideCenterSpur,
    );
    if (prefs.open && compatibleSnapshot?.frame) {
      if (lockViewToRange) {
        if (
          !scanActivityRef.current ||
          !viewRangeHz ||
          scanActivityRef.current.minFreqHz !== viewRangeHz.minFreqHz ||
          scanActivityRef.current.maxFreqHz !== viewRangeHz.maxFreqHz
        ) {
          scanActivityRef.current = viewRangeHz ? createScanActivityState(viewRangeHz) : null;
        }
        const activity = scanActivityRef.current;
        if (activity && viewRangeHz) {
          for (let index = 0; index < activity.values.length; index += 1) {
            activity.values[index] *= SCAN_ACTIVITY_DECAY;
          }

          const bandSpanHz = activity.maxFreqHz - activity.minFreqHz;
          const halfWindowHz = Math.max(4_000, Math.min(20_000, compatibleSnapshot.frame.spanHz / 14));
          const tuneWindow = extractBinsForWindow(compatibleSnapshot.frame, {
            minFreqHz: compatibleSnapshot.frame.centerFreqHz - halfWindowHz,
            maxFreqHz: compatibleSnapshot.frame.centerFreqHz + halfWindowHz,
            tunedFreqHz: compatibleSnapshot.frame.centerFreqHz,
          });
          const tunedStrength = tuneWindow.length
            ? Math.max(...tuneWindow) * 0.9 + (tuneWindow.reduce((sum, value) => sum + value, 0) / tuneWindow.length) * 0.1
            : 0;
          const tunedRatio = (compatibleSnapshot.frame.centerFreqHz - activity.minFreqHz) / Math.max(1, bandSpanHz);
          const centerIndex = Math.max(
            0,
            Math.min(activity.values.length - 1, Math.round(tunedRatio * (activity.values.length - 1))),
          );
          const widthBins = Math.max(
            2,
            Math.round(((halfWindowHz * 2) / Math.max(1, bandSpanHz)) * activity.values.length),
          );

          for (let offset = -widthBins; offset <= widthBins; offset += 1) {
            const index = centerIndex + offset;
            if (index < 0 || index >= activity.values.length) {
              continue;
            }
            const distance = Math.abs(offset) / Math.max(1, widthBins);
            const weight = Math.max(0, 1 - distance * distance);
            activity.values[index] = Math.max(activity.values[index] ?? 0, tunedStrength * weight);
          }
        }
      } else {
        waterfallRowsRef.current.unshift(buildWaterfallPaletteRow(compatibleSnapshot.frame, profile, prefs.hideCenterSpur));
        if (waterfallRowsRef.current.length > WATERFALL_HISTORY_LIMIT) {
          waterfallRowsRef.current.length = WATERFALL_HISTORY_LIMIT;
        }
      }
    }
    if (prefs.open) {
      if (lockViewToRange) {
        drawBandActivity(waterfallCanvas, scanActivityRef.current, visibleWindow, markers);
      } else {
        drawWaterfall(waterfallCanvas, waterfallRowsRef.current, visibleWindow, markers, profile);
      }
    }
  }, [compatibleSnapshot, lockViewToRange, markers, prefs.hideCenterSpur, prefs.lineMode, prefs.open, profile, viewRangeHz, visibleWindow]);

  useEffect(() => {
    if (!prefs.open || !waterfallCanvasRef.current) {
      return;
    }
    if (lockViewToRange) {
      drawBandActivity(waterfallCanvasRef.current, scanActivityRef.current, visibleWindow, markers);
    } else {
      drawWaterfall(waterfallCanvasRef.current, waterfallRowsRef.current, visibleWindow, markers, profile);
    }
  }, [lockViewToRange, markers, prefs.open, profile, visibleWindow, waterfallHeight]);

  return (
    <div className="border-t border-white/[0.07] bg-[linear-gradient(180deg,rgba(6,12,20,0.96),rgba(4,9,18,0.98))]">
      {prefs.open ? (
        <div
          aria-label="Resize spectrum dock"
          className="group h-2 cursor-row-resize border-b border-white/[0.05] transition hover:bg-white/[0.03]"
          onDoubleClick={() => setPrefs((current) => ({ ...current, expanded: false, waterfallHeight: DEFAULT_WATERFALL_HEIGHT }))}
          onPointerDown={(event) => startResize(event.pointerId, event.clientY, waterfallHeight)}
          role="separator"
        />
      ) : null}

      <div className="flex items-center justify-between gap-3 px-4 py-2">
        {isTight ? (
          <div className="flex min-w-0 items-center gap-2.5">
              <span className={cx("h-2 w-2 shrink-0 rounded-full", toneForState(compatibleSnapshot?.state ?? "idle"))} />
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                Spectrum Dock
              </span>
              <span className={cx("shrink-0 font-mono text-[10px]", textToneForState(compatibleSnapshot?.state ?? "idle"))}>
                {compatibleSnapshot?.stream ? compatibleSnapshot.stream.label : compatibleSnapshot?.owner === "audio" ? "Audio stream" : "Idle"}
              </span>
              <p className="min-w-0 truncate font-mono text-[10px] text-[var(--muted)]">
                {error || compatibleSnapshot?.message || "Waiting for spectrum telemetry."}
              </p>
            </div>
          ) : (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
              <span className={cx("h-2 w-2 rounded-full", toneForState(compatibleSnapshot?.state ?? "idle"))} />
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                Spectrum Dock
              </span>
              <span className={cx("font-mono text-[10px]", textToneForState(compatibleSnapshot?.state ?? "idle"))}>
                {compatibleSnapshot?.stream ? compatibleSnapshot.stream.label : compatibleSnapshot?.owner === "audio" ? "Audio stream" : "Idle"}
              </span>
            </div>
            <p className="mt-1 truncate font-mono text-[10px] text-[var(--muted)]">
              {error || compatibleSnapshot?.message || "Waiting for spectrum telemetry."}
            </p>
          </div>
        )}

        <div className="flex items-center gap-2">
          {prefs.open ? (
            <button
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted-strong)] transition hover:border-white/18 hover:bg-white/[0.08] hover:text-[var(--foreground)]"
              onClick={() =>
                setPrefs((current) => ({
                  ...current,
                  expanded: !current.expanded,
                }))
              }
              type="button"
            >
              {prefs.expanded ? "Custom size" : "Expand"}
            </button>
          ) : null}
          <button
            className={cx(
              "rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition",
              prefs.open
                ? "border-[var(--accent)]/35 bg-[var(--accent)]/12 text-[var(--foreground)] hover:border-[var(--accent)]/55"
                : "border-white/10 bg-white/[0.04] text-[var(--muted-strong)] hover:border-white/18 hover:bg-white/[0.08] hover:text-[var(--foreground)]",
            )}
            onClick={() => setPrefs((current) => ({ ...current, open: !current.open }))}
            type="button"
          >
            {prefs.open ? "Hide" : "Open"}
          </button>
        </div>
      </div>

      <div className="border-t border-white/[0.05] px-4 pb-4 pt-3">
        <div className={cx("overflow-hidden rounded-2xl border border-white/[0.08] bg-[rgba(4,9,18,0.88)]", !prefs.open && "opacity-95")}>
          {prefs.open ? (
            <>
              {profile === "ais" ? (
                <div className="border-b border-white/[0.06] bg-[linear-gradient(180deg,rgba(17,31,44,0.46),rgba(7,13,24,0.24))] px-4 py-3">
                  <div className="grid grid-cols-3 items-start gap-6">
                    <div className={cx("min-w-0 justify-self-start max-[760px]:hidden", isTight && "hidden")}>
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                        AIS channels
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-[var(--foreground)]">A {formatFreqMHz(161_975_000)}</p>
                      <p className="mt-1 font-mono text-[11px] text-[var(--foreground)]">B {formatFreqMHz(162_025_000)}</p>
                      <p className="mt-1 font-mono text-[11px] text-[var(--muted-strong)]">CTR {formatFreqMHz(162_000_000)}</p>
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-2 justify-self-center">
                      {([
                        ["live", "Live"],
                        ["average", "Avg"],
                        ["peak", "Peak"],
                      ] as const).map(([mode, label]) => (
                        <button
                          className={cx(
                            "rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition",
                            prefs.lineMode === mode
                              ? "border-[var(--accent)]/40 bg-[var(--accent)]/12 text-[var(--foreground)] shadow-[0_0_18px_rgba(80,215,255,0.08)]"
                              : "border-white/10 bg-white/[0.04] text-[var(--muted-strong)] hover:border-white/18 hover:bg-white/[0.08]",
                          )}
                          key={mode}
                          onClick={() => setPrefs((current) => ({ ...current, lineMode: mode }))}
                          type="button"
                        >
                          {label}
                        </button>
                      ))}

                      <label className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-strong)] whitespace-nowrap">
                        <span>Hide center spur</span>
                        <input
                          checked={prefs.hideCenterSpur}
                          className="h-3.5 w-3.5 rounded border-white/20 bg-transparent text-[var(--accent)] focus:ring-[var(--accent)]/40"
                          onChange={(event) =>
                            setPrefs((current) => ({ ...current, hideCenterSpur: event.target.checked }))
                          }
                          type="checkbox"
                        />
                      </label>
                    </div>

                    <div className={cx("shrink-0 self-start justify-self-end text-right max-[760px]:hidden", isTight && "hidden")}>
                      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--muted)]">RX view</p>
                      <p className="mt-1 font-mono text-[11px] text-[var(--muted-strong)]">
                        {visibleWindow ? formatViewFreqMHz(visibleWindow.tunedFreqHz, visibleSpanHz) : "—"}
                      </p>
                      <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--muted)]">Zoom</p>
                      <p className="mt-1 font-mono text-[11px] text-[var(--foreground)]">{effectiveZoom.toFixed(2)}x</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/[0.06] px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                      {compatibleSnapshot?.stream?.demodMode ? `${compatibleSnapshot.stream.demodMode.toUpperCase()} baseband` : "Shared spectrum"}
                    </p>
                    <p className="mt-1 truncate font-mono text-[11px] text-[var(--foreground)]">
                      {formatFreqMHz(compatibleSnapshot?.frame?.centerFreqHz ?? compatibleSnapshot?.stream?.freqHz ?? null)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--muted)]">{spanLabel}</p>
                    <p className="mt-1 font-mono text-[11px] text-[var(--muted-strong)]">
                      {visibleWindow ? `rx ${formatViewFreqMHz(visibleWindow.tunedFreqHz, visibleSpanHz)}` : "—"}
                    </p>
                  </div>
                </div>
              )}

              <div
                onWheel={(event) => {
                  event.preventDefault();
                  handleWheelZoom(event.deltaY);
                }}
              >
                <canvas
                  className="block w-full"
                  height={lineHeight}
                  ref={lineCanvasRef}
                  width={1024}
                  style={{ height: `${lineHeight}px` }}
                />
                <canvas
                  className="block w-full border-t border-white/[0.05]"
                  height={waterfallHeight}
                  ref={waterfallCanvasRef}
                  width={1024}
                  style={{ height: `${waterfallHeight}px` }}
                />
              </div>
              {!isTight ? (
                <div
                  className="grid border-t border-white/[0.05] px-4 py-2.5 font-mono text-[10px] text-[var(--muted)]"
                  style={{ gridTemplateColumns: `repeat(${Math.max(rulerTicks.length, 1)}, minmax(0, 1fr))` }}
                >
                  {rulerTicks.length > 0 ? (
                    rulerTicks.map((tick, index) => (
                      <span
                        className={cx(
                          index === 0 ? "text-left" : index === rulerTicks.length - 1 ? "text-right" : "text-center",
                          visibleWindow && Math.abs(tick - visibleWindow.tunedFreqHz) < Math.max(1, (visibleSpanHz ?? 0) / 200)
                            ? "text-[var(--accent)]"
                            : "",
                        )}
                        key={`${tick}-${index}`}
                      >
                        {formatViewFreqMHz(tick, visibleSpanHz)}
                      </span>
                    ))
                  ) : (
                    <span>—</span>
                  )}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
