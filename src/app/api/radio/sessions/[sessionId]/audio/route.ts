import type { NextRequest } from "next/server";

import { radioSupervisor } from "@/server/radio/supervisor";
import { authorizeApiRequest } from "@/server/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const authFailure = authorizeApiRequest(request, { sensitive: true, allowQueryToken: true });
  if (authFailure) {
    return authFailure;
  }

  const { sessionId } = await context.params;
  const session = radioSupervisor.getManagedSession(sessionId);
  if (!session) {
    return Response.json({ message: "Radio session not found." }, { status: 404 });
  }

  try {
    return new Response(session.createAudioStream(), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "audio/mpeg",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return Response.json(
      {
        message: error instanceof Error ? error.message : "Could not open the live audio stream.",
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
