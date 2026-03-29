import type { NextRequest } from "next/server";

import type { UpdateRadioSessionRequest } from "@/lib/radio-session";
import { radioSupervisor } from "@/server/radio/supervisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound(message = "Radio session not found."): Response {
  return Response.json({ message }, {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
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
  _request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
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
  const { sessionId } = await context.params;
  let payload: UpdateRadioSessionRequest;

  try {
    payload = (await request.json()) as UpdateRadioSessionRequest;
  } catch {
    return Response.json({ message: "Invalid JSON payload." }, {
      status: 400,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  try {
    const snapshot = await radioSupervisor.updateSession(sessionId, payload);
    if (!snapshot) {
      return notFound();
    }

    return Response.json(snapshot, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      {
        message: error instanceof Error ? error.message : "Could not update radio session.",
      },
      {
        status: 409,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
