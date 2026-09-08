import type { NextRequest } from "next/server";

import { adsbService } from "@/server/adsb";
import { authorizeApiRequest } from "@/server/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const authFailure = authorizeApiRequest(request, { sensitive: true });
  if (authFailure) {
    return authFailure;
  }

  return Response.json(adsbService.getSnapshot(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
