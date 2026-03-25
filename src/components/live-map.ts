"use client";

import type { Layer, Map as LeafletMap } from "leaflet";
import { useEffect, useRef, useState, type MutableRefObject } from "react";

import type {
  CatalogCountryShard,
  GeoBounds,
  GeoPoint,
  OfflineMapLayerSummary,
  OfflineMapSummary,
} from "@/lib/types";

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
  id: string;
  role: "global" | "country";
  countryId: string | null;
  countryName: string | null;
  kind: string | null;
  name: string;
  tileUrlTemplate: string | null;
  pmtilesUrl: string | null;
  flavor: string | null;
  lang: string | null;
  minZoom: number | null;
  maxZoom: number | null;
  attribution: string | null;
  bounds: GeoBounds | null;
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
  savedCountryId: string | null;
  savedCityView: GeoPoint | null;
} {
  const [savedCountryId, setSavedCountryId] = useState<string | null>(null);
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
          setSavedCountryId(typeof saved.countryId === "string" ? saved.countryId : null);
          return;
        }

        setSavedCountryId(saved.countryId);

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

  return { savedCityResolved, savedCountryId, savedCityView };
}

function normalizeLayerSource(layer: OfflineMapLayerSummary): BasemapSource {
  return {
    id: layer.id,
    role: layer.role,
    countryId: layer.countryId,
    countryName: layer.countryName,
    kind: layer.kind,
    name: layer.name,
    tileUrlTemplate: layer.tileUrlTemplate,
    pmtilesUrl: layer.pmtilesUrl,
    flavor: layer.flavor,
    lang: layer.lang,
    minZoom: layer.minZoom,
    maxZoom: layer.maxZoom,
    attribution: layer.attribution,
    bounds: layer.bounds,
  };
}

function normalizeSummarySource(maps: OfflineMapSummary): BasemapSource | null {
  if (maps.kind === "pmtiles" && maps.pmtilesUrl) {
    return {
      id: "default",
      role: "global",
      countryId: null,
      countryName: null,
      kind: maps.kind,
      name: maps.name,
      tileUrlTemplate: null,
      pmtilesUrl: maps.pmtilesUrl,
      flavor: maps.flavor,
      lang: maps.lang,
      minZoom: maps.minZoom,
      maxZoom: maps.maxZoom,
      attribution: maps.attribution,
      bounds: maps.bounds,
    };
  }

  if (maps.tileUrlTemplate) {
    return {
      id: "default",
      role: "global",
      countryId: null,
      countryName: null,
      kind: maps.kind,
      name: maps.name,
      tileUrlTemplate: maps.tileUrlTemplate,
      pmtilesUrl: null,
      flavor: maps.flavor,
      lang: maps.lang,
      minZoom: maps.minZoom,
      maxZoom: maps.maxZoom,
      attribution: maps.attribution,
      bounds: maps.bounds,
    };
  }

  return null;
}

export function buildBasemapSources(
  maps: OfflineMapSummary | null,
  savedCountryId: string | null,
): BasemapSource[] {
  if (!maps) {
    return [];
  }

  const layers = maps?.layers ?? [];
  if (layers.length === 0) {
    const fallback = normalizeSummarySource(maps);
    return fallback ? [fallback] : [];
  }

  const normalized = layers.map(normalizeLayerSource);
  const globals = normalized.filter((layer) => layer.role === "global");
  const globalDetailMaxZoom = globals.reduce(
    (maxZoom, layer) => Math.max(maxZoom, layer.maxZoom ?? 0),
    0,
  );
  const overlays = normalized
    .filter((layer) => layer.role === "country")
    .map((layer) => ({
      ...layer,
      minZoom:
        layer.minZoom === null
          ? null
          : Math.min(
            layer.maxZoom ?? Math.max(layer.minZoom, globalDetailMaxZoom + 2),
            Math.max(layer.minZoom, globalDetailMaxZoom + 2),
          ),
    }));
  if (savedCountryId) {
    const prioritized = overlays.filter((layer) => layer.countryId === savedCountryId);
    const remaining = overlays.filter((layer) => layer.countryId !== savedCountryId);
    if (globals.length > 0 || prioritized.length > 0 || remaining.length > 0) {
      return [...globals, ...prioritized, ...remaining];
    }
  } else if (globals.length > 0 || overlays.length > 0) {
    return [...globals, ...overlays];
  }

  return normalized;
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
  const hardwareRefreshTaskRef = useRef<Promise<void> | null>(null);
  const snapshotRefreshTaskRef = useRef<Promise<void> | null>(null);
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
    if (hardwareRefreshTaskRef.current) {
      await hardwareRefreshTaskRef.current;
      return;
    }

    const task = (async () => {
      try {
        await onRefreshHardwareRef.current();
      } catch {
        // Hardware status is refreshed globally by the caller.
      }
    })();

    hardwareRefreshTaskRef.current = task;

    try {
      await task;
    } finally {
      if (hardwareRefreshTaskRef.current === task) {
        hardwareRefreshTaskRef.current = null;
      }
    }
  };

  refreshSnapshotRef.current = async () => {
    if (snapshotRefreshTaskRef.current) {
      await snapshotRefreshTaskRef.current;
      return;
    }

    const task = (async () => {
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
    })();

    snapshotRefreshTaskRef.current = task;

    try {
      await task;
    } finally {
      if (snapshotRefreshTaskRef.current === task) {
        snapshotRefreshTaskRef.current = null;
      }
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
    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      if (cancelled) {
        return;
      }

      if (typeof document === "undefined" || document.visibilityState === "visible") {
        await refreshSnapshotRef.current();
      }

      if (!cancelled) {
        timer = window.setTimeout(() => void poll(), pollMs);
      }
    };

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void refreshSnapshotRef.current();
      }
    };

    timer = window.setTimeout(() => void poll(), pollMs);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
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
  layerRef: MutableRefObject<Layer[]>;
  signatureRef: MutableRefObject<string>;
  sources: BasemapSource[];
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
  sources,
}: LeafletBasemapOptions): Promise<void> {
  if (sources.length === 0) {
    signatureRef.current = "empty";
    layerRef.current.forEach((layer) => layer.remove());
    layerRef.current = [];
    return;
  }

  const nextSignature = sources
    .map((source) => [
      source.id,
      source.role,
      source.countryId ?? "",
      source.kind,
      source.tileUrlTemplate ?? "",
      source.pmtilesUrl ?? "",
      source.flavor ?? "",
      source.lang ?? "",
      source.minZoom,
      source.maxZoom,
      source.attribution,
      source.bounds?.west ?? "",
      source.bounds?.south ?? "",
      source.bounds?.east ?? "",
      source.bounds?.north ?? "",
    ].join("|"))
    .join("||");

  if (signatureRef.current === nextSignature) {
    return;
  }

  const nextLayers: Layer[] = [];
  const minZoom = Math.min(...sources.map((source) => source.minZoom ?? 0));
  const maxZoom = Math.max(...sources.map((source) => source.maxZoom ?? 19));

  try {
    const protomapsModule = sources.some((source) => source.kind === "pmtiles")
      ? await import("protomaps-leaflet")
      : null;
    const basemapsModule = sources.some((source) => source.kind === "pmtiles")
      ? await import("@protomaps/basemaps")
      : null;

    for (const source of sources) {
      if (
        source.kind === null
        || source.minZoom === null
        || source.maxZoom === null
        || !source.attribution
      ) {
        continue;
      }

      if (source.kind === "pmtiles" && source.pmtilesUrl) {
        const flavor = basemapsModule?.namedFlavor(source.flavor ?? "dark");
        const layer = protomapsModule?.leafletLayer({
          url: source.pmtilesUrl,
          paintRules: flavor ? protomapsModule?.paintRules(flavor) : undefined,
          labelRules: flavor ? protomapsModule?.labelRules(flavor, source.lang ?? "en") : undefined,
          backgroundColor: source.role === "global" ? flavor?.background : undefined,
          minZoom: source.minZoom,
          maxZoom,
          maxDataZoom: source.maxZoom,
          bounds: source.bounds ? buildBoundsPairs(source.bounds) : undefined,
          attribution: source.attribution,
          noWrap: true,
        }) as unknown as Layer | undefined;

        if (layer) {
          nextLayers.push(layer);
        }
        continue;
      }

      if (!source.tileUrlTemplate) {
        continue;
      }

      nextLayers.push(
        leaflet.tileLayer(source.tileUrlTemplate, {
          minZoom: source.minZoom,
          maxZoom,
          maxNativeZoom: source.maxZoom,
          errorTileUrl: emptyTileDataUrl,
          attribution: source.attribution,
          bounds: source.bounds ? buildBoundsPairs(source.bounds) : undefined,
          noWrap: true,
        }),
      );
    }
  } catch {
    if (!cancelled()) {
      onError(errorMessage);
    }
    return;
  }

  if (cancelled()) {
    return;
  }

  layerRef.current.forEach((layer) => layer.remove());
  layerRef.current = nextLayers;
  for (const layer of nextLayers) {
    layer.addTo(map);
  }

  map.setMinZoom(minZoom);
  map.setMaxZoom(maxZoom);

  const currentZoom = map.getZoom();
  if (Number.isFinite(currentZoom)) {
    const clampedZoom = Math.min(Math.max(currentZoom, minZoom), maxZoom);
    if (clampedZoom !== currentZoom) {
      map.setZoom(clampedZoom, { animate: false });
    }
  }

  signatureRef.current = nextSignature;
}
