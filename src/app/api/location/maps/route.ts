import { buildOfflineMapSummary } from "@/server/maps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const warnings: string[] = [];
  const maps = buildOfflineMapSummary(warnings);

  return Response.json(
    {
      maps,
      warnings,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
