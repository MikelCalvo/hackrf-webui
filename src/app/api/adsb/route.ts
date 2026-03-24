import { adsbService } from "@/server/adsb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(adsbService.getSnapshot(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
