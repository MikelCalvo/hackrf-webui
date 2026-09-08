import type { NextRequest } from "next/server";

import { authorizeApiRequest } from "@/server/api/auth";
import { readGpsdSnapshot } from "@/server/gpsd";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const authFailure = authorizeApiRequest(request, { sensitive: true });
  if (authFailure) {
    return authFailure;
  }

  return Response.json(await readGpsdSnapshot(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
