import type { NextRequest } from "next/server";

import { adsbService } from "@/server/adsb";
import { aisService } from "@/server/ais";
import { authorizeApiRequest } from "@/server/api/auth";
import { jsonNoStore } from "@/server/api/response";
import { hackrfService } from "@/server/hackrf";
import { radioSupervisor } from "@/server/radio/supervisor";
import { buildRuntimeDiagnostics } from "@/server/runtime-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const authFailure = authorizeApiRequest(request, { sensitive: true });
  if (authFailure) {
    return authFailure;
  }

  return jsonNoStore(buildRuntimeDiagnostics({
    services: {
      hardware: hackrfService.getStatus(),
      aisRuntime: aisService.getStatus(),
      adsbRuntime: adsbService.getStatus(),
      supervisor: radioSupervisor.getDebugSnapshot(),
    },
  }));
}
