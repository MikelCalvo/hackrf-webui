"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api-client";

export type CaptureMediaFile = {
  url: string;
};

type AuthenticatedCaptureAudioProps = {
  className?: string;
  file: CaptureMediaFile;
  preload?: "none" | "metadata" | "auto";
};

export function AuthenticatedCaptureAudio({ className, file, preload = "metadata" }: AuthenticatedCaptureAudioProps) {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setLoading(true);

    void apiFetch(file.url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Capture download failed with HTTP ${response.status}.`);
        }
        objectUrl = URL.createObjectURL(await response.blob());
        setSourceUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setSourceUrl(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [file.url]);

  if (!sourceUrl) {
    return loading ? <p className="text-xs text-[var(--muted)]">Loading protected audio…</p> : null;
  }

  return <audio className={className} controls preload={preload} src={sourceUrl} />;
}

type CaptureFileButtonProps = {
  children: string;
  className?: string;
  file: CaptureMediaFile;
};

export function CaptureFileButton({ children, className, file }: CaptureFileButtonProps) {
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    if (downloading) {
      return;
    }

    setDownloading(true);
    try {
      const response = await apiFetch(file.url);
      if (!response.ok) {
        throw new Error(`Capture download failed with HTTP ${response.status}.`);
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = "";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    } catch {
      // Keep the control usable if a protected capture cannot be retrieved.
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button className={className} disabled={downloading} onClick={() => void download()} type="button">
      {downloading ? "Preparing…" : children}
    </button>
  );
}
