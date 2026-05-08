import type { NextRequest } from "next/server";

import { radioSupervisor } from "@/server/radio/supervisor";
import { authorizeApiRequest } from "@/server/api/auth";
import {
  MAX_RADIO_SESSION_PAYLOAD_BYTES,
  validateUpdateRadioSessionRequest,
} from "@/server/radio/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonMessage(message: string, status = 400): Response {
  return Response.json({ message }, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function notFound(message = "Radio session not found."): Response {
  return jsonMessage(message, 404);
}

function payloadTooLarge(request: NextRequest): boolean {
  const rawLength = request.headers.get("content-length");
  if (!rawLength) {
    return false;
  }
  const length = Number.parseInt(rawLength, 10);
  return Number.isFinite(length) && length > MAX_RADIO_SESSION_PAYLOAD_BYTES;
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

  return Response.json(snapshot, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
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

  if (payloadTooLarge(request)) {
    return jsonMessage(`Payload is limited to ${MAX_RADIO_SESSION_PAYLOAD_BYTES} bytes.`, 413);
  }

  const { sessionId } = await context.params;
  const existing = radioSupervisor.getSession(sessionId);
  if (!existing) {
    return notFound();
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return jsonMessage("Invalid JSON payload.");
  }

  const sessionModule = existing.module;
  if (sessionModule !== "fm" && sessionModule !== "pmr" && sessionModule !== "airband" && sessionModule !== "maritime") {
    return jsonMessage("Radio session does not support updates.", 409);
  }

  const payload = validateUpdateRadioSessionRequest(rawPayload, {
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

    return Response.json(snapshot, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonMessage(
      error instanceof Error ? error.message : "Could not update radio session.",
      409,
    );
  }
}
