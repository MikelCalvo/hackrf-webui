import type { NextRequest } from "next/server";

import { listSigintTrackSummaries } from "@/server/sigint-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const kind = request.nextUrl.searchParams.get("kind")?.trim() ?? "";
  if (kind !== "adsb" && kind !== "ais") {
    return Response.json({ message: "Invalid SIGINT route kind." }, { status: 400 });
  }

  const rawLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "120", 10);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 120;

  return Response.json(listSigintTrackSummaries(kind, limit), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
