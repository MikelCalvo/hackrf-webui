import { readGpsdSnapshot } from "@/server/gpsd";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(await readGpsdSnapshot(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
