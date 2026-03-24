import { hackrfService } from "@/server/hackrf";
import { aisRuntime } from "@/server/ais-runtime";

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
  return jsonResponse(aisRuntime.getStatus());
}

export async function POST(): Promise<Response> {
  if (hackrfService.getStatus().activeStream) {
    return jsonResponse(
      {
        message: "Stop the FM or PMR stream before starting AIS.",
        runtime: aisRuntime.getStatus(),
      },
      { status: 409 },
    );
  }

  try {
    const status = await aisRuntime.start();
    return jsonResponse(status);
  } catch (error) {
    return jsonResponse(
      {
        message: error instanceof Error ? error.message : "Could not start the AIS decoder.",
        runtime: aisRuntime.getStatus(),
      },
      { status: 503 },
    );
  }
}

export async function DELETE(): Promise<Response> {
  await aisRuntime.stop();
  return jsonResponse(aisRuntime.getStatus());
}
