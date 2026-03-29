import type { NextRequest } from "next/server";

import { radioSupervisor } from "@/server/radio/supervisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function sseFrame(event: string, payload: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const { sessionId } = await context.params;
  const snapshot = radioSupervisor.getSession(sessionId);
  if (!snapshot) {
    return Response.json({ message: "Radio session not found." }, { status: 404 });
  }

  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(sseFrame("snapshot", snapshot));

      const unsubscribe = radioSupervisor.subscribe(sessionId, (event) => {
        if (event.type === "snapshot") {
          controller.enqueue(sseFrame("snapshot", event.snapshot));
          return;
        }
        controller.enqueue(sseFrame(event.type, event));
      });

      request.signal.addEventListener("abort", () => {
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
