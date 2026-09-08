import type { NextRequest } from "next/server";

import { authorizeApiRequest } from "@/server/api/auth";
import { buildOfflineMapSummary } from "@/server/maps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const authFailure = authorizeApiRequest(request, { sensitive: true });
  if (authFailure) {
    return authFailure;
  }

  const warnings: string[] = [];
  const maps = buildOfflineMapSummary(warnings);

  return Response.json(
    {
      maps,
      warnings,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
