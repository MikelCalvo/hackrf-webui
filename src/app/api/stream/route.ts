import type { CreateFmSessionRequest, RadioSessionFmStation, UpdateFmSessionRequest } from "@/lib/radio-session";
import { radioSupervisor } from "@/server/radio/supervisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string, status = 400): Response {
  return Response.json(
    {
      error: message,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function parseStation(searchParams: URLSearchParams): RadioSessionFmStation | null {
  const freqMhz = Number.parseFloat(searchParams.get("freqMHz") || "");
  const name = (searchParams.get("label") || "FM").trim();
  const id =
    (searchParams.get("stationId") || "").trim()
    || `fm-${freqMhz.toFixed(3)}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  if (!Number.isFinite(freqMhz) || freqMhz < 64 || freqMhz > 108) {
    return null;
  }

  return {
    id,
    name,
    freqMhz,
  };
}

function parseControls(searchParams: URLSearchParams): CreateFmSessionRequest["controls"] | null {
  const lna = Number.parseInt(searchParams.get("lna") || "24", 10);
  const vga = Number.parseInt(searchParams.get("vga") || "20", 10);
  const audioGain = Number.parseFloat(searchParams.get("audioGain") || "1");

  if (!Number.isInteger(lna) || lna < 0 || lna > 40) {
    return null;
  }

  if (!Number.isInteger(vga) || vga < 0 || vga > 62) {
    return null;
  }

  if (!Number.isFinite(audioGain) || audioGain <= 0 || audioGain > 8) {
    return null;
  }

  return { lna, vga, audioGain };
}

async function ensureFmSession(
  station: RadioSessionFmStation,
  controls: CreateFmSessionRequest["controls"],
): Promise<string> {
  const existing = radioSupervisor.findSessionByModule("fm");
  if (existing?.kind === "fm") {
    const needsUpdate =
      !existing.activeStation
      || existing.activeStation.id !== station.id
      || Math.abs(existing.activeStation.freqMhz - station.freqMhz) > 0.000001
      || existing.controls.lna !== controls.lna
      || existing.controls.vga !== controls.vga
      || Math.abs(existing.controls.audioGain - controls.audioGain) > 0.001;

    if (needsUpdate) {
      const patch: UpdateFmSessionRequest = {
        controls,
        station,
      };
      const updated = await radioSupervisor.updateSession(existing.id, patch);
      if (!updated || updated.kind !== "fm") {
        throw new Error("Could not update the FM session.");
      }
      return updated.id;
    }

    return existing.id;
  }

  const created = await radioSupervisor.createSession({
    kind: "fm",
    module: "fm",
    controls,
    station,
  });
  if (created.kind !== "fm") {
    throw new Error("Could not create the FM session.");
  }

  return created.id;
}

export async function PATCH(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const station = parseStation(searchParams);

  if (!station) {
    return badRequest("freqMHz is out of range. Use a valid FM frequency.");
  }

  const existing = radioSupervisor.findSessionByModule("fm");
  if (!existing || existing.kind !== "fm") {
    return badRequest("No active FM stream to retune.", 409);
  }

  try {
    const updated = await radioSupervisor.updateSession(existing.id, {
      station,
    });
    if (!updated || updated.kind !== "fm") {
      return badRequest("No active FM stream to retune.", 409);
    }

    return Response.json(
      { ok: true, sessionId: updated.id },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return badRequest(
      error instanceof Error ? error.message : "Could not retune the FM stream.",
      503,
    );
  }
}

export async function DELETE(): Promise<Response> {
  await radioSupervisor.stopSessionByModule("fm");
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const station = parseStation(searchParams);
  if (!station) {
    return badRequest("freqMHz is out of range. Use a valid FM frequency.");
  }

  const controls = parseControls(searchParams);
  if (!controls) {
    return badRequest("Invalid LNA, VGA or audioGain.");
  }

  try {
    const sessionId = await ensureFmSession(station, controls);
    const session = radioSupervisor.getManagedSession(sessionId);
    if (!session) {
      return badRequest("FM session is not available.", 503);
    }

    return new Response(session.createAudioStream(), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "audio/mpeg",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not start the local stream.";
    return badRequest(message, 503);
  }
}
