import { hackrfService } from "@/server/hackrf";
import type { ActivityCaptureRequestMeta } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AIRBAND_MIN_MHZ = 118;
const AIRBAND_MAX_MHZ = 137;

function badRequest(message: string, status = 400): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function inAirbandRange(freqMhz: number): boolean {
  return freqMhz >= AIRBAND_MIN_MHZ && freqMhz <= AIRBAND_MAX_MHZ;
}

function parseOptionalFloat(value: string | null): number | null {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function parseActivityCapture(searchParams: URLSearchParams): ActivityCaptureRequestMeta | null {
  const moduleId = searchParams.get("module");
  const mode = searchParams.get("activityMode");
  if (moduleId !== "airband" || (mode !== "manual" && mode !== "scan")) {
    return null;
  }

  const rawChannelNumber = Number.parseInt(searchParams.get("channelNumber") ?? "", 10);
  return {
    module: moduleId,
    mode,
    activityEventId: searchParams.get("activityEventId"),
    bandId: searchParams.get("bandId"),
    channelId: searchParams.get("channelId"),
    channelNumber: Number.isFinite(rawChannelNumber) ? rawChannelNumber : null,
    channelNotes: searchParams.get("channelNotes"),
    squelch: parseOptionalFloat(searchParams.get("squelch")),
    sourceMode: searchParams.get("sourceMode") as ActivityCaptureRequestMeta["sourceMode"] ?? null,
    gpsdFallbackMode: searchParams.get("gpsdFallbackMode") as ActivityCaptureRequestMeta["gpsdFallbackMode"] ?? null,
    sourceStatus: searchParams.get("sourceStatus") as ActivityCaptureRequestMeta["sourceStatus"] ?? null,
    sourceDetail: searchParams.get("sourceDetail"),
    regionId: searchParams.get("regionId"),
    regionName: searchParams.get("regionName"),
    countryId: searchParams.get("countryId"),
    countryCode: searchParams.get("countryCode"),
    countryName: searchParams.get("countryName"),
    cityId: searchParams.get("cityId"),
    cityName: searchParams.get("cityName"),
    resolvedLatitude: parseOptionalFloat(searchParams.get("resolvedLatitude")),
    resolvedLongitude: parseOptionalFloat(searchParams.get("resolvedLongitude")),
  };
}

export async function PATCH(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const freqMhz = Number.parseFloat(searchParams.get("freqMHz") ?? "");
  const label = (searchParams.get("label") ?? "AIRBAND").trim();

  if (!Number.isFinite(freqMhz) || !inAirbandRange(freqMhz)) {
    return badRequest(`Frequency ${freqMhz} MHz is outside ${AIRBAND_MIN_MHZ}-${AIRBAND_MAX_MHZ} MHz.`);
  }

  const ok = hackrfService.retune(
    Math.round(freqMhz * 1_000_000),
    label,
    "am",
    parseActivityCapture(searchParams),
    searchParams.get("streamId"),
  );
  if (!ok) {
    return badRequest("No active AIRBAND stream to retune.", 409);
  }

  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const freqMhz = Number.parseFloat(searchParams.get("freqMHz") ?? "");
  const lna = Number.parseInt(searchParams.get("lna") ?? "24", 10);
  const vga = Number.parseInt(searchParams.get("vga") ?? "20", 10);
  const audioGain = Number.parseFloat(searchParams.get("audioGain") ?? "1");
  const label = (searchParams.get("label") ?? "AIRBAND").trim();
  const activityCapture = parseActivityCapture(searchParams);

  if (!Number.isFinite(freqMhz) || !inAirbandRange(freqMhz)) {
    return badRequest(`Frequency ${freqMhz} MHz is outside ${AIRBAND_MIN_MHZ}-${AIRBAND_MAX_MHZ} MHz.`);
  }
  if (!Number.isInteger(lna) || lna < 0 || lna > 40) return badRequest("Invalid LNA gain.");
  if (!Number.isInteger(vga) || vga < 0 || vga > 62) return badRequest("Invalid VGA gain.");
  if (!Number.isFinite(audioGain) || audioGain <= 0 || audioGain > 8) return badRequest("Invalid audioGain.");

  try {
    const stream = await hackrfService.startAmStream(
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
    const message = error instanceof Error ? error.message : "Could not start AIRBAND stream.";
    return badRequest(message, 503);
  }
}
