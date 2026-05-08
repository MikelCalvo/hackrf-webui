export type JsonPayloadResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

export function noStoreHeaders(headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers);
  nextHeaders.set("Cache-Control", "no-store");
  return nextHeaders;
}

export function jsonMessage(message: string, status = 400): Response {
  return Response.json({ message }, {
    status,
    headers: noStoreHeaders(),
  });
}

export function jsonNoStore<T>(value: T, init: ResponseInit = {}): Response {
  return Response.json(value, {
    ...init,
    headers: noStoreHeaders(init.headers),
  });
}

export function isPayloadTooLarge(request: Pick<Request, "headers">, maxBytes: number): boolean {
  const rawLength = request.headers.get("content-length");
  if (!rawLength) {
    return false;
  }

  const length = Number.parseInt(rawLength, 10);
  return Number.isFinite(length) && length > maxBytes;
}

export async function readJsonPayload<T = unknown>(
  request: Pick<Request, "headers" | "json">,
  maxBytes: number,
): Promise<JsonPayloadResult<T>> {
  if (isPayloadTooLarge(request, maxBytes)) {
    return {
      ok: false,
      response: jsonMessage(`Payload is limited to ${maxBytes} bytes.`, 413),
    };
  }

  try {
    return {
      ok: true,
      value: await request.json() as T,
    };
  } catch {
    return {
      ok: false,
      response: jsonMessage("Invalid JSON payload."),
    };
  }
}
