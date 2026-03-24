"use client";

import type { Layer, Map as LeafletMap } from "leaflet";
import { useEffect, useRef, useState, type MutableRefObject } from "react";

import type { CatalogCountryShard, GeoBounds, GeoPoint } from "@/lib/types";

export const LOCATION_KEY = "hackrf-webui.location.v1";

export type SavedLocation = {
  cityId?: string;
  countryId?: string;
};

export type RuntimeMethod = "POST" | "DELETE";

export type RuntimeMessages = {
  refresh: string;
  start: string;
  stop: string;
};

export type BasemapSource = {
  kind: string | null;
  tileUrlTemplate: string | null;
  pmtilesUrl: string | null;
  flavor: string | null;
  lang: string | null;
  minZoom: number | null;
  maxZoom: number | null;
  attribution: string | null;
};

export function buildBoundsPairs(bounds: GeoBounds): [[number, number], [number, number]] {
  return [
    [bounds.south, bounds.west],
    [bounds.north, bounds.east],
  ];
}

export function isPointBounds(bounds: GeoBounds): boolean {
  return bounds.west === bounds.east && bounds.south === bounds.north;
}

export function buildPointBounds(latitude: number, longitude: number): GeoBounds {
  return {
    west: longitude,
    east: longitude,
    south: latitude,
    north: latitude,
  };
}

export function useSavedCityView(): {
  savedCityResolved: boolean;
  savedCityView: GeoPoint | null;
} {
  const [savedCityView, setSavedCityView] = useState<GeoPoint | null>(null);
  const [savedCityResolved, setSavedCityResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadSavedCityView = async () => {
      if (typeof window === "undefined") {
        setSavedCityResolved(true);
        return;
      }

      const raw = window.localStorage.getItem(LOCATION_KEY);
      if (!raw || raw === "skipped") {
        setSavedCityResolved(true);
        return;
      }

      try {
        const saved = JSON.parse(raw) as SavedLocation;
        if (
          typeof saved.countryId !== "string"
          || typeof saved.cityId !== "string"
          || saved.cityId === "all"
        ) {
          return;
        }

        const response = await fetch(`/catalog/countries/${saved.countryId}.json`, {
          cache: "force-cache",
        });
        if (!response.ok) {
          return;
        }

        const shard = (await response.json()) as CatalogCountryShard;
        const city = shard.cities.find((entry) => entry.id === saved.cityId);
        if (!city || cancelled) {
          return;
        }

        setSavedCityView({
          latitude: city.latitude,
          longitude: city.longitude,
        });
      } catch {
        // Ignore malformed saved-location payloads and fall back to the default view.
      } finally {
        if (!cancelled) {
          setSavedCityResolved(true);
        }
      }
    };

    void loadSavedCityView();

    return () => {
      cancelled = true;
    };
  }, []);

  return { savedCityResolved, savedCityView };
}

type RuntimeFeedOptions<TSnapshot> = {
  fetchSnapshot: () => Promise<TSnapshot>;
  messages: RuntimeMessages;
  onRefreshHardware: () => Promise<void>;
  pollMs?: number;
  startRuntime: () => Promise<void>;
  stopRuntime: () => Promise<void>;
};

export function useManagedRuntimeFeed<TSnapshot>({
  fetchSnapshot,
  messages,
  onRefreshHardware,
  pollMs = 3_000,
  startRuntime,
  stopRuntime,
}: RuntimeFeedOptions<TSnapshot>): {
  controlRuntime: (method: RuntimeMethod) => Promise<void>;
  error: string;
  loading: boolean;
  runtimeBusy: boolean;
  setError: (value: string) => void;
  snapshot: TSnapshot | null;
} {
  const [snapshot, setSnapshot] = useState<TSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [runtimeBusy, setRuntimeBusy] = useState(false);

  const fetchSnapshotRef = useRef(fetchSnapshot);
  const onRefreshHardwareRef = useRef(onRefreshHardware);
  const startRuntimeRef = useRef(startRuntime);
  const stopRuntimeRef = useRef(stopRuntime);
  const messagesRef = useRef(messages);
  const refreshHardwareRef = useRef<() => Promise<void>>(async () => undefined);
  const refreshSnapshotRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    fetchSnapshotRef.current = fetchSnapshot;
  }, [fetchSnapshot]);

  useEffect(() => {
    onRefreshHardwareRef.current = onRefreshHardware;
  }, [onRefreshHardware]);

  useEffect(() => {
    startRuntimeRef.current = startRuntime;
  }, [startRuntime]);

  useEffect(() => {
    stopRuntimeRef.current = stopRuntime;
  }, [stopRuntime]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  refreshHardwareRef.current = async () => {
    try {
      await onRefreshHardwareRef.current();
    } catch {
      // Hardware status is refreshed globally by the caller.
    }
  };

  refreshSnapshotRef.current = async () => {
    try {
      const nextSnapshot = await fetchSnapshotRef.current();
      setSnapshot(nextSnapshot);
      setError("");
    } catch (pollError) {
      setError(
        pollError instanceof Error ? pollError.message : messagesRef.current.refresh,
      );
    } finally {
      setLoading(false);
    }
  };

  const controlRuntime = async (method: RuntimeMethod): Promise<void> => {
    setRuntimeBusy(true);

    try {
      if (method === "POST") {
        await startRuntimeRef.current();
      } else {
        await stopRuntimeRef.current();
      }
      setError("");
    } catch (runtimeError) {
      setError(
        runtimeError instanceof Error
          ? runtimeError.message
          : method === "POST"
            ? messagesRef.current.start
            : messagesRef.current.stop,
      );
    } finally {
      setRuntimeBusy(false);
      await refreshHardwareRef.current();
      await refreshSnapshotRef.current();
    }
  };

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      setRuntimeBusy(true);

      try {
        await startRuntimeRef.current();
        if (!cancelled) {
          setError("");
        }
      } catch (runtimeError) {
        if (!cancelled) {
          setError(
            runtimeError instanceof Error ? runtimeError.message : messagesRef.current.start,
          );
        }
      } finally {
        if (!cancelled) {
          setRuntimeBusy(false);
        }
        await refreshHardwareRef.current();
        if (!cancelled) {
          await refreshSnapshotRef.current();
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
      void stopRuntimeRef.current().catch(() => undefined);
      void refreshHardwareRef.current();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => void refreshSnapshotRef.current(), pollMs);
    return () => clearInterval(timer);
  }, [pollMs]);

  return {
    controlRuntime,
    error,
    loading,
    runtimeBusy,
    setError,
    snapshot,
  };
}

type LeafletBasemapOptions = {
  cancelled: () => boolean;
  emptyTileDataUrl: string;
  errorMessage: string;
  leaflet: typeof import("leaflet");
  map: LeafletMap;
  onError: (message: string) => void;
  layerRef: MutableRefObject<Layer | null>;
  signatureRef: MutableRefObject<string>;
  source: BasemapSource;
};

export async function syncLeafletBasemap({
  cancelled,
  emptyTileDataUrl,
  errorMessage,
  leaflet,
  map,
  onError,
  layerRef,
  signatureRef,
  source,
}: LeafletBasemapOptions): Promise<void> {
  if (
    source.kind === null
    || source.minZoom === null
    || source.maxZoom === null
    || !source.attribution
  ) {
    return;
  }

  const nextSignature = [
    source.kind,
    source.tileUrlTemplate ?? "",
    source.pmtilesUrl ?? "",
    source.flavor ?? "",
    source.lang ?? "",
    source.minZoom,
    source.maxZoom,
    source.attribution,
  ].join("|");

  if (signatureRef.current === nextSignature) {
    return;
  }

  signatureRef.current = nextSignature;
  map.setMinZoom(source.minZoom);
  map.setMaxZoom(source.maxZoom);

  const currentZoom = map.getZoom();
  if (Number.isFinite(currentZoom)) {
    const clampedZoom = Math.min(Math.max(currentZoom, source.minZoom), source.maxZoom);
    if (clampedZoom !== currentZoom) {
      map.setZoom(clampedZoom, { animate: false });
    }
  }

  layerRef.current?.remove();
  layerRef.current = null;

  if (source.kind === "pmtiles" && source.pmtilesUrl) {
    try {
      const protomapsModule = await import("protomaps-leaflet");
      if (cancelled() || !map) {
        return;
      }

      layerRef.current = protomapsModule.leafletLayer({
        url: source.pmtilesUrl,
        flavor: source.flavor ?? "dark",
        lang: source.lang ?? "en",
        noWrap: true,
      }) as unknown as Layer;
      layerRef.current.addTo(map);
    } catch {
      if (!cancelled()) {
        onError(errorMessage);
      }
    }
    return;
  }

  if (!source.tileUrlTemplate) {
    return;
  }

  layerRef.current = leaflet.tileLayer(source.tileUrlTemplate, {
    minZoom: source.minZoom,
    maxZoom: source.maxZoom,
    maxNativeZoom: source.maxZoom,
    errorTileUrl: emptyTileDataUrl,
    attribution: source.attribution,
  });
  layerRef.current.addTo(map);
}
