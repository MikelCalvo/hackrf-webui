import { timingSafeEqual } from "node:crypto";

export type ApiAuthOptions = {
  allowQueryToken?: boolean;
  sensitive?: boolean;
  checkOrigin?: boolean;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const TOKEN_QUERY_PARAM = "apiToken";
const TOKEN_HEADER = "x-hackrf-webui-token";

function jsonError(message: string, status: number): Response {
  return Response.json(
    { message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function cleanHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[(.*)]$/, "$1");
}

export function isLoopbackHostname(hostname: string): boolean {
  const clean = cleanHostname(hostname);
  return (
    clean === "localhost"
    || clean.endsWith(".localhost")
    || clean === "::1"
    || clean === "0:0:0:0:0:0:0:1"
    || /^127(?:\.\d{1,3}){3}$/.test(clean)
  );
}

function configuredServerToken(): string {
  return (process.env.HACKRF_WEBUI_TOKEN || process.env.NEXT_PUBLIC_HACKRF_WEBUI_TOKEN || "").trim();
}

export function maybeExposeClientToken(): string {
  return (process.env.NEXT_PUBLIC_HACKRF_WEBUI_TOKEN || process.env.HACKRF_WEBUI_TOKEN || "").trim();
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : "";
}

function extractRequestToken(request: Request, allowQueryToken: boolean): string {
  const bearer = extractBearerToken(request.headers.get("authorization"));
  if (bearer) {
    return bearer;
  }

  const headerToken = request.headers.get(TOKEN_HEADER)?.trim() ?? "";
  if (headerToken) {
    return headerToken;
  }

  if (allowQueryToken) {
    return new URL(request.url).searchParams.get(TOKEN_QUERY_PARAM)?.trim() ?? "";
  }

  return "";
}

function safeTokenEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function allowedOrigins(): Set<string> {
  return new Set(
    (process.env.HACKRF_WEBUI_ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function sameLocalOrigin(origin: URL, requestUrl: URL): boolean {
  return (
    isLoopbackHostname(origin.hostname)
    && isLoopbackHostname(requestUrl.hostname)
    && origin.protocol === requestUrl.protocol
    && origin.port === requestUrl.port
  );
}

function validateOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) {
    return null;
  }

  const requestUrl = new URL(request.url);
  const requestOrigin = requestUrl.origin;
  if (origin === requestOrigin) {
    return null;
  }

  try {
    if (sameLocalOrigin(new URL(origin), requestUrl)) {
      return null;
    }
  } catch {
    return jsonError("Origin is not allowed for this API request.", 403);
  }

  const allowlist = allowedOrigins();
  if (allowlist.has("*") || allowlist.has(origin)) {
    return null;
  }

  return jsonError("Origin is not allowed for this API request.", 403);
}

export function authorizeApiRequest(request: Request, options: ApiAuthOptions = {}): Response | null {
  const method = request.method.toUpperCase();
  const unsafeMethod = !SAFE_METHODS.has(method);
  if (unsafeMethod || options.checkOrigin) {
    const originFailure = validateOrigin(request);
    if (originFailure) {
      return originFailure;
    }
  }

  const url = new URL(request.url);
  const localHost = isLoopbackHostname(url.hostname);
  const token = configuredServerToken();

  if (!token) {
    if (localHost || (!unsafeMethod && !options.sensitive)) {
      return null;
    }

    return jsonError(
      "Remote API access requires HACKRF_WEBUI_TOKEN. Set it before binding hackrf-webui to a non-localhost host.",
      403,
    );
  }

  const requestToken = extractRequestToken(request, options.allowQueryToken === true);
  if (!requestToken) {
    return jsonError("Missing API token. Send Authorization: Bearer <token> or X-HackRF-WebUI-Token.", 401);
  }

  if (!safeTokenEqual(requestToken, token)) {
    return jsonError("Invalid API token.", 403);
  }

  return null;
}
