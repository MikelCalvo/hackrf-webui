import type { NextRequest } from "next/server";

import { authorizeApiRequest } from "@/server/api/auth";
import { getReplayAdsbHistory, isReplayModeEnabled } from "@/server/replay-feed";
import { listAdsbTrackHistory } from "@/server/track-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const authFailure = authorizeApiRequest(request, { sensitive: true });
  if (authFailure) {
    return authFailure;
  }

  const hex = request.nextUrl.searchParams.get("hex")?.trim().toUpperCase() ?? "";
  if (!hex) {
    return Response.json({ message: "Missing ADS-B hex identifier." }, { status: 400 });
  }

  const rawLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "2000", 10);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 2000;

  return Response.json(
    isReplayModeEnabled() ? getReplayAdsbHistory(hex, limit) : listAdsbTrackHistory(hex, limit),
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
