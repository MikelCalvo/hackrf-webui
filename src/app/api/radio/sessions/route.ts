import type { NextRequest } from "next/server";

import type { CreateRadioSessionRequest } from "@/lib/radio-session";
import { radioSupervisor } from "@/server/radio/supervisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string, status = 400): Response {
  return Response.json({ message }, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(): Promise<Response> {
  return Response.json(
    {
      sessions: radioSupervisor.listSessions(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  let payload: CreateRadioSessionRequest;

  try {
    payload = (await request.json()) as CreateRadioSessionRequest;
  } catch {
    return badRequest("Invalid JSON payload.");
  }

  if (
    payload.kind === "fm"
    && payload.module === "fm"
  ) {
    if (!payload.station || !Number.isFinite(payload.station.freqMhz)) {
      return badRequest("A valid FM station is required.");
    }

    try {
      const snapshot = await radioSupervisor.createSession(payload);
      return Response.json(snapshot, {
        status: 201,
        headers: {
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create radio session.";
      return badRequest(message, 503);
    }
  }

  if (
    (payload.kind === "ais" && payload.module === "ais")
    || (payload.kind === "adsb" && payload.module === "adsb")
  ) {
    try {
      const snapshot = await radioSupervisor.createSession(payload);
      return Response.json(snapshot, {
        status: 201,
        headers: {
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create radio session.";
      return badRequest(message, 503);
    }
  }

  if (
    payload.kind !== "narrowband"
    || (payload.module !== "pmr" && payload.module !== "airband" && payload.module !== "maritime")
  ) {
    return badRequest("Unsupported radio session kind.");
  }

  if (payload.mode !== "manual" && payload.mode !== "scan") {
    return badRequest("Invalid narrowband session mode.");
  }

  if (!Array.isArray(payload.channels) || payload.channels.length === 0) {
    return badRequest("A non-empty channel deck is required.");
  }

  if (payload.scanMode && payload.scanMode !== "sequential" && payload.scanMode !== "random") {
    return badRequest("Invalid narrowband scan mode.");
  }

  if (!payload.bandId || typeof payload.bandId !== "string") {
    return badRequest("A bandId is required.");
  }
  try {
    const snapshot = await radioSupervisor.createSession(payload);
    return Response.json(snapshot, {
      status: 201,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create radio session.";
    return badRequest(message, 503);
  }
}
