import type {
  SigintAnalysisFilter,
  SigintCaptureListFilters,
  SigintCaptureSummary,
} from "@/lib/sigint";

export type SigintFilterViewId =
  | "unreviewed-voice"
  | "flagged-high"
  | "failed-ai"
  | "wav-only"
  | "raw-iq";

export type SigintFilterChip = {
  id: "query" | "reviewStatus" | "module" | "analysis" | "hasAudio" | "hasRawIq";
  label: string;
  clear: (filters: SigintCaptureListFilters) => SigintCaptureListFilters;
};

export type SigintFilterOptionCounts = {
  reviewStatus: Record<SigintCaptureListFilters["reviewStatus"], number>;
  module: Record<SigintCaptureListFilters["module"], number>;
  analysis: Record<SigintAnalysisFilter, number>;
  media: {
    audio: number;
    rawIq: number;
  };
};

export const BUILTIN_SIGINT_FILTER_VIEWS: Array<{
  id: SigintFilterViewId;
  label: string;
  description: string;
}> = [
  { id: "unreviewed-voice", label: "Unreviewed voice", description: "Pending captures with VAD-positive speech" },
  { id: "flagged-high", label: "Flagged", description: "Captures marked for follow-up" },
  { id: "failed-ai", label: "Failed AI", description: "Analysis jobs that need attention" },
  { id: "wav-only", label: "WAV only", description: "Captures with playable audio" },
  { id: "raw-iq", label: "Raw IQ", description: "Captures with original IQ evidence" },
];

export function hasActiveSigintCaptureFilters(filters: SigintCaptureListFilters): boolean {
  return filters.module !== "all"
    || filters.reviewStatus !== "all"
    || filters.analysis !== "all"
    || filters.hasAudio
    || filters.hasRawIq
    || filters.q.trim().length > 0;
}

export function resetSigintCaptureFilters(
  filters: SigintCaptureListFilters,
): SigintCaptureListFilters {
  return {
    module: "all",
    reviewStatus: "all",
    analysis: "all",
    hasAudio: false,
    hasRawIq: false,
    q: "",
    limit: filters.limit,
  };
}

export function applySigintFilterView(
  filters: SigintCaptureListFilters,
  viewId: SigintFilterViewId,
): SigintCaptureListFilters {
  const next = resetSigintCaptureFilters(filters);
  switch (viewId) {
    case "unreviewed-voice":
      return { ...next, reviewStatus: "pending", analysis: "voice" };
    case "flagged-high":
      return { ...next, reviewStatus: "flagged" };
    case "failed-ai":
      return { ...next, analysis: "failed" };
    case "wav-only":
      return { ...next, hasAudio: true };
    case "raw-iq":
      return { ...next, hasRawIq: true };
  }
}

export function buildSigintFilterChips(filters: SigintCaptureListFilters): SigintFilterChip[] {
  const chips: SigintFilterChip[] = [];
  if (filters.q.trim()) {
    chips.push({
      id: "query",
      label: `Search: ${filters.q.trim()}`,
      clear: (current) => ({ ...current, q: "" }),
    });
  }
  if (filters.reviewStatus !== "all") {
    chips.push({
      id: "reviewStatus",
      label: filters.reviewStatus,
      clear: (current) => ({ ...current, reviewStatus: "all" }),
    });
  }
  if (filters.module !== "all") {
    chips.push({
      id: "module",
      label: filters.module === "airband" ? "Airband" : filters.module === "maritime" ? "Maritime" : "PMR",
      clear: (current) => ({ ...current, module: "all" }),
    });
  }
  if (filters.analysis !== "all") {
    chips.push({
      id: "analysis",
      label: filters.analysis === "unknown" ? "Unclear" : filters.analysis,
      clear: (current) => ({ ...current, analysis: "all" }),
    });
  }
  if (filters.hasAudio) {
    chips.push({
      id: "hasAudio",
      label: "WAV",
      clear: (current) => ({ ...current, hasAudio: false }),
    });
  }
  if (filters.hasRawIq) {
    chips.push({
      id: "hasRawIq",
      label: "Raw IQ",
      clear: (current) => ({ ...current, hasRawIq: false }),
    });
  }
  return chips;
}

export function matchesSigintCaptureFilters(
  item: SigintCaptureSummary,
  filters: SigintCaptureListFilters,
): boolean {
  if (filters.module !== "all" && item.module !== filters.module) {
    return false;
  }
  if (filters.reviewStatus !== "all" && item.reviewStatus !== filters.reviewStatus) {
    return false;
  }
  if (filters.analysis !== "all") {
    if (filters.analysis === "queued" || filters.analysis === "running" || filters.analysis === "failed") {
      if (item.analysisSummary.status !== filters.analysis) {
        return false;
      }
    } else if (filters.analysis === "voice") {
      if (item.analysisSummary.status !== "completed" || item.analysisSummary.voiceDetected !== true) {
        return false;
      }
    } else if (
      item.analysisSummary.status !== "completed"
      || item.analysisSummary.classification !== filters.analysis
    ) {
      return false;
    }
  }
  if (filters.hasAudio && !item.audioCapture) {
    return false;
  }
  if (filters.hasRawIq && !item.rawIqCapture) {
    return false;
  }
  return true;
}

function countMatching(
  items: SigintCaptureSummary[],
  filters: SigintCaptureListFilters,
): number {
  return items.filter((item) => matchesSigintCaptureFilters(item, filters)).length;
}

export function countSigintFilterOptions(
  items: SigintCaptureSummary[],
  filters: SigintCaptureListFilters,
): SigintFilterOptionCounts {
  const reviewBase = { ...filters, reviewStatus: "all" as const };
  const moduleBase = { ...filters, module: "all" as const };
  const analysisBase = { ...filters, analysis: "all" as const };
  const audioBase = { ...filters, hasAudio: false };
  const rawIqBase = { ...filters, hasRawIq: false };
  const reviewStatuses: SigintCaptureListFilters["reviewStatus"][] = ["all", "pending", "kept", "flagged", "discarded"];
  const modules: SigintCaptureListFilters["module"][] = ["all", "pmr", "airband", "maritime"];
  const analyses: SigintAnalysisFilter[] = ["all", "voice", "speech", "unknown", "noise", "queued", "running", "failed"];

  return {
    reviewStatus: Object.fromEntries(reviewStatuses.map((value) => [
      value,
      countMatching(items, { ...reviewBase, reviewStatus: value }),
    ])) as SigintFilterOptionCounts["reviewStatus"],
    module: Object.fromEntries(modules.map((value) => [
      value,
      countMatching(items, { ...moduleBase, module: value }),
    ])) as SigintFilterOptionCounts["module"],
    analysis: Object.fromEntries(analyses.map((value) => [
      value,
      countMatching(items, { ...analysisBase, analysis: value }),
    ])) as SigintFilterOptionCounts["analysis"],
    media: {
      audio: countMatching(items, { ...audioBase, hasAudio: true }),
      rawIq: countMatching(items, { ...rawIqBase, hasRawIq: true }),
    },
  };
}

export function nextVisibleCaptureId(
  items: SigintCaptureSummary[],
  selectedId: string,
): string {
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  if (selectedIndex < 0) {
    return items[0]?.id ?? "";
  }
  return items[selectedIndex + 1]?.id ?? items[selectedIndex - 1]?.id ?? "";
}
