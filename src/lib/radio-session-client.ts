import type {
  CreateRadioSessionRequest,
  RadioSessionSnapshot,
  UpdateRadioSessionRequest,
} from "@/lib/radio-session";

async function ensureOk(response: Response): Promise<Response> {
  if (response.ok) {
    return response;
  }

  let message = "";
  try {
    const payload = (await response.json()) as { message?: string };
    message = payload.message ?? "";
  } catch {
    // Ignore non-JSON error payloads.
  }

  throw new Error(message || `HTTP ${response.status}`);
}

export async function listRadioSessions(): Promise<RadioSessionSnapshot[]> {
  const response = await fetch("/api/radio/sessions", { cache: "no-store" });
  const payload = (await ensureOk(response).then((res) => res.json())) as {
    sessions: RadioSessionSnapshot[];
  };
  return payload.sessions;
}

export async function createRadioSession(
  payload: CreateRadioSessionRequest,
): Promise<RadioSessionSnapshot> {
  const response = await fetch("/api/radio/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return ensureOk(response).then((res) => res.json()) as Promise<RadioSessionSnapshot>;
}

export async function stopRadioSession(sessionId: string): Promise<void> {
  const response = await fetch(`/api/radio/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
  await ensureOk(response);
}

export async function updateRadioSession(
  sessionId: string,
  payload: UpdateRadioSessionRequest,
): Promise<RadioSessionSnapshot> {
  const response = await fetch(`/api/radio/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return ensureOk(response).then((res) => res.json()) as Promise<RadioSessionSnapshot>;
}
