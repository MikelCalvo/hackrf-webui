import type { NextRequest } from "next/server";

import type { SigintReviewPriority, SigintReviewStatus, SigintReviewUpdateInput } from "@/lib/sigint";
import { getSigintCaptureDetail, updateSigintCaptureReview } from "@/server/sigint-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseStatus(value: unknown): SigintReviewStatus | null {
  return value === "pending" || value === "kept" || value === "discarded" || value === "flagged"
    ? value
    : null;
}

function parsePriority(value: unknown): SigintReviewPriority | null {
  return value === "normal" || value === "high" ? value : null;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ captureSessionId: string }> },
): Promise<Response> {
  const { captureSessionId } = await context.params;
  const detail = getSigintCaptureDetail(captureSessionId);
  if (!detail) {
    return Response.json({ message: "Capture session not found." }, { status: 404 });
  }

  return Response.json(detail, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ captureSessionId: string }> },
): Promise<Response> {
  let payload: SigintReviewUpdateInput;

  try {
    payload = (await request.json()) as SigintReviewUpdateInput;
  } catch {
    return Response.json({ message: "Invalid JSON payload." }, { status: 400 });
  }

  const status = parseStatus(payload.status);
  const priority = parsePriority(payload.priority);
  if (!status || !priority) {
    return Response.json({ message: "Invalid review update." }, { status: 400 });
  }

  const { captureSessionId } = await context.params;
  const detail = updateSigintCaptureReview(captureSessionId, {
    status,
    priority,
    notes: typeof payload.notes === "string" ? payload.notes : "",
  });

  if (!detail) {
    return Response.json({ message: "Capture session not found." }, { status: 404 });
  }

  return Response.json(detail, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
