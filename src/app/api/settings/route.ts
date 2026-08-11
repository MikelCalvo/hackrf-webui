import type { NextRequest } from "next/server";

import { parseSettingsPatch } from "@/lib/settings";
import { getAnalysisWorkerStatus, notifyAiSettingsChanged } from "@/server/analysis-worker";
import { authorizeApiRequest } from "@/server/api/auth";
import { getAppSettingsStore, patchAppSettings } from "@/server/settings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest): Promise<Response> {
  const authFailure = authorizeApiRequest(request, { sensitive: true });
  if (authFailure) return authFailure;

  const snapshot = (await getAppSettingsStore()).getSnapshot();
  const requestUrl = "nextUrl" in request && request.nextUrl
    ? request.nextUrl
    : new URL(request.url);
  const analysis = await getAnalysisWorkerStatus(requestUrl.searchParams.get("refreshRuntime") === "1");
  return Response.json({ snapshot, analysis }, { headers: NO_STORE_HEADERS });
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const authFailure = authorizeApiRequest(request, { sensitive: true });
  if (authFailure) return authFailure;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ message: "Invalid settings payload: expected JSON." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const patch = parseSettingsPatch(payload);
    const previous = (await getAppSettingsStore()).getAll();
    const values = await patchAppSettings(patch);
    if (patch.ai && previous.ai.enabled !== values.ai.enabled) {
      notifyAiSettingsChanged(previous.ai.enabled, values.ai.enabled);
    }
    const snapshot = (await getAppSettingsStore()).getSnapshot();
    const analysis = await getAnalysisWorkerStatus(false);
    return Response.json({ snapshot, analysis }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return Response.json(
      { message: `Invalid settings payload: ${error instanceof Error ? error.message : "validation failed"}` },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
}
