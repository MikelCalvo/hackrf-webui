import { adsbRuntime } from "@/server/adsb-runtime";
import { aisRuntime } from "@/server/ais-runtime";
import { hackrfService } from "@/server/hackrf";
import { radioSupervisor } from "@/server/radio/supervisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
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
