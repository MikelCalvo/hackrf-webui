"use client";

import type { Layer, Map as LeafletMap } from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildBasemapSources,
  buildBoundsPairs,
  syncLeafletBasemap,
} from "@/components/live-map";
import { CLS_BTN_GHOST, CLS_BTN_PRIMARY, CLS_INPUT, Spinner, cx } from "@/components/module-ui";
import {
  buildCatalogCentroid,
  buildCatalogScopeCaption,
  buildCatalogScopeLabel,
  buildGpsdFallbackLabel,
  buildSourceModeLabel,
  createEmptyStoredAppLocation,
} from "@/lib/location";
import type {
  AppLocationGpsdFallbackMode,
  AppLocationSourceMode,
  CatalogCountryShard,
  CatalogCountrySummary,
  CatalogManifest,
  GeoPoint,
  GpsdSnapshot,
  OfflineMapSummary,
  StoredAppLocation,
} from "@/lib/types";

const EMPTY_TILE_DATA_URL =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const DEFAULT_CENTER: [number, number] = [20, 0];
const DEFAULT_ZOOM = 2;
const DEFAULT_POINT_ZOOM = 11;

type LocationOption = {
  id: string;
  label: string;
  count: number;
  latitude?: number;
  longitude?: number;
};

type MapsPayload = {
  maps: OfflineMapSummary;
  warnings: string[];
};

type LocationModalProps = {
  manifest: CatalogManifest;
  open: boolean;
  requireChoice: boolean;
  value: StoredAppLocation;
  gpsd: GpsdSnapshot | null;
  gpsdLoading: boolean;
  gpsdError: string;
  onClose: () => void;
  onLoadCountry: (countryId: string) => Promise<CatalogCountryShard | null>;
  onRefreshGpsd: () => Promise<void>;
  onSave: (location: StoredAppLocation) => void;
  onSkip: () => void;
};

function formatCount(value: number): string {
  return new Intl.NumberFormat("en").format(value);
}

function formatCoordinate(value: number | null): string {
  return value === null ? "" : value.toFixed(6);
}

function parseCoordinate(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function gpsPreviewPoint(gpsd: GpsdSnapshot | null): GeoPoint | null {
  if (
    !gpsd
    || gpsd.latitude === null
    || gpsd.longitude === null
    || (gpsd.fixState !== "2d" && gpsd.fixState !== "3d")
  ) {
    return null;
  }

  return {
    latitude: gpsd.latitude,
    longitude: gpsd.longitude,
  };
}

function buildSourceTone(mode: AppLocationSourceMode, isActive: boolean): string {
  if (!isActive) {
    return "border-white/10 bg-white/[0.02] text-[var(--muted-strong)] hover:border-white/18 hover:bg-white/[0.04]";
  }

  switch (mode) {
    case "gpsd":
      return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
    case "map":
      return "border-amber-300/30 bg-amber-300/10 text-amber-100";
    default:
      return "border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--foreground)]";
  }
}

function buildPreviewPoint(
  draft: StoredAppLocation,
  gpsd: GpsdSnapshot | null,
): GeoPoint | null {
  if (draft.sourceMode === "map" && draft.mapPin) {
    return draft.mapPin;
  }

  if (draft.sourceMode === "gpsd") {
    const fallbackPoint =
      draft.gpsdFallbackMode === "map"
        ? draft.mapPin
        : draft.gpsdFallbackMode === "catalog"
          ? buildCatalogCentroid(draft.catalogScope)
          : null;
    return gpsPreviewPoint(gpsd) ?? fallbackPoint;
  }

  return buildCatalogCentroid(draft.catalogScope) ?? draft.mapPin;
}

function buildPreviewStatus(draft: StoredAppLocation, gpsd: GpsdSnapshot | null): string {
  if (draft.sourceMode === "gpsd") {
    if (gpsPreviewPoint(gpsd)) {
      return gpsd?.message ?? "Using live GPSD fix.";
    }

    if (draft.gpsdFallbackMode === "map") {
      return draft.mapPin
        ? "GPSD has no fix right now, so the map pin fallback will be used."
        : "GPSD has no fix right now, and the map pin fallback is not configured.";
    }

    if (draft.gpsdFallbackMode === "catalog") {
      return buildCatalogCentroid(draft.catalogScope)
        ? "GPSD has no fix right now, so the catalog centroid fallback will be used."
        : "GPSD has no fix right now, and the catalog fallback is not configured yet.";
    }

    return "GPSD has no fix right now, and no fallback position will be used.";
  }

  if (draft.sourceMode === "map") {
    return draft.mapPin
      ? "Exact operating point selected."
      : "Click the map or type coordinates to place the operating point.";
  }

  const centroid = buildCatalogCentroid(draft.catalogScope);
  return centroid
    ? "Using the selected catalog centroid."
    : "Choose a country or city to define the catalog scope.";
}

function buildGpsdHeadline(gpsd: GpsdSnapshot | null): string {
  if (!gpsd) {
    return "Waiting for GPSD status...";
  }

  if (!gpsd.available) {
    return "GPSD unavailable";
  }

  if (gpsd.activeDevices === 0) {
    return "GPSD daemon running, waiting for a receiver";
  }

  if (gpsd.fixState === "no-fix") {
    return "Receiver detected, waiting for a satellite fix";
  }

  return gpsd.fixState === "3d" ? "Live 3D fix available" : "Live 2D fix available";
}

function buildGpsdHint(gpsd: GpsdSnapshot | null): string {
  if (!gpsd) {
    return "The app will poll the local GPSD daemon and switch to live coordinates as soon as a fix is usable.";
  }

  if (!gpsd.available) {
    return "Check that gpsd is running on the local machine and that the configured host and port are correct.";
  }

  if (gpsd.activeDevices === 0) {
    return "No receiver is active yet. Check the USB device, gpsd startup arguments, and serial permissions.";
  }

  if (gpsd.fixState === "no-fix") {
    return "The receiver is visible, but it still needs sky view and a little time to acquire satellites.";
  }

  return "Live GPS coordinates are ready to be used as the exact operating position.";
}

function buildGpsdFallbackHint(
  fallbackMode: AppLocationGpsdFallbackMode,
): string {
  switch (fallbackMode) {
    case "none":
      return "Do not expose any exact position until GPSD has a valid fix.";
    case "map":
      return "Use a hardcoded map pin whenever GPSD has no usable fix.";
    default:
      return "Use the selected catalog centroid whenever GPSD has no usable fix.";
  }
}

function buildGpsdFixLabel(gpsd: GpsdSnapshot | null): string {
  if (!gpsd) {
    return "checking";
  }

  if (!gpsd.available) {
    return "daemon unavailable";
  }

  if (gpsd.activeDevices === 0) {
    return "waiting for receiver";
  }

  if (gpsd.fixState === "no-fix") {
    return "waiting for fix";
  }

  return gpsd.fixState === "3d" ? "3D fix" : "2D fix";
}

function buildGpsdReceiverLabel(gpsd: GpsdSnapshot | null): string {
  if (!gpsd) {
    return "—";
  }

  if (gpsd.activeDevices === 0) {
    return "none active";
  }

  return gpsd.device ?? "active";
}

function LocationMap({
  maps,
  mode,
  point,
  readOnly,
  onPick,
  onError,
}: {
  maps: OfflineMapSummary | null;
  mode: AppLocationSourceMode;
  point: GeoPoint | null;
  readOnly?: boolean;
  onPick: (point: GeoPoint) => void;
  onError: (message: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const onPickRef = useRef(onPick);
  const readOnlyRef = useRef(Boolean(readOnly));
  const [mapReadyVersion, setMapReadyVersion] = useState(0);
  const markerRef = useRef<Layer | null>(null);
  const basemapLayerRef = useRef<Layer[]>([]);
  const basemapSignatureRef = useRef("");
  const lastPointSignatureRef = useRef("");
  const lastEmptyViewportSignatureRef = useRef("");
  const hasCenteredRef = useRef(false);

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    readOnlyRef.current = Boolean(readOnly);
  }, [readOnly]);

  useEffect(() => {
    let active = true;

    const setup = async () => {
      if (!hostRef.current || mapRef.current) {
        return;
      }

      const leaflet = await import("leaflet");
      if (!active || !hostRef.current || mapRef.current) {
        return;
      }

      leafletRef.current = leaflet;
      const map = leaflet.map(hostRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,
        inertia: true,
        zoomSnap: 0.25,
        zoomDelta: 0.5,
      });

      leaflet.control.zoom({ position: "bottomright" }).addTo(map);
      map.on("click", (event) => {
        if (readOnlyRef.current) {
          return;
        }

        onPickRef.current({
          latitude: event.latlng.lat,
          longitude: event.latlng.lng,
        });
      });
      mapRef.current = map;
      setMapReadyVersion((current) => current + 1);
    };

    void setup();

    return () => {
      active = false;
      markerRef.current?.remove();
      markerRef.current = null;
      basemapLayerRef.current.forEach((layer) => layer.remove());
      basemapLayerRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      leafletRef.current = null;
      basemapSignatureRef.current = "";
      lastPointSignatureRef.current = "";
      lastEmptyViewportSignatureRef.current = "";
      hasCenteredRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      const leaflet = leafletRef.current;
      const map = mapRef.current;
      if (!leaflet || !map || !maps) {
        return;
      }

      const sources = buildBasemapSources(maps, null);
      await syncLeafletBasemap({
        cancelled: () => cancelled,
        emptyTileDataUrl: EMPTY_TILE_DATA_URL,
        errorMessage: "Could not load the location basemap.",
        leaflet,
        map,
        onError,
        layerRef: basemapLayerRef,
        signatureRef: basemapSignatureRef,
        sources,
      });
    };

    void sync();

    return () => {
      cancelled = true;
    };
  }, [mapReadyVersion, maps, onError]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    let frameOne = 0;
    let frameTwo = 0;
    frameOne = window.requestAnimationFrame(() => {
      map.invalidateSize(false);
      frameTwo = window.requestAnimationFrame(() => {
        map.invalidateSize(false);
      });
    });

    return () => {
      window.cancelAnimationFrame(frameOne);
      window.cancelAnimationFrame(frameTwo);
    };
  }, [mapReadyVersion, mode, readOnly]);

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    if (!leaflet || !map) {
      return;
    }

    markerRef.current?.remove();
    markerRef.current = null;

    if (!point) {
      return;
    }

    const marker = leaflet.circleMarker([point.latitude, point.longitude], {
      radius: 8,
      weight: 2,
      color: mode === "gpsd" ? "#6ee7b7" : mode === "map" ? "#fbbf24" : "#57d7ff",
      fillColor: mode === "gpsd" ? "#34d399" : mode === "map" ? "#f59e0b" : "#57d7ff",
      fillOpacity: 0.75,
    });
    marker.addTo(map);
    markerRef.current = marker;

    const pointSignature = `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`;
    if (lastPointSignatureRef.current === pointSignature) {
      return;
    }

    lastPointSignatureRef.current = pointSignature;
    lastEmptyViewportSignatureRef.current = "";

    if (!hasCenteredRef.current) {
      map.setView([point.latitude, point.longitude], DEFAULT_POINT_ZOOM, { animate: false });
      hasCenteredRef.current = true;
      return;
    }

    if (map.getBounds().pad(-0.2).contains([point.latitude, point.longitude])) {
      return;
    }

    map.panTo([point.latitude, point.longitude], { animate: false });
  }, [mapReadyVersion, mode, point]);

  useEffect(() => {
    if (point) {
      lastEmptyViewportSignatureRef.current = "";
      return;
    }

    const map = mapRef.current;
    if (!map) {
      return;
    }

    lastPointSignatureRef.current = "";

    const bounds = maps?.bounds;
    const viewportSignature = bounds
      ? `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`
      : "default";
    if (lastEmptyViewportSignatureRef.current === viewportSignature) {
      return;
    }

    lastEmptyViewportSignatureRef.current = viewportSignature;
    if (bounds) {
      map.fitBounds(buildBoundsPairs(bounds), {
        animate: false,
        padding: [48, 48],
      });
      return;
    }

    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: false });
  }, [mapReadyVersion, maps?.bounds, point]);

  return (
    <div
      className={cx(
        "ais-map ais-map--blue-dark h-80 overflow-hidden rounded-xl border border-white/10 bg-black/30",
        !readOnly && "cursor-crosshair",
      )}
      ref={hostRef}
    />
  );
}

export function LocationModal({
  manifest,
  open,
  requireChoice,
  value,
  gpsd,
  gpsdLoading,
  gpsdError,
  onClose,
  onLoadCountry,
  onRefreshGpsd,
  onSave,
  onSkip,
}: LocationModalProps) {
  const [draft, setDraft] = useState<StoredAppLocation>(value);
  const [search, setSearch] = useState("");
  const [cityOptions, setCityOptions] = useState<LocationOption[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [cityReloadNonce, setCityReloadNonce] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [maps, setMaps] = useState<OfflineMapSummary | null>(null);
  const [mapsLoading, setMapsLoading] = useState(false);
  const [mapError, setMapError] = useState("");

  const regionsById = useMemo(
    () => new Map(manifest.regions.map((region) => [region.id, region.name])),
    [manifest.regions],
  );
  const countriesById = useMemo(
    () => new Map(manifest.countries.map((country) => [country.id, country])),
    [manifest.countries],
  );
  const selectedCountry = draft.catalogScope.countryId
    ? countriesById.get(draft.catalogScope.countryId) ?? null
    : null;
  const gpsdUsesCatalogFallback = draft.sourceMode === "gpsd" && draft.gpsdFallbackMode === "catalog";
  const gpsdUsesMapFallback = draft.sourceMode === "gpsd" && draft.gpsdFallbackMode === "map";
  const mapEditable = draft.sourceMode === "map" || gpsdUsesMapFallback;
  const previewPoint = buildPreviewPoint(draft, gpsd);
  const previewStatus = buildPreviewStatus(draft, gpsd);

  const countryResults = useMemo(() => {
    const query = search.trim().toLowerCase();
    const candidates = manifest.countries.map((country) => ({
      ...country,
      regionName: regionsById.get(country.regionId) ?? "Other",
    }));

    if (!query) {
      return candidates;
    }

    return candidates.filter((country) =>
      country.name.toLowerCase().includes(query)
      || country.code.toLowerCase().includes(query)
      || country.regionName.toLowerCase().includes(query),
    );
  }, [manifest.countries, regionsById, search]);

  const cityResults = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return cityOptions;
    }

    return cityOptions.filter((city) => city.label.toLowerCase().includes(query));
  }, [cityOptions, search]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft(value);
    setSearch("");
    setLoadError("");
  }, [open, value]);

  useEffect(() => {
    if (!open || maps) {
      return;
    }

    let cancelled = false;

    const loadMaps = async () => {
      setMapsLoading(true);
      try {
        const response = await fetch("/api/location/maps", {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = (await response.json()) as MapsPayload;
        if (!cancelled) {
          setMaps(payload.maps);
          setMapError(payload.warnings[0] ?? "");
        }
      } catch (error) {
        if (!cancelled) {
          setMapError(
            error instanceof Error
              ? error.message
              : "Could not load the local basemap summary.",
          );
        }
      } finally {
        if (!cancelled) {
          setMapsLoading(false);
        }
      }
    };

    void loadMaps();

    return () => {
      cancelled = true;
    };
  }, [maps, open]);

  useEffect(() => {
    if (!open || !draft.catalogScope.countryId) {
      setCityOptions([]);
      return;
    }

    let cancelled = false;

    const loadCities = async () => {
      setCitiesLoading(true);
      setLoadError("");
      try {
        const shard = await onLoadCountry(draft.catalogScope.countryId!);
        if (!shard || cancelled) {
          return;
        }

        const nextCities = shard.cities
          .map((city) => ({
            id: city.id,
            label: city.name,
            count: city.stationCount,
            latitude: city.latitude,
            longitude: city.longitude,
          }))
          .sort((left, right) => left.label.localeCompare(right.label));

        setCityOptions(nextCities);
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Could not load cities for the selected country.",
          );
        }
      } finally {
        if (!cancelled) {
          setCitiesLoading(false);
        }
      }
    };

    void loadCities();

    return () => {
      cancelled = true;
    };
  }, [cityReloadNonce, draft.catalogScope.countryId, onLoadCountry, open]);

  useEffect(() => {
    if (!open || draft.sourceMode !== "gpsd") {
      return;
    }

    void onRefreshGpsd();
    const timer = window.setInterval(() => void onRefreshGpsd(), 5_000);
    return () => clearInterval(timer);
  }, [draft.sourceMode, onRefreshGpsd, open]);

  function updateCatalogScope(country: CatalogCountrySummary): void {
    setDraft((current) => ({
      ...current,
      catalogScope: {
        regionId: country.regionId,
        regionName: regionsById.get(country.regionId) ?? null,
        countryId: country.id,
        countryCode: country.code,
        countryName: country.name,
        cityId: null,
        cityName: null,
        latitude: null,
        longitude: null,
      },
    }));
    setSearch("");
  }

  function selectCity(option: LocationOption | null): void {
    setDraft((current) => ({
      ...current,
      configured: true,
      catalogScope: {
        ...current.catalogScope,
        cityId: option?.id ?? null,
        cityName: option?.label ?? null,
        latitude: option?.latitude ?? null,
        longitude: option?.longitude ?? null,
      },
    }));
  }

  function updateMapPin(point: GeoPoint | null): void {
    setDraft((current) => ({
      ...current,
      mapPin: point,
      configured: true,
    }));
  }

  function updateCoordinate(axis: "latitude" | "longitude", value: string): void {
    setDraft((current) => {
      const next = current.mapPin ?? { latitude: 0, longitude: 0 };
      const parsed = parseCoordinate(value);
      return {
        ...current,
        mapPin: {
          ...next,
          [axis]: parsed ?? next[axis],
        },
      };
    });
  }

  function handleSave(): void {
    onSave({
      ...draft,
      configured: true,
      updatedAt: new Date().toISOString(),
    });
  }

  function handleSkip(): void {
    onSkip();
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <div
        className="flex h-[min(52rem,calc(100vh-2rem))] w-[min(82rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#080f1c] shadow-[0_32px_80px_rgba(0,0,0,0.6)]"
        style={{
          boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(87,215,255,0.06)",
        }}
      >
        <div className="border-b border-white/[0.06] px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--accent)]">
                Global location
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                Configure operating location
              </h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                Choose a catalog scope for FM and regional modules, then decide whether the exact
                position should come from the catalog centroid, a precise map pin, or a live GPSD
                receiver.
              </p>
            </div>

            {!requireChoice ? (
              <button className={CLS_BTN_GHOST} onClick={onClose} type="button">
                Close
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="grid gap-4 border-b border-white/[0.06] px-6 py-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                  Exact position source
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  {(["catalog", "map", "gpsd"] as AppLocationSourceMode[]).map((mode) => (
                    <button
                      key={mode}
                      className={cx(
                        "rounded-xl border px-4 py-3 text-left transition",
                        buildSourceTone(mode, draft.sourceMode === mode),
                      )}
                      onClick={() => setDraft((current) => ({ ...current, sourceMode: mode }))}
                      type="button"
                    >
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em]">
                        {buildSourceModeLabel(mode)}
                      </p>
                      <p className="mt-2 text-sm leading-5">
                        {mode === "catalog"
                          ? "Use the chosen city centroid or country scope."
                          : mode === "map"
                            ? "Pin the exact operating point on the map."
                            : "Track a live fix from the local GPSD daemon."}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                  Current summary
                </p>
                <p className="mt-2 text-base font-semibold text-[var(--foreground)]">
                  {draft.configured ? buildCatalogScopeLabel(draft.catalogScope) : "Location not configured yet"}
                </p>
                <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
                  {previewStatus}
                </p>
                {previewPoint ? (
                  <p className="mt-3 font-mono text-[11px] text-[var(--muted-strong)]">
                    {previewPoint.latitude.toFixed(5)}, {previewPoint.longitude.toFixed(5)}
                  </p>
                ) : null}
              </div>
          </div>

          <div
            className={cx(
              "grid min-h-0 flex-1 gap-4 overflow-hidden px-6 py-5",
              draft.sourceMode === "catalog"
                ? "lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]"
                : "lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]",
            )}
          >
            {draft.sourceMode === "catalog" ? (
              <div className="min-h-0 overflow-hidden rounded-xl border border-white/10 bg-black/10">
                <div className="border-b border-white/[0.06] px-5 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                    Catalog scope
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    {buildCatalogScopeCaption(draft.catalogScope)}
                  </p>
                  <input
                    autoFocus
                    className={cx(CLS_INPUT, "mt-3")}
                    placeholder={selectedCountry ? "Search city..." : "Country, code, or region..."}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>

                <div className="min-h-0 h-full overflow-y-auto">
                  {!selectedCountry ? (
                    countryResults.length === 0 ? (
                      <p className="px-5 py-4 text-sm text-[var(--muted)]">
                        No countries match your search.
                      </p>
                    ) : (
                      countryResults.map((country) => (
                        <button
                          key={country.id}
                          className="flex w-full items-center justify-between border-b border-white/[0.04] px-5 py-3 text-left transition hover:bg-white/[0.04]"
                          onClick={() => updateCatalogScope(country)}
                          type="button"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-[var(--foreground)]">
                              {country.name}
                            </p>
                            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                              {country.code} · {regionsById.get(country.regionId) ?? "Other"}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-mono text-[10px] text-[var(--foreground)]">
                              {formatCount(country.stationCount)} presets
                            </p>
                            <p className="font-mono text-[10px] text-[var(--muted)]">
                              {formatCount(country.cityCount)} cities
                            </p>
                          </div>
                        </button>
                      ))
                    )
                  ) : loadError ? (
                    <div className="space-y-3 px-5 py-4">
                      <p className="text-sm text-rose-200">{loadError}</p>
                      <button
                        className={cx(CLS_BTN_GHOST, "w-full justify-center")}
                        onClick={() => setCityReloadNonce((current) => current + 1)}
                        type="button"
                      >
                        Retry
                      </button>
                    </div>
                  ) : citiesLoading ? (
                    <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
                      <Spinner />
                      <p className="text-sm text-[var(--muted)]">
                        Loading cities for {selectedCountry.name}...
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="border-b border-white/[0.04] px-5 py-3">
                        <button
                          className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--accent)]"
                          onClick={() => {
                            setDraft((current) => ({
                              ...current,
                              catalogScope: createEmptyStoredAppLocation().catalogScope,
                            }));
                            setCityOptions([]);
                            setSearch("");
                          }}
                          type="button"
                        >
                          ← Back to countries
                        </button>
                      </div>
                      <button
                        className="flex w-full items-center justify-between border-b border-white/[0.04] px-5 py-3 text-left transition hover:bg-white/[0.04]"
                        onClick={() => selectCity(null)}
                        type="button"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--foreground)]">
                            All cities
                          </p>
                          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                            {selectedCountry.name}
                          </p>
                        </div>
                        <p className="font-mono text-[10px] text-[var(--muted)]">
                          {formatCount(selectedCountry.stationCount)} presets
                        </p>
                      </button>
                      {cityResults.length === 0 ? (
                        <p className="px-5 py-4 text-sm text-[var(--muted)]">
                          No cities match your search.
                        </p>
                      ) : (
                        cityResults.map((city) => {
                          const isActive = draft.catalogScope.cityId === city.id;
                          return (
                            <button
                              key={city.id}
                              className={cx(
                                "flex w-full items-center justify-between border-b border-white/[0.04] px-5 py-3 text-left transition hover:bg-white/[0.04]",
                                isActive && "bg-[var(--accent)]/8",
                              )}
                              onClick={() => selectCity(city)}
                              type="button"
                            >
                              <span className="truncate text-sm font-medium text-[var(--foreground)]">
                                {city.label}
                              </span>
                              <span className="font-mono text-[10px] text-[var(--muted)]">
                                {formatCount(city.count)}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="min-h-0 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                      Position map
                    </p>
                    {mapsLoading ? (
                      <span className="flex items-center gap-2 font-mono text-[10px] text-[var(--muted)]">
                        <Spinner />
                        Loading basemap
                      </span>
                    ) : null}
                  </div>

                  <LocationMap
                    maps={maps}
                    mode={draft.sourceMode}
                    point={previewPoint}
                    readOnly={!mapEditable}
                    onError={setMapError}
                    onPick={updateMapPin}
                  />

                  <p className="text-xs leading-5 text-[var(--muted)]">
                    {draft.sourceMode === "map"
                      ? "Click the map to move the exact operating point."
                      : gpsdUsesMapFallback
                        ? "Click the map to place the hardcoded fallback pin used whenever GPSD has no usable fix."
                        : "The map previews the currently resolved position. Switch to Map pin mode to place an exact point."}
                  </p>

                  {mapError ? (
                    <p className="rounded-lg border border-amber-300/20 bg-amber-300/8 px-3 py-2 text-xs text-amber-100">
                      {mapError}
                    </p>
                  ) : null}
              </div>
            )}

            <div className="min-h-0 space-y-4 overflow-y-auto">
              {draft.sourceMode !== "catalog" ? (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                    {gpsdUsesCatalogFallback ? "Fallback catalog scope" : "Catalog scope"}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">
                    {draft.configured ? buildCatalogScopeLabel(draft.catalogScope) : "Not configured yet"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    {gpsdUsesCatalogFallback
                      ? "Use the panel on the left to choose the country or city centroid that GPSD should fall back to."
                      : gpsdUsesMapFallback
                        ? "Use the map on the left to place the fallback pin that GPSD should use whenever it has no fix."
                        : "Switch back to Catalog mode if you want to change the country or city scope used by FM and regional scan decks."}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                    Catalog mode
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                    In Catalog mode the app uses the selected city centroid, or the broader country
                    scope when no city is selected.
                  </p>
                  {buildCatalogCentroid(draft.catalogScope) ? (
                    <div className="mt-4 rounded-lg border border-white/10 bg-black/20 px-4 py-3">
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
                        Current centroid
                      </p>
                      <p className="mt-2 font-mono text-sm text-[var(--foreground)]">
                        {draft.catalogScope.latitude?.toFixed(5)}, {draft.catalogScope.longitude?.toFixed(5)}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/8 px-4 py-3 text-sm text-amber-100">
                      Pick a city if you want a precise centroid. Country-only scope is still valid for FM and regional scan filters.
                    </div>
                  )}
                </div>
              )}

              {draft.sourceMode === "gpsd" ? (
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                          GPSD live fix
                        </p>
                        <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
                          Uses the local GPSD daemon. Good for moving or temporary operating setups.
                        </p>
                      </div>
                      <button className={CLS_BTN_GHOST} onClick={() => void onRefreshGpsd()} type="button">
                        Refresh
                      </button>
                    </div>
                    <div className="mt-4 rounded-lg border border-white/10 bg-black/20 px-3 py-3">
                      <p className="text-sm font-semibold text-[var(--foreground)]">
                        {buildGpsdHeadline(gpsd)}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                        {buildGpsdHint(gpsd)}
                      </p>
                      {gpsdError ? (
                        <p className="mt-2 text-xs text-rose-200">{gpsdError}</p>
                      ) : null}
                      <div className="mt-3 grid gap-2 font-mono text-[11px] text-[var(--muted-strong)]">
                        <span>Daemon: {gpsd?.host ?? "127.0.0.1"}:{gpsd?.port ?? 2947}</span>
                        <span>Fix: {buildGpsdFixLabel(gpsd)}</span>
                        <span>Receiver: {buildGpsdReceiverLabel(gpsd)}</span>
                        <span>
                          Position: {gpsd?.latitude?.toFixed(5) ?? "—"}, {gpsd?.longitude?.toFixed(5) ?? "—"}
                        </span>
                        <span>Time: {gpsd?.time ?? "—"}</span>
                      </div>
                      <div className="mt-3 min-h-5">
                        <div
                          className={cx(
                            "flex items-center gap-2 text-xs text-[var(--muted)] transition-opacity",
                            gpsdLoading ? "opacity-100" : "opacity-0",
                          )}
                        >
                          <Spinner />
                          Refreshing GPSD snapshot...
                        </div>
                      </div>
                    </div>
                    <div className="mt-4">
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                        Fallback when no fix
                      </p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        {(
                          [
                            ["none", "No fallback"],
                            ["catalog", "Catalog centroid"],
                            ["map", "Map pin"],
                          ] as Array<[AppLocationGpsdFallbackMode, string]>
                        ).map(([mode, label]) => (
                          <button
                            key={mode}
                            className={cx(
                              "rounded-lg border px-3 py-2 text-left transition",
                              draft.gpsdFallbackMode === mode
                                ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
                                : "border-white/10 bg-black/20 text-[var(--muted-strong)] hover:border-white/18 hover:bg-white/[0.04]",
                            )}
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                gpsdFallbackMode: mode,
                              }))}
                            type="button"
                          >
                            <p className="font-mono text-[10px] uppercase tracking-[0.16em]">
                              {label}
                            </p>
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                        {buildGpsdFallbackHint(draft.gpsdFallbackMode)}
                      </p>
                      <p className="mt-2 font-mono text-[11px] text-[var(--muted-strong)]">
                        Active policy: {buildGpsdFallbackLabel(draft.gpsdFallbackMode)}
                      </p>
                      {draft.gpsdFallbackMode === "catalog" ? (
                        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                          Pick the fallback country or city just below. The main map stays visible with the current GPSD position.
                        </p>
                      ) : null}
                      {draft.gpsdFallbackMode === "map" ? (
                        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                          The main map stays visible, and you can click it to place the fallback pin.
                        </p>
                      ) : null}
                    </div>
                    {gpsdUsesCatalogFallback ? (
                      <div className="mt-4 rounded-lg border border-white/10 bg-black/20">
                        <div className="border-b border-white/[0.06] px-3 py-3">
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
                            Fallback catalog scope
                          </p>
                          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                            Choose the country or city centroid that should be used whenever GPSD has no fix.
                          </p>
                          <input
                            className={cx(CLS_INPUT, "mt-3")}
                            placeholder={selectedCountry ? "Search city..." : "Country, code, or region..."}
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                          />
                        </div>
                        <div className="max-h-72 overflow-y-auto">
                          {!selectedCountry ? (
                            countryResults.length === 0 ? (
                              <p className="px-3 py-3 text-sm text-[var(--muted)]">
                                No countries match your search.
                              </p>
                            ) : (
                              countryResults.map((country) => (
                                <button
                                  key={country.id}
                                  className="flex w-full items-center justify-between border-b border-white/[0.04] px-3 py-3 text-left transition hover:bg-white/[0.04]"
                                  onClick={() => updateCatalogScope(country)}
                                  type="button"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-[var(--foreground)]">
                                      {country.name}
                                    </p>
                                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
                                      {country.code} · {regionsById.get(country.regionId) ?? "Other"}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="font-mono text-[10px] text-[var(--foreground)]">
                                      {formatCount(country.stationCount)} presets
                                    </p>
                                    <p className="font-mono text-[10px] text-[var(--muted)]">
                                      {formatCount(country.cityCount)} cities
                                    </p>
                                  </div>
                                </button>
                              ))
                            )
                          ) : loadError ? (
                            <div className="space-y-3 px-3 py-3">
                              <p className="text-sm text-rose-200">{loadError}</p>
                              <button
                                className={cx(CLS_BTN_GHOST, "w-full justify-center")}
                                onClick={() => setCityReloadNonce((current) => current + 1)}
                                type="button"
                              >
                                Retry
                              </button>
                            </div>
                          ) : citiesLoading ? (
                            <div className="flex flex-col items-center gap-3 px-3 py-6 text-center">
                              <Spinner />
                              <p className="text-sm text-[var(--muted)]">
                                Loading cities for {selectedCountry.name}...
                              </p>
                            </div>
                          ) : (
                            <>
                              <div className="border-b border-white/[0.04] px-3 py-3">
                                <button
                                  className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--accent)]"
                                  onClick={() => {
                                    setDraft((current) => ({
                                      ...current,
                                      catalogScope: createEmptyStoredAppLocation().catalogScope,
                                    }));
                                    setCityOptions([]);
                                    setSearch("");
                                  }}
                                  type="button"
                                >
                                  ← Back to countries
                                </button>
                              </div>
                              <button
                                className="flex w-full items-center justify-between border-b border-white/[0.04] px-3 py-3 text-left transition hover:bg-white/[0.04]"
                                onClick={() => selectCity(null)}
                                type="button"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-[var(--foreground)]">
                                    All cities
                                  </p>
                                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
                                    {selectedCountry.name}
                                  </p>
                                </div>
                                <p className="font-mono text-[10px] text-[var(--muted)]">
                                  {formatCount(selectedCountry.stationCount)} presets
                                </p>
                              </button>
                              {cityResults.length === 0 ? (
                                <p className="px-3 py-3 text-sm text-[var(--muted)]">
                                  No cities match your search.
                                </p>
                              ) : (
                                cityResults.map((city) => {
                                  const isActive = draft.catalogScope.cityId === city.id;
                                  return (
                                    <button
                                      key={city.id}
                                      className={cx(
                                        "flex w-full items-center justify-between border-b border-white/[0.04] px-3 py-3 text-left transition hover:bg-white/[0.04]",
                                        isActive && "bg-[var(--accent)]/8",
                                      )}
                                      onClick={() => selectCity(city)}
                                      type="button"
                                    >
                                      <span className="truncate text-sm font-medium text-[var(--foreground)]">
                                        {city.label}
                                      </span>
                                      <span className="font-mono text-[10px] text-[var(--muted)]">
                                        {formatCount(city.count)}
                                      </span>
                                    </button>
                                  );
                                })
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {draft.sourceMode === "map" || gpsdUsesMapFallback ? (
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                      {draft.sourceMode === "map" ? "Exact coordinates" : "Fallback map pin"}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                      {draft.sourceMode === "map"
                        ? "Use a hardcoded operating point instead of the catalog centroid."
                        : "These coordinates are only used when GPSD has no usable fix and the fallback policy is set to Map pin."}
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1.5">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                          Latitude
                        </span>
                        <input
                          className={CLS_INPUT}
                          placeholder="43.2630"
                          value={formatCoordinate(draft.mapPin?.latitude ?? null)}
                          onChange={(event) => updateCoordinate("latitude", event.target.value)}
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                          Longitude
                        </span>
                        <input
                          className={CLS_INPUT}
                          placeholder="-2.9350"
                          value={formatCoordinate(draft.mapPin?.longitude ?? null)}
                          onChange={(event) => updateCoordinate("longitude", event.target.value)}
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {draft.sourceMode !== "map" ? (
                        <button
                          className={CLS_BTN_GHOST}
                          onClick={() => updateMapPin(buildCatalogCentroid(draft.catalogScope))}
                          type="button"
                        >
                          Use city centroid
                        </button>
                      ) : null}
                      <button
                        className={CLS_BTN_GHOST}
                        onClick={() => updateMapPin(gpsPreviewPoint(gpsd))}
                        type="button"
                      >
                        Use GPS fix
                      </button>
                    </div>
                  </div>
                ) : null}

              {draft.sourceMode === "catalog" ? (
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                      Catalog centroid
                    </p>
                    <p className="mt-2 text-sm leading-5 text-[var(--muted)]">
                      {draft.catalogScope.cityName
                        ? "FM, Maritime Smart Local, AIS and ADS-B will use the selected city's centroid unless you switch to a map pin or GPSD."
                        : "Choose a city if you want an exact centroid. Country-only scope still works for FM and Smart Local filtering."}
                    </p>
                    {buildCatalogCentroid(draft.catalogScope) ? (
                      <p className="mt-3 font-mono text-[11px] text-[var(--muted-strong)]">
                        {draft.catalogScope.latitude?.toFixed(5)}, {draft.catalogScope.longitude?.toFixed(5)}
                      </p>
                    ) : null}
                  </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-6 py-4">
          <div className="text-xs text-[var(--muted)]">
            The catalog scope drives FM and regional scans. The exact position drives maps and precise receiver context.
          </div>

          <div className="flex items-center gap-3">
            {!requireChoice ? (
              <button className={CLS_BTN_GHOST} onClick={onClose} type="button">
                Cancel
              </button>
            ) : null}
            <button className={CLS_BTN_GHOST} onClick={handleSkip} type="button">
              Skip for now
            </button>
            <button className={CLS_BTN_PRIMARY} onClick={handleSave} type="button">
              Save location
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
