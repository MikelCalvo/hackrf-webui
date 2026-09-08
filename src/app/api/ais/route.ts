import type { NextRequest } from "next/server";

import { aisService } from "@/server/ais";
import { authorizeApiRequest } from "@/server/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const authFailure = authorizeApiRequest(request, { sensitive: true });
  if (authFailure) {
    return authFailure;
  }

  return Response.json(aisService.getSnapshot(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
