import { hackrfService } from "@/server/hackrf";

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

export async function PATCH(request: Request) {
  const { searchParams } = new URL(request.url);
  const freqMhz = Number.parseFloat(searchParams.get("freqMHz") || "");
  const label = (searchParams.get("label") || "FM").trim();

  if (!Number.isFinite(freqMhz) || freqMhz < 64 || freqMhz > 108) {
    return badRequest("freqMHz is out of range. Use a valid FM frequency.");
  }

  const ok = hackrfService.retune(Math.round(freqMhz * 1_000_000), label, "wfm");
  if (!ok) {
    return badRequest("No active FM stream to retune.", 409);
  }

  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const freqMhz = Number.parseFloat(searchParams.get("freqMHz") || "");
  const lna = Number.parseInt(searchParams.get("lna") || "24", 10);
  const vga = Number.parseInt(searchParams.get("vga") || "20", 10);
  const audioGain = Number.parseFloat(searchParams.get("audioGain") || "1");
  const label = (searchParams.get("label") || "FM").trim();

  if (!Number.isFinite(freqMhz) || freqMhz < 64 || freqMhz > 108) {
    return badRequest("freqMHz is out of range. Use a valid FM frequency.");
  }

  if (!Number.isInteger(lna) || lna < 0 || lna > 40) {
    return badRequest("Invalid LNA.");
  }

  if (!Number.isInteger(vga) || vga < 0 || vga > 62) {
    return badRequest("Invalid VGA.");
  }

  if (!Number.isFinite(audioGain) || audioGain <= 0 || audioGain > 8) {
    return badRequest("Invalid audioGain.");
  }

  try {
    const stream = await hackrfService.startWfmStream(
      {
        label,
        freqHz: Math.round(freqMhz * 1_000_000),
        lna,
        vga,
        audioGain,
      },
      request.signal,
    );

    return new Response(stream, {
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
