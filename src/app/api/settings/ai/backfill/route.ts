import type { NextRequest } from "next/server";

import { requestAnalysisBackfill } from "@/server/analysis-worker";
import { authorizeApiRequest } from "@/server/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const authFailure = authorizeApiRequest(request, { sensitive: true });
  if (authFailure) return authFailure;

  let limit = 48;
  try {
    const payload = await request.json() as { limit?: unknown };
    if (payload.limit !== undefined) {
      if (typeof payload.limit !== "number" || !Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > 500) {
        return Response.json(
          { message: "Invalid backfill limit. Use an integer between 1 and 500." },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      }
      limit = payload.limit;
    }
  } catch {
    // Empty request bodies use the bounded default.
  }

  const result = await requestAnalysisBackfill(limit);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
