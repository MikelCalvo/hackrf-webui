import type { NextRequest } from "next/server";

import { radioSupervisor } from "@/server/radio/supervisor";
import { authorizeApiRequest } from "@/server/api/auth";
import { jsonMessage, jsonNoStore, readJsonPayload } from "@/server/api/response";
import {
  MAX_RADIO_SESSION_PAYLOAD_BYTES,
  validateUpdateRadioSessionRequest,
} from "@/server/radio/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound(message = "Radio session not found."): Response {
  return jsonMessage(message, 404);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const authFailure = authorizeApiRequest(request, { sensitive: true });
  if (authFailure) {
    return authFailure;
  }

  const { sessionId } = await context.params;
  const snapshot = radioSupervisor.getSession(sessionId);
  if (!snapshot) {
    return notFound();
  }

  return jsonNoStore(snapshot);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const authFailure = authorizeApiRequest(request, { sensitive: true });
  if (authFailure) {
    return authFailure;
  }

  const { sessionId } = await context.params;
  const stopped = await radioSupervisor.stopSession(sessionId);
  if (!stopped) {
    return notFound();
  }

  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const authFailure = authorizeApiRequest(request, { sensitive: true });
  if (authFailure) {
    return authFailure;
  }

  const { sessionId } = await context.params;
  const existing = radioSupervisor.getSession(sessionId);
  if (!existing) {
    return notFound();
  }

  const rawPayload = await readJsonPayload(request, MAX_RADIO_SESSION_PAYLOAD_BYTES);
  if (!rawPayload.ok) {
    return rawPayload.response;
  }

  const sessionModule = existing.module;
  if (sessionModule !== "fm" && sessionModule !== "pmr" && sessionModule !== "airband" && sessionModule !== "maritime") {
    return jsonMessage("Radio session does not support updates.", 409);
  }

  const payload = validateUpdateRadioSessionRequest(rawPayload.value, {
    module: sessionModule,
  });
  if (!payload.ok) {
    return jsonMessage(payload.message, payload.status ?? 400);
  }

  try {
    const snapshot = await radioSupervisor.updateSession(sessionId, payload.value);
    if (!snapshot) {
      return notFound();
    }

    return jsonNoStore(snapshot);
  } catch (error) {
    return jsonMessage(
      error instanceof Error ? error.message : "Could not update radio session.",
      409,
    );
  }
}
