import { aisService } from "@/server/ais";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(aisService.getSnapshot(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
