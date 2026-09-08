import type { NextRequest } from "next/server";

import { authorizeApiRequest } from "@/server/api/auth";
import { hackrfService } from "@/server/hackrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authFailure = authorizeApiRequest(request, { sensitive: true });
  if (authFailure) {
    return authFailure;
  }

  return Response.json(hackrfService.getSpectrumFeed(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
