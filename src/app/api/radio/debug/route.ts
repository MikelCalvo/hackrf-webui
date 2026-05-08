import type { NextRequest } from "next/server";

import { adsbRuntime } from "@/server/adsb-runtime";
import { aisRuntime } from "@/server/ais-runtime";
import { hackrfService } from "@/server/hackrf";
import { radioSupervisor } from "@/server/radio/supervisor";
import { authorizeApiRequest } from "@/server/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const authFailure = authorizeApiRequest(request, { sensitive: true });
  if (authFailure) {
    return authFailure;
  }

  return Response.json({
    supervisor: radioSupervisor.getDebugSnapshot(),
    hardware: hackrfService.getStatus(),
    aisRuntime: aisRuntime.getStatus(),
    adsbRuntime: adsbRuntime.getStatus(),
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
