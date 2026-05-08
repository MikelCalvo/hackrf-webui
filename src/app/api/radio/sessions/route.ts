import type { NextRequest } from "next/server";

import { radioSupervisor } from "@/server/radio/supervisor";
import { authorizeApiRequest } from "@/server/api/auth";
import {
  MAX_RADIO_SESSION_PAYLOAD_BYTES,
  validateCreateRadioSessionRequest,
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

function payloadTooLarge(request: NextRequest): boolean {
  const rawLength = request.headers.get("content-length");
  if (!rawLength) {
    return false;
  }
  const length = Number.parseInt(rawLength, 10);
  return Number.isFinite(length) && length > MAX_RADIO_SESSION_PAYLOAD_BYTES;
}

export async function GET(request: NextRequest): Promise<Response> {
  const authFailure = authorizeApiRequest(request, { sensitive: true });
  if (authFailure) {
    return authFailure;
  }

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
  const authFailure = authorizeApiRequest(request, { sensitive: true });
  if (authFailure) {
    return authFailure;
  }

  if (payloadTooLarge(request)) {
    return jsonMessage(`Payload is limited to ${MAX_RADIO_SESSION_PAYLOAD_BYTES} bytes.`, 413);
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return jsonMessage("Invalid JSON payload.");
  }

  const payload = validateCreateRadioSessionRequest(rawPayload);
  if (!payload.ok) {
    return jsonMessage(payload.message, payload.status ?? 400);
  }

  try {
    const snapshot = await radioSupervisor.createSession(payload.value);
    return Response.json(snapshot, {
      status: 201,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create radio session.";
    return jsonMessage(message, 503);
  }
}
