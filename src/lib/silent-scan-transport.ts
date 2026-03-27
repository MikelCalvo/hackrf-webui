"use client";

export type SilentScanTransport = {
  abort: () => void;
  closed: Promise<void>;
};

export async function openSilentScanTransport(
  url: string,
  onTerminalError?: (error: Error) => void,
  signal?: AbortSignal,
): Promise<SilentScanTransport> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", abortFromParent, { once: true });
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (signal) {
      signal.removeEventListener("abort", abortFromParent);
    }
    throw error;
  }

  if (!response.ok) {
    if (signal) {
      signal.removeEventListener("abort", abortFromParent);
    }
    controller.abort();
    throw new Error(`Could not open scan stream (${response.status}).`);
  }

  const reader = response.body?.getReader() ?? null;
  if (!reader) {
    if (signal) {
      signal.removeEventListener("abort", abortFromParent);
    }
    controller.abort();
    throw new Error("The scan stream did not expose a readable body.");
  }

  const closed = (async () => {
    try {
      while (!controller.signal.aborted) {
        const { done } = await reader.read();
        if (done) {
          break;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted && onTerminalError) {
        onTerminalError(error instanceof Error ? error : new Error("The scan transport failed."));
      }
    } finally {
      try {
        await reader?.cancel();
      } catch {
        // Ignore reader cleanup failures.
      }
      if (signal) {
        signal.removeEventListener("abort", abortFromParent);
      }
    }
  })();

  return {
    abort: () => controller.abort(),
    closed,
  };
}
