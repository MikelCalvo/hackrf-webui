import type { NextRequest } from "next/server";

import { listSigintCaptureSummaries } from "@/server/sigint-store";
import type { SigintAnalysisFilter, SigintCaptureListFilters, SigintReviewStatus } from "@/lib/sigint";
import { warmAnalysisBackfill } from "@/server/analysis-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_MODULES = new Set(["pmr", "airband", "maritime"]);
const VALID_REVIEW_STATUS = new Set<SigintReviewStatus>(["pending", "kept", "discarded", "flagged"]);
const VALID_ANALYSIS_FILTERS = new Set<SigintAnalysisFilter>([
  "all",
  "speech",
  "music",
  "noise",
  "unknown",
  "queued",
  "running",
  "failed",
]);

export async function GET(request: NextRequest): Promise<Response> {
  warmAnalysisBackfill();
  const moduleId = request.nextUrl.searchParams.get("module")?.trim() ?? "all";
  const reviewStatus = request.nextUrl.searchParams.get("reviewStatus")?.trim() ?? "all";
  const analysis = request.nextUrl.searchParams.get("analysis")?.trim() ?? "all";
  const rawLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "200", 10);

  const filters: SigintCaptureListFilters = {
    module: VALID_MODULES.has(moduleId) ? (moduleId as SigintCaptureListFilters["module"]) : "all",
    reviewStatus: VALID_REVIEW_STATUS.has(reviewStatus as SigintReviewStatus)
      ? (reviewStatus as SigintReviewStatus)
      : "all",
    analysis: VALID_ANALYSIS_FILTERS.has(analysis as SigintAnalysisFilter)
      ? (analysis as SigintAnalysisFilter)
      : "all",
    hasAudio: request.nextUrl.searchParams.get("hasAudio") === "1",
    hasRawIq: request.nextUrl.searchParams.get("hasRawIq") === "1",
    q: request.nextUrl.searchParams.get("q")?.trim() ?? "",
    limit: Number.isFinite(rawLimit) ? rawLimit : 200,
  };

  return Response.json(listSigintCaptureSummaries(filters), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
