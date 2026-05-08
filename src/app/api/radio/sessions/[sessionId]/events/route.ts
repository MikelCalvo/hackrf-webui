import type { NextRequest } from "next/server";

import { radioSupervisor } from "@/server/radio/supervisor";
import { authorizeApiRequest } from "@/server/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const HEARTBEAT_MS = 20_000;

function sseFrame(event: string, payload: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function sseComment(comment: string): Uint8Array {
  return encoder.encode(`: ${comment}\n\n`);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const authFailure = authorizeApiRequest(request, { sensitive: true, allowQueryToken: true });
  if (authFailure) {
    return authFailure;
  }

  const { sessionId } = await context.params;
  const snapshot = radioSupervisor.getSession(sessionId);
  if (!snapshot) {
    return Response.json({ message: "Radio session not found." }, { status: 404 });
  }

  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array): void => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
          unsubscribe();
          clearInterval(heartbeat);
        }
      };

      const unsubscribe = radioSupervisor.subscribe(sessionId, (event) => {
        if (event.type === "snapshot") {
          safeEnqueue(sseFrame("snapshot", event.snapshot));
          return;
        }
        safeEnqueue(sseFrame(event.type, event));
      });
      const heartbeat = setInterval(() => safeEnqueue(sseComment("keep-alive")), HEARTBEAT_MS);

      safeEnqueue(sseFrame("snapshot", snapshot));

      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Ignore close failures on aborted clients.
        }
      }, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
