import type {
  SigintCaptureListFilters,
  SigintCaptureSummary,
} from "@/lib/sigint";

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
