import type { NextRequest } from "next/server";

import { listAisTrackHistory } from "@/server/track-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const mmsi = request.nextUrl.searchParams.get("mmsi")?.trim() ?? "";
  if (!mmsi) {
    return Response.json({ message: "Missing AIS MMSI identifier." }, { status: 400 });
  }

  const rawLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "2000", 10);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 2000;

  return Response.json(
    listAisTrackHistory(mmsi, limit),
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
