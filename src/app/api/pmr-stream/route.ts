import { hackrfService } from "@/server/hackrf";
import type { ActivityCaptureRequestMeta } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Valid PMR frequency ranges [min, max] in MHz
const PMR_RANGES: [number, number][] = [
  [446.0,   446.2],   // PMR446 EU
  [462.5,   467.8],   // FRS / GMRS US
  [476.4,   477.5],   // UHF CB AU / NZ
  [151.8,   154.7],   // MURS US
];

function inPmrRange(freq: number): boolean {
  return PMR_RANGES.some(([lo, hi]) => freq >= lo && freq <= hi);
}

function badRequest(message: string, status = 400): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function parseActivityCapture(searchParams: URLSearchParams): ActivityCaptureRequestMeta | null {
  const moduleId = searchParams.get("module");
  const mode = searchParams.get("activityMode");
  if (moduleId !== "pmr" || (mode !== "manual" && mode !== "scan")) {
    return null;
  }

  const rawChannelNumber = Number.parseInt(searchParams.get("channelNumber") ?? "", 10);
  return {
    module: moduleId,
    mode,
    bandId: searchParams.get("bandId"),
    channelId: searchParams.get("channelId"),
    channelNumber: Number.isFinite(rawChannelNumber) ? rawChannelNumber : null,
  };
}

/**
 * PATCH /api/pmr-stream?freqMHz=...&label=...
 * Retune the active NFM stream without restarting the process or the browser connection.
 */
export async function PATCH(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const freqMhz = Number.parseFloat(searchParams.get("freqMHz") ?? "");
  const label   = (searchParams.get("label") ?? "PMR").trim();

  if (!Number.isFinite(freqMhz) || !inPmrRange(freqMhz)) {
    return badRequest(`Frequency ${freqMhz} MHz is outside all known PMR bands.`);
  }

  const ok = hackrfService.retune(
    Math.round(freqMhz * 1_000_000),
    label,
    "nfm",
    parseActivityCapture(searchParams),
  );
  if (!ok) {
    return badRequest("No active PMR stream to retune.", 409);
  }

  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const freqMhz   = Number.parseFloat(searchParams.get("freqMHz") ?? "");
  const lna       = Number.parseInt(searchParams.get("lna") ?? "24", 10);
  const vga       = Number.parseInt(searchParams.get("vga") ?? "20", 10);
  const audioGain = Number.parseFloat(searchParams.get("audioGain") ?? "1");
  const label     = (searchParams.get("label") ?? "PMR").trim();
  const activityCapture = parseActivityCapture(searchParams);

  if (!Number.isFinite(freqMhz) || !inPmrRange(freqMhz)) {
    return badRequest(`Frequency ${freqMhz} MHz is outside all known PMR bands.`);
  }
  if (!Number.isInteger(lna) || lna < 0 || lna > 40) return badRequest("Invalid LNA gain.");
  if (!Number.isInteger(vga) || vga < 0 || vga > 62) return badRequest("Invalid VGA gain.");
  if (!Number.isFinite(audioGain) || audioGain <= 0 || audioGain > 8) return badRequest("Invalid audioGain.");

  try {
    const stream = await hackrfService.startNfmStream(
      { label, freqHz: Math.round(freqMhz * 1_000_000), lna, vga, audioGain, activityCapture },
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
    const message = error instanceof Error ? error.message : "Could not start PMR stream.";
    return badRequest(message, 503);
  }
}
