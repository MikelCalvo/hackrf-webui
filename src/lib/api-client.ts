const PUBLIC_API_TOKEN = (process.env.NEXT_PUBLIC_HACKRF_WEBUI_TOKEN || "").trim();

export function apiAuthHeaders(headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers);
  if (PUBLIC_API_TOKEN && !nextHeaders.has("Authorization") && !nextHeaders.has("X-HackRF-WebUI-Token")) {
    nextHeaders.set("Authorization", `Bearer ${PUBLIC_API_TOKEN}`);
  }
  return nextHeaders;
}

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: apiAuthHeaders(init.headers),
  });
}

export function appendApiToken(url: string): string {
  if (!PUBLIC_API_TOKEN || typeof window === "undefined") {
    return url;
  }

  const parsed = new URL(url, window.location.origin);
  parsed.searchParams.set("apiToken", PUBLIC_API_TOKEN);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
