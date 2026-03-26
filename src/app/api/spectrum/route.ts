import { hackrfService } from "@/server/hackrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(hackrfService.getSpectrumFeed(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
