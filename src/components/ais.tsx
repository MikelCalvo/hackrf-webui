"use client";

import type { Layer, LayerGroup, Map as LeafletMap } from "leaflet";
import { useEffect, useRef, useState } from "react";

import type {
  AisFeedSnapshot,
  AisRuntimeState,
  AisVesselContact,
  HardwareStatus,
  ResolvedAppLocation,
} from "@/lib/types";
import {
  buildBasemapSources,
  buildBoundsPairs,
  isPointBounds,
  type MarkerSyncRecord,
  syncLeafletBasemap,
  syncLeafletMarkers,
  useManagedRuntimeFeed,
} from "@/components/live-map";

const EMPTY_TILE_DATA_URL =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const DEFAULT_CENTER: [number, number] = [0, 0];
const DEFAULT_ZOOM = 2;
const DEFAULT_CITY_ZOOM = 9;

type AisModuleProps = {
  hardware: HardwareStatus | null;
  location: ResolvedAppLocation | null;
  onRefreshHardware: () => Promise<void>;
};

function cx(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(" ");
}

function displayVesselName(vessel: AisVesselContact): string {
  return vessel.name || vessel.callsign || vessel.mmsi;
}

function buildAisContactList(snapshot: AisFeedSnapshot | null): AisVesselContact[] {
  if (!snapshot) {
    return [];
  }

  const ordered: AisVesselContact[] = [];
  const seen = new Set<string>();

  for (const vessel of snapshot.vessels) {
    if (seen.has(vessel.mmsi)) {
      continue;
    }
    seen.add(vessel.mmsi);
    ordered.push(vessel);
  }

  for (const vessel of snapshot.recentVessels ?? []) {
    if (seen.has(vessel.mmsi)) {
      continue;
    }
    seen.add(vessel.mmsi);
    ordered.push(vessel);
  }

  return ordered;
}

function formatSpeed(speedKnots: number | null): string {
  return speedKnots === null ? "\u2014" : `${speedKnots.toFixed(1)} kn`;
}

function formatCourse(courseDeg: number | null): string {
  return courseDeg === null ? "\u2014" : `${courseDeg.toFixed(1)}\u00b0`;
}

function formatCoordinates(vessel: AisVesselContact): string {
  return `${vessel.latitude.toFixed(4)}, ${vessel.longitude.toFixed(4)}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "\u2014";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function formatFrequencyMHz(freqHz: number): string {
  return `${(freqHz / 1e6).toFixed(3)} MHz`;
}

function runtimeLabel(state: AisRuntimeState | null): string {
  switch (state) {
    case "running":
      return "running";
    case "starting":
      return "starting";
    case "error":
      return "error";
    default:
      return "stopped";
  }
}

function runtimeDotColor(state: AisRuntimeState | null): string {
  switch (state) {
    case "running": return "bg-emerald-400";
    case "starting": return "bg-amber-400";
    case "error": return "bg-rose-400";
    default: return "bg-white/25";
  }
}

function runtimeTextColor(state: AisRuntimeState | null): string {
  switch (state) {
    case "running": return "text-emerald-300";
    case "starting": return "text-amber-300";
    case "error": return "text-rose-300";
    default: return "text-[var(--muted-strong)]";
  }
}

async function fetchAisFeed(): Promise<AisFeedSnapshot> {
  const response = await fetch("/api/ais", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as AisFeedSnapshot;
}

async function requestAisRuntime(method: "POST" | "DELETE"): Promise<void> {
  const response = await fetch("/api/ais-runtime", {
    method,
    cache: "no-store",
    keepalive: method === "DELETE",
  });

  if (response.ok) {
    return;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { message?: string };
    throw new Error(payload.message || `HTTP ${response.status}`);
  }

  throw new Error(`HTTP ${response.status}`);
}

function buildMarkerIcon(
  leaflet: typeof import("leaflet"),
  vessel: AisVesselContact,
  isSelected: boolean,
) {
  const heading = Number.isFinite(vessel.courseDeg ?? NaN) ? vessel.courseDeg : 0;
  const arrowOpacity = vessel.courseDeg === null ? 0.3 : 1;

  return leaflet.divIcon({
    className: "ais-vessel-icon-shell",
    html: `
      <span class="ais-vessel-icon ${vessel.isMoving ? "is-moving" : "is-idle"} ${isSelected ? "is-selected" : ""}" style="--ais-heading:${heading}deg; --ais-arrow-opacity:${arrowOpacity};">
        <span class="ais-vessel-icon__pulse"></span>
        <span class="ais-vessel-icon__dot"></span>
        <span class="ais-vessel-icon__arrow"></span>
      </span>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

export function AisModule({ hardware, location, onRefreshHardware }: AisModuleProps) {
  const mapHostRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerLayerRef = useRef<LayerGroup | null>(null);
  const markerRecordsRef = useRef<Map<string, MarkerSyncRecord>>(new Map());
  const basemapLayerRef = useRef<Layer[]>([]);
  const didFitBoundsRef = useRef(false);
  const userViewportLockedRef = useRef(false);
  const suppressViewportEventRef = useRef(false);
  const viewportUnlockFrameRef = useRef<number | null>(null);
  const lastSavedCityViewKeyRef = useRef("");
  const [selectedMmsi, setSelectedMmsi] = useState("");
  const basemapSignatureRef = useRef("");

  const savedCountryId = location?.catalogScope.countryId ?? null;
  const savedCityView = location?.resolvedPosition ?? null;
  const savedCityResolved = true;
  const {
    controlRuntime,
    error,
    loading,
    runtimeBusy,
    setError,
    snapshot,
  } = useManagedRuntimeFeed<AisFeedSnapshot>({
    fetchSnapshot: fetchAisFeed,
    messages: {
      refresh: "Could not refresh the AIS feed.",
      start: "Could not start the AIS decoder.",
      stop: "Could not stop the AIS decoder.",
    },
    onRefreshHardware,
    startRuntime: () => requestAisRuntime("POST"),
    stopRuntime: () => requestAisRuntime("DELETE"),
  });
  const mapsMinZoom = snapshot?.maps.minZoom ?? null;
  const mapsMaxZoom = snapshot?.maps.maxZoom ?? null;
  const selectedCountryLayer = snapshot?.maps.layers.find(
    (layer) => layer.role === "country" && layer.countryId === savedCountryId,
  ) ?? null;
  const selectedCountryBounds = selectedCountryLayer?.bounds ?? null;
  const contactList = buildAisContactList(snapshot);

  function focusVessel(vessel: AisVesselContact): void {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    userViewportLockedRef.current = true;
    map.panTo([vessel.latitude, vessel.longitude], {
      animate: true,
      duration: 0.7,
    });
  }

  useEffect(() => {
    if (contactList.length === 0) {
      setSelectedMmsi("");
      return;
    }

    if (!contactList.some((vessel) => vessel.mmsi === selectedMmsi)) {
      setSelectedMmsi(contactList[0].mmsi);
    }
  }, [contactList, selectedMmsi]);

  useEffect(() => {
    let active = true;
    const markerRecords = markerRecordsRef.current;

    const setup = async () => {
      if (!mapHostRef.current || mapRef.current) {
        return;
      }

      const leaflet = await import("leaflet");
      if (!active || !mapHostRef.current || mapRef.current) {
        return;
      }

      leafletRef.current = leaflet;
      const map = leaflet.map(mapHostRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,
        inertia: true,
        zoomSnap: 0.25,
        zoomDelta: 0.5,
        tapTolerance: 24,
      });

      leaflet.control.zoom({ position: "bottomright" }).addTo(map);
      map.on("movestart zoomstart", () => {
        if (!suppressViewportEventRef.current) {
          userViewportLockedRef.current = true;
        }
      });
      mapRef.current = map;
      markerLayerRef.current = leaflet.layerGroup().addTo(map);
    };

    void setup();

    return () => {
      active = false;
      basemapLayerRef.current.forEach((layer) => layer.remove());
      markerLayerRef.current?.clearLayers();
      markerRecords.clear();
      mapRef.current?.remove();
      basemapLayerRef.current = [];
      markerLayerRef.current = null;
      mapRef.current = null;
      leafletRef.current = null;
      if (viewportUnlockFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportUnlockFrameRef.current);
        viewportUnlockFrameRef.current = null;
      }
      userViewportLockedRef.current = false;
      suppressViewportEventRef.current = false;
      lastSavedCityViewKeyRef.current = "";
      didFitBoundsRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !savedCityView || snapshot?.bounds) {
      return;
    }

    if (userViewportLockedRef.current) {
      return;
    }

    const viewKey = `${savedCityView.latitude.toFixed(5)},${savedCityView.longitude.toFixed(5)}`;
    if (lastSavedCityViewKeyRef.current === viewKey) {
      return;
    }

    const minZoom = mapsMinZoom ?? 0;
    const maxZoom = mapsMaxZoom ?? DEFAULT_CITY_ZOOM;
    const cityZoom = Math.min(Math.max(DEFAULT_CITY_ZOOM, minZoom), maxZoom);

    lastSavedCityViewKeyRef.current = viewKey;
    suppressViewportEventRef.current = true;
    map.setView([savedCityView.latitude, savedCityView.longitude], cityZoom, {
      animate: false,
    });
    if (viewportUnlockFrameRef.current !== null) {
      window.cancelAnimationFrame(viewportUnlockFrameRef.current);
    }
    viewportUnlockFrameRef.current = window.requestAnimationFrame(() => {
      suppressViewportEventRef.current = false;
      viewportUnlockFrameRef.current = null;
    });
  }, [savedCityView, snapshot?.bounds, mapsMaxZoom, mapsMinZoom]);

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    if (!leaflet || !map) {
      return;
    }

    let cancelled = false;
    const sources = buildBasemapSources(snapshot?.maps ?? null, savedCountryId);
    void syncLeafletBasemap({
      cancelled: () => cancelled,
      emptyTileDataUrl: EMPTY_TILE_DATA_URL,
      errorMessage: "Could not load the offline PMTiles basemap.",
      leaflet,
      layerRef: basemapLayerRef,
      map,
      onError: setError,
      signatureRef: basemapSignatureRef,
      sources,
    });

    return () => {
      cancelled = true;
    };
  }, [
    setError,
    savedCountryId,
    snapshot?.maps,
  ]);

  const selected =
    contactList.find((vessel) => vessel.mmsi === selectedMmsi) ??
    contactList[0] ??
    null;
  const liveMmsiSet = new Set((snapshot?.vessels ?? []).map((vessel) => vessel.mmsi));
  const selectedIsLive = selected ? liveMmsiSet.has(selected.mmsi) : false;

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    const markerLayer = markerLayerRef.current;
    if (!leaflet || !map || !markerLayer || !snapshot) {
      return;
    }

    syncLeafletMarkers({
      entries: snapshot.vessels,
      getId: (vessel) => vessel.mmsi,
      getLatitude: (vessel) => vessel.latitude,
      getLongitude: (vessel) => vessel.longitude,
      getIconSignature: (vessel) =>
        [
          vessel.mmsi === selected?.mmsi ? "selected" : "idle",
          vessel.isMoving ? "moving" : "still",
          vessel.courseDeg ?? "none",
        ].join("|"),
      getTooltipText: (vessel) => `${displayVesselName(vessel)} \u00b7 ${formatSpeed(vessel.speedKnots)}`,
      buildIcon: (vessel) => buildMarkerIcon(leaflet, vessel, vessel.mmsi === selected?.mmsi),
      leaflet,
      layerGroup: markerLayer,
      recordsRef: markerRecordsRef,
      onSelect: (mmsi) => setSelectedMmsi(mmsi),
      tooltipOptions: {
        className: "ais-tooltip",
        direction: "top",
        offset: [0, -14],
        opacity: 1,
      },
    });

    const boundsToFit = snapshot.bounds ?? (
      savedCityResolved && !savedCityView
        ? selectedCountryBounds ?? snapshot.maps.bounds
        : null
    );
    if (!didFitBoundsRef.current && boundsToFit) {
      suppressViewportEventRef.current = true;
      if (isPointBounds(boundsToFit)) {
        map.setView(
          [boundsToFit.south, boundsToFit.west],
          Math.min(snapshot.maps.maxZoom, 13),
          { animate: false },
        );
      } else {
        map.fitBounds(buildBoundsPairs(boundsToFit), {
          padding: [28, 28],
          animate: false,
        });
      }
      if (viewportUnlockFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportUnlockFrameRef.current);
      }
      viewportUnlockFrameRef.current = window.requestAnimationFrame(() => {
        suppressViewportEventRef.current = false;
        viewportUnlockFrameRef.current = null;
      });
      didFitBoundsRef.current = true;
    }

  }, [savedCityResolved, savedCityView, selected, selectedCountryBounds, snapshot]);

  const runtimeState = snapshot?.runtime.state ?? null;
  const runtimeRunning = runtimeState === "running";
  const runtimeStarting = runtimeState === "starting";

  return (
    <div className="flex flex-1 overflow-hidden">
      <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-white/8 bg-black/10">
        {/* Title + live status */}
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--foreground)]">AIS</span>
            <span className="font-mono text-[10px] text-[var(--muted)]">162 MHz</span>
          </div>
          <span className={cx("inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em]", runtimeTextColor(runtimeState))}>
            <span className={cx("h-1.5 w-1.5 rounded-full", runtimeDotColor(runtimeState))} />
            {runtimeLabel(runtimeState)}
          </span>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 border-b border-white/[0.07]">
          <div className="border-r border-white/[0.07] px-3.5 py-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--muted)]">Vessels</p>
            <p className="mt-1.5 font-mono text-[22px] font-semibold tabular-nums leading-none text-[var(--foreground)]">
              {snapshot?.vesselCount ?? 0}
            </p>
          </div>
          <div className="px-3.5 py-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--muted)]">Moving</p>
            <p className="mt-1.5 font-mono text-[22px] font-semibold tabular-nums leading-none text-[var(--foreground)]">
              {snapshot?.movingCount ?? 0}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Decoder */}
          <div className="border-b border-white/[0.07] px-4 py-3">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Decoder</p>
            <p className="text-xs leading-5 text-[var(--muted-strong)]">
              {snapshot?.runtime.message ?? "AIS decoder state not loaded yet."}
            </p>
            <button
              className={cx(
                "mt-3 inline-flex items-center gap-1.5 rounded border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition",
                runtimeRunning || runtimeStarting
                  ? "border-rose-400/25 bg-rose-400/[0.08] text-rose-300 hover:border-rose-400/45"
                  : "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300 hover:border-emerald-400/45",
              )}
              disabled={runtimeBusy}
              onClick={() => void controlRuntime(runtimeRunning || runtimeStarting ? "DELETE" : "POST")}
              type="button"
            >
              {runtimeBusy && (
                <svg className="h-3 w-3 animate-spin opacity-70" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" />
                </svg>
              )}
              {runtimeBusy
                ? "Working\u2026"
                : runtimeRunning || runtimeStarting
                  ? "Stop Scanning"
                  : "Start Scanning"}
            </button>
          </div>

          {/* Signal parameters */}
          <div className="border-b border-white/[0.07] px-4 py-3">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Signal</p>
            <div className="grid grid-cols-[4.5rem_1fr] gap-y-1.5 font-mono text-[10px]">
              <span className="text-[var(--muted)]">Center</span>
              <span className="text-[var(--muted-strong)]">{formatFrequencyMHz(snapshot?.runtime.centerFreqHz ?? 162_000_000)}</span>
              <span className="text-[var(--muted)]">IQ rate</span>
              <span className="text-[var(--muted-strong)]">{(snapshot?.runtime.sampleRate ?? 1_536_000).toLocaleString("en")} sps</span>
              <span className="text-[var(--muted)]">Started</span>
              <span className="text-[var(--muted-strong)]">{formatTimestamp(snapshot?.runtime.startedAt ?? null)}</span>
              <span className="text-[var(--muted)]">Last frame</span>
              <span className="text-[var(--muted-strong)]">{formatTimestamp(snapshot?.runtime.lastFrameAt ?? null)}</span>
            </div>
          </div>

          {/* Receiver */}
          <div className="border-b border-white/[0.07] px-4 py-3">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Receiver</p>
            <div className="flex items-center gap-2">
              <span className={cx(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                hardware?.state === "connected" ? "bg-emerald-400"
                : hardware?.state === "disconnected" ? "bg-amber-400"
                : "bg-rose-400",
              )} />
              <span className="font-mono text-xs text-[var(--foreground)]">
                {hardware?.product || "HackRF One"}
              </span>
            </div>
            {hardware?.message ? (
              <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">{hardware.message}</p>
            ) : null}
          </div>

          {/* Channels */}
          {(snapshot?.channels ?? []).length > 0 ? (
            <div className="border-b border-white/[0.07] px-4 py-3">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Channels</p>
              <div className="space-y-2">
                {(snapshot?.channels ?? []).map((channel) => (
                  <div key={channel.id} className="rounded-sm border border-white/8 bg-black/20 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] font-medium text-[var(--foreground)]">{channel.label}</span>
                      <span className="font-mono text-[10px] text-[var(--muted)]">{formatFrequencyMHz(channel.freqHz)}</span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] text-[var(--muted)]">
                      <span>{channel.messageCount} msgs</span>
                      <span>phase {channel.lastPhase ?? "\u2014"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Map */}
          <div className="border-b border-white/[0.07] px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Map</p>
              <span className={cx(
                "inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em]",
                snapshot?.maps.available ? "text-emerald-300" : "text-amber-300",
              )}>
                <span className={cx("h-1.5 w-1.5 rounded-full", snapshot?.maps.available ? "bg-emerald-400" : "bg-amber-400")} />
                {snapshot?.maps.available ? "offline" : "live"}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-[var(--muted-strong)]">{snapshot?.maps.name ?? "OpenStreetMap Live"}</p>
          </div>

          {/* Warnings */}
          {snapshot?.warnings.length ? (
            <div className="border-b border-white/[0.07] px-4 py-3">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">Attention</p>
              {snapshot.warnings.map((warning) => (
                <p key={warning} className="text-xs leading-5 text-amber-100">{warning}</p>
              ))}
            </div>
          ) : null}

          {/* Error */}
          {error ? (
            <div className="px-4 py-3 text-xs leading-5 text-rose-300">{error}</div>
          ) : null}
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-2.5">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--foreground)]">Maritime Picture</span>
            <p className="mt-0.5 font-mono text-[10px] text-[var(--muted)]">
              latest contact {formatTimestamp(snapshot?.latestPositionAt ?? null)}
            </p>
          </div>
          <span className="font-mono text-[10px] text-[var(--muted)]">
            {runtimeRunning
              ? "live HackRF decoder"
              : runtimeStarting
                ? "starting decoder"
                : snapshot?.maps.available
                  ? snapshot.maps.kind === "pmtiles"
                    ? "offline dark basemap"
                    : "offline raster layers"
                  : "live OpenStreetMap"}
          </span>
        </div>

        <div className="relative flex-1 overflow-hidden">
          <div
            className={cx(
              "ais-map h-full w-full",
              snapshot?.maps.kind === "pmtiles" && "ais-map--blue-dark",
            )}
            ref={mapHostRef}
          />

          {selected && selectedIsLive ? (
            <div className="pointer-events-none absolute left-4 top-4 z-[1200] max-w-sm rounded-lg border border-white/10 bg-[rgba(6,11,20,0.86)] px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-sm">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
                Selected Vessel
              </p>
              <p className="mt-1 text-lg font-semibold text-[var(--foreground)]">
                {displayVesselName(selected)}
              </p>
              <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">
                MMSI {selected.mmsi} · {formatSpeed(selected.speedKnots)} · {formatCourse(selected.courseDeg)}
              </p>
            </div>
          ) : null}

          <div className="pointer-events-none absolute bottom-3 left-3 z-[1200] max-w-xs rounded border border-white/[0.07] bg-[rgba(4,8,15,0.72)] px-2.5 py-1.5 backdrop-blur-sm">
            <p className="font-mono text-[9px] leading-4 text-[var(--muted)]">
              {snapshot?.maps.attribution ?? "© OpenStreetMap contributors"}
            </p>
          </div>

          {loading && !snapshot ? (
            <div className="pointer-events-none absolute inset-0 z-[1200] flex items-center justify-center bg-black/25 backdrop-blur-[2px]">
              <div className="rounded-lg border border-white/10 bg-[rgba(6,11,20,0.88)] px-4 py-3 text-sm text-[var(--muted-strong)]">
                Starting AIS decoder...
              </div>
            </div>
          ) : null}

          {!loading && snapshot && snapshot.vesselCount === 0 ? (
            <div className="pointer-events-none absolute inset-0 z-[1200] flex items-end justify-center pb-20">
              <div className="flex flex-col items-center gap-3 rounded border border-white/[0.07] bg-[rgba(4,8,15,0.72)] px-6 py-4 text-center backdrop-blur-sm">
                <div className="h-px w-8 bg-[var(--accent)]/20" />
                <p className="font-mono text-[9px] uppercase tracking-[0.32em] text-[var(--accent)]/60">
                  No Contacts
                </p>
                <p className="max-w-[22rem] text-[11px] leading-6 text-[var(--muted)]">
                  {runtimeState === "error"
                    ? snapshot.runtime.message
                    : runtimeRunning
                      ? "Decoder is live — no valid AIS positions decoded yet."
                      : runtimeStarting
                        ? "Decoder starting\u2026"
                        : contactList.length > 0
                          ? "No live vessel positions right now. Historical contacts remain available in the sidebar."
                          : "Start Scanning to populate the maritime picture with live HackRF data."}
                </p>
                <div className="h-px w-8 bg-[var(--accent)]/20" />
              </div>
            </div>
          ) : null}
        </div>
      </main>

      <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-white/8 bg-black/15">
        <div className="border-b border-white/[0.07] px-5 py-4">
          {selected ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Vessel</p>
                  <h3 className="mt-1 truncate text-base font-semibold leading-tight text-[var(--foreground)]">
                    {displayVesselName(selected)}
                  </h3>
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--muted)]">MMSI {selected.mmsi}</p>
                </div>
                <span className={cx(
                  "mt-0.5 shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em]",
                  !selectedIsLive
                    ? "bg-white/[0.05] text-[var(--muted-strong)]"
                    : selected.isMoving
                      ? "bg-[var(--highlight)]/10 text-[var(--highlight)]"
                      : "bg-[var(--accent)]/10 text-[var(--accent)]",
                )}>
                  {!selectedIsLive ? "History" : selected.isMoving ? "Underway" : "At anchor"}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {[
                  { label: "SPD", value: formatSpeed(selected.speedKnots) },
                  { label: "COG", value: formatCourse(selected.courseDeg) },
                ].map((s) => (
                  <div key={s.label} className="rounded-sm border border-white/8 bg-white/[0.025] px-2 py-1.5">
                    <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-[var(--muted)]">{s.label}</p>
                    <p className="mt-0.5 font-mono text-[11px] font-medium tabular-nums text-[var(--foreground)]">{s.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-3 grid grid-cols-[4.5rem_1fr] gap-y-1.5 font-mono text-[10px]">
                <span className="text-[var(--muted)]">Status</span>
                <span className="text-[var(--muted-strong)]">{selected.navStatus || "\u2014"}</span>
                <span className="text-[var(--muted)]">Type</span>
                <span className="text-[var(--muted-strong)]">{selected.shipType || "\u2014"}</span>
                <span className="text-[var(--muted)]">Callsign</span>
                <span className="text-[var(--muted-strong)]">{selected.callsign || "\u2014"}</span>
                <span className="text-[var(--muted)]">IMO</span>
                <span className="text-[var(--muted-strong)]">{selected.imo || "\u2014"}</span>
                <span className="text-[var(--muted)]">Dest.</span>
                <span className="text-[var(--muted-strong)]">{selected.destination || "\u2014"}</span>
                <span className="text-[var(--muted)]">Position</span>
                <span className="text-[var(--muted-strong)]">{formatCoordinates(selected)}</span>
                <span className="text-[var(--muted)]">Last seen</span>
                <span className="text-[var(--muted-strong)]">{formatTimestamp(selected.lastSeenAt)}</span>
              </div>
            </>
          ) : (
            <p className="text-xs leading-5 text-[var(--muted)]">Select a vessel from the map or list to inspect it.</p>
          )}
        </div>

        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Contacts</span>
          <span className="font-mono text-[10px] text-[var(--muted)]">{contactList.length}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {contactList.map((vessel) => {
            const isSelected = vessel.mmsi === selected?.mmsi;
            const isLive = liveMmsiSet.has(vessel.mmsi);
            return (
              <button
                key={vessel.mmsi}
                className={cx(
                  "flex w-full items-start gap-3 border-b border-white/[0.05] px-5 py-3 text-left transition",
                  isSelected ? "bg-[var(--accent)]/8 border-l-accent" : "hover:bg-white/[0.025] border-l-clear",
                )}
                onClick={() => {
                  setSelectedMmsi(vessel.mmsi);
                  if (isLive) {
                    focusVessel(vessel);
                  }
                }}
                type="button"
              >
                <span className={cx(
                  "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                  !isLive ? "bg-white/25" : vessel.isMoving ? "bg-[var(--highlight)]" : "bg-[var(--accent)]",
                )} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs font-medium text-[var(--foreground)]">
                    {displayVesselName(vessel)}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-[var(--muted)]">
                    MMSI {vessel.mmsi}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-[var(--muted)]">
                    {isLive
                      ? vessel.navStatus || vessel.shipType || "Live contact"
                      : `History only · ${formatTimestamp(vessel.lastSeenAt)}`}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-[10px] text-[var(--muted-strong)]">
                    {formatSpeed(vessel.speedKnots)}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-[var(--muted)]">
                    {vessel.sourceLabel}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
