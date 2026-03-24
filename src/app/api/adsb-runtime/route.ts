import { adsbRuntime } from "@/server/adsb-runtime";
import { aisRuntime } from "@/server/ais-runtime";
import { hackrfService } from "@/server/hackrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      ...init?.headers,
    },
    status: init?.status,
  });
}

export async function GET(): Promise<Response> {
  return jsonResponse(adsbRuntime.getStatus());
}

export async function POST(): Promise<Response> {
  if (hackrfService.getStatus().activeStream) {
    return jsonResponse(
      {
        message: "Stop the FM or PMR stream before starting ADS-B.",
        runtime: adsbRuntime.getStatus(),
      },
      { status: 409 },
    );
  }

  await aisRuntime.stop();

  try {
    const status = await adsbRuntime.start();
    return jsonResponse(status);
  } catch (error) {
    return jsonResponse(
      {
        message: error instanceof Error ? error.message : "Could not start the ADS-B decoder.",
        runtime: adsbRuntime.getStatus(),
      },
      { status: 503 },
    );
  }
}

export async function DELETE(): Promise<Response> {
  await adsbRuntime.stop();
  return jsonResponse(adsbRuntime.getStatus());
}
