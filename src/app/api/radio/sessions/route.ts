import type { NextRequest } from "next/server";

import { radioSupervisor } from "@/server/radio/supervisor";
import { authorizeApiRequest } from "@/server/api/auth";
import { jsonMessage, jsonNoStore, readJsonPayload } from "@/server/api/response";
import {
  MAX_RADIO_SESSION_PAYLOAD_BYTES,
  validateCreateRadioSessionRequest,
} from "@/server/radio/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const authFailure = authorizeApiRequest(request, { sensitive: true });
  if (authFailure) {
    return authFailure;
  }

  return jsonNoStore({
    sessions: radioSupervisor.listSessions(),
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const authFailure = authorizeApiRequest(request, { sensitive: true });
  if (authFailure) {
    return authFailure;
  }

  const rawPayload = await readJsonPayload(request, MAX_RADIO_SESSION_PAYLOAD_BYTES);
  if (!rawPayload.ok) {
    return rawPayload.response;
  }

  const payload = validateCreateRadioSessionRequest(rawPayload.value);
  if (!payload.ok) {
    return jsonMessage(payload.message, payload.status ?? 400);
  }

  try {
    const snapshot = await radioSupervisor.createSession(payload.value);
    return jsonNoStore(snapshot, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create radio session.";
    return jsonMessage(message, 503);
  }
}
