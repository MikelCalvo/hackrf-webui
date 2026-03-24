"use client";

import type { Layer, LayerGroup, Map as LeafletMap } from "leaflet";
import { useEffect, useRef, useState } from "react";

import type {
  AisFeedSnapshot,
  AisRuntimeState,
  AisVesselContact,
  HardwareStatus,
} from "@/lib/types";
import {
  buildBoundsPairs,
  isPointBounds,
  syncLeafletBasemap,
  useManagedRuntimeFeed,
  useSavedCityView,
} from "@/components/live-map";

const EMPTY_TILE_DATA_URL =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const DEFAULT_CENTER: [number, number] = [0, 0];
const DEFAULT_ZOOM = 2;
const DEFAULT_CITY_ZOOM = 9;

type AisModuleProps = {
  hardware: HardwareStatus | null;
  onRefreshHardware: () => Promise<void>;
};

function cx(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(" ");
}

function displayVesselName(vessel: AisVesselContact): string {
  return vessel.name || vessel.callsign || vessel.mmsi;
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

function runtimeTone(state: AisRuntimeState | null): string {
  switch (state) {
    case "running":
      return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
    case "starting":
      return "border-amber-400/20 bg-amber-400/10 text-amber-200";
    case "error":
      return "border-rose-400/20 bg-rose-400/10 text-rose-200";
    default:
      return "border-white/10 bg-white/[0.04] text-[var(--muted-strong)]";
  }
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

export function AisModule({ hardware, onRefreshHardware }: AisModuleProps) {
  const mapHostRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerLayerRef = useRef<LayerGroup | null>(null);
  const basemapLayerRef = useRef<Layer | null>(null);
  const didFitBoundsRef = useRef(false);
  const [selectedMmsi, setSelectedMmsi] = useState("");
  const basemapSignatureRef = useRef("");

  const { savedCityResolved, savedCityView } = useSavedCityView();
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
  const tilePackKind = snapshot?.tilePack.kind ?? null;
  const tilePackTileUrlTemplate = snapshot?.tilePack.tileUrlTemplate ?? null;
  const tilePackPmtilesUrl = snapshot?.tilePack.pmtilesUrl ?? null;
  const tilePackFlavor = snapshot?.tilePack.flavor ?? null;
  const tilePackLang = snapshot?.tilePack.lang ?? null;
  const tilePackMinZoom = snapshot?.tilePack.minZoom ?? null;
  const tilePackMaxZoom = snapshot?.tilePack.maxZoom ?? null;
  const tilePackAttribution = snapshot?.tilePack.attribution ?? null;

  function focusVessel(vessel: AisVesselContact): void {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    map.panTo([vessel.latitude, vessel.longitude], {
      animate: true,
      duration: 0.7,
    });
  }

  useEffect(() => {
    if (!snapshot?.vessels.length) {
      setSelectedMmsi("");
      return;
    }

    if (!snapshot.vessels.some((vessel) => vessel.mmsi === selectedMmsi)) {
      setSelectedMmsi(snapshot.vessels[0].mmsi);
    }
  }, [selectedMmsi, snapshot]);

  useEffect(() => {
    let active = true;

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
      mapRef.current = map;
      markerLayerRef.current = leaflet.layerGroup().addTo(map);
    };

    void setup();

    return () => {
      active = false;
      basemapLayerRef.current?.remove();
      markerLayerRef.current?.clearLayers();
      mapRef.current?.remove();
      basemapLayerRef.current = null;
      markerLayerRef.current = null;
      mapRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !savedCityView || snapshot?.bounds) {
      return;
    }

    const minZoom = tilePackMinZoom ?? 0;
    const maxZoom = tilePackMaxZoom ?? DEFAULT_CITY_ZOOM;
    const cityZoom = Math.min(Math.max(DEFAULT_CITY_ZOOM, minZoom), maxZoom);

    map.setView([savedCityView.latitude, savedCityView.longitude], cityZoom, {
      animate: false,
    });
  }, [savedCityView, snapshot?.bounds, tilePackMaxZoom, tilePackMinZoom]);

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    if (!leaflet || !map) {
      return;
    }

    let cancelled = false;
    void syncLeafletBasemap({
      cancelled: () => cancelled,
      emptyTileDataUrl: EMPTY_TILE_DATA_URL,
      errorMessage: "Could not load the offline PMTiles basemap.",
      leaflet,
      layerRef: basemapLayerRef,
      map,
      onError: setError,
      signatureRef: basemapSignatureRef,
      source: {
        kind: tilePackKind,
        tileUrlTemplate: tilePackTileUrlTemplate,
        pmtilesUrl: tilePackPmtilesUrl,
        flavor: tilePackFlavor,
        lang: tilePackLang,
        minZoom: tilePackMinZoom,
        maxZoom: tilePackMaxZoom,
        attribution: tilePackAttribution,
      },
    });

    return () => {
      cancelled = true;
    };
  }, [
    setError,
    tilePackAttribution,
    tilePackFlavor,
    tilePackKind,
    tilePackLang,
    tilePackMaxZoom,
    tilePackMinZoom,
    tilePackPmtilesUrl,
    tilePackTileUrlTemplate,
  ]);

  const selected =
    snapshot?.vessels.find((vessel) => vessel.mmsi === selectedMmsi) ??
    snapshot?.vessels[0] ??
    null;

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    const markerLayer = markerLayerRef.current;
    if (!leaflet || !map || !markerLayer || !snapshot) {
      return;
    }

    markerLayer.clearLayers();

    for (const vessel of snapshot.vessels) {
      const marker = leaflet.marker([vessel.latitude, vessel.longitude], {
        icon: buildMarkerIcon(leaflet, vessel, vessel.mmsi === selected?.mmsi),
        keyboard: false,
        riseOnHover: true,
      });

      marker.on("click", () => {
        setSelectedMmsi(vessel.mmsi);
      });
      marker.bindTooltip(
        `${displayVesselName(vessel)} \u00b7 ${formatSpeed(vessel.speedKnots)}`,
        {
          className: "ais-tooltip",
          direction: "top",
          offset: [0, -14],
          opacity: 1,
        },
      );
      markerLayer.addLayer(marker);
    }

    const boundsToFit = snapshot.bounds ?? (
      savedCityResolved && !savedCityView
        ? snapshot.tilePack.bounds
        : null
    );
    if (!didFitBoundsRef.current && boundsToFit) {
      if (isPointBounds(boundsToFit)) {
        map.setView(
          [boundsToFit.south, boundsToFit.west],
          Math.min(snapshot.tilePack.maxZoom, 13),
          { animate: false },
        );
      } else {
        map.fitBounds(buildBoundsPairs(boundsToFit), {
          padding: [28, 28],
          animate: false,
        });
      }
      didFitBoundsRef.current = true;
    }

  }, [savedCityResolved, savedCityView, selected, snapshot]);

  const runtimeState = snapshot?.runtime.state ?? null;
  const runtimeRunning = runtimeState === "running";
  const runtimeStarting = runtimeState === "starting";

  return (
    <div className="flex flex-1 overflow-hidden">
      <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-white/8 bg-black/10">
        <div className="space-y-4 p-4">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--muted)]">
              AIS Feed
            </span>
            <h2 className="mt-2 text-xl font-semibold text-[var(--foreground)]">
              Maritime picture
            </h2>
            <p className="mt-1.5 text-sm leading-6 text-[var(--muted)]">
              Live AIS reception from the HackRF across channels A and B at 161.975 and 162.025 MHz.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">
                Vessels
              </p>
              <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">
                {snapshot?.vesselCount ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">
                Moving
              </p>
              <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">
                {snapshot?.movingCount ?? 0}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                Decoder
              </p>
              <span
                className={cx(
                  "rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]",
                  runtimeTone(runtimeState),
                )}
              >
                {runtimeLabel(runtimeState)}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--foreground)]">
              {snapshot?.runtime.message ?? "AIS decoder state not loaded yet."}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                className={cx(
                  "rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition",
                  runtimeRunning || runtimeStarting
                    ? "border-rose-400/25 bg-rose-400/10 text-rose-200 hover:border-rose-400/40"
                    : "border-emerald-400/25 bg-emerald-400/10 text-emerald-200 hover:border-emerald-400/40",
                )}
                disabled={runtimeBusy}
                onClick={() => void controlRuntime(runtimeRunning || runtimeStarting ? "DELETE" : "POST")}
                type="button"
              >
                {runtimeBusy
                  ? "Working"
                  : runtimeRunning || runtimeStarting
                    ? "Stop Decoder"
                    : "Start Decoder"}
              </button>
            </div>
            <div className="mt-3 space-y-1 font-mono text-[10px] text-[var(--muted)]">
              <p>Center {formatFrequencyMHz(snapshot?.runtime.centerFreqHz ?? 162_000_000)}</p>
              <p>IQ rate {(snapshot?.runtime.sampleRate ?? 1_536_000).toLocaleString("en")} sps</p>
              <p>Started {formatTimestamp(snapshot?.runtime.startedAt ?? null)}</p>
              <p>Last frame {formatTimestamp(snapshot?.runtime.lastFrameAt ?? null)}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
              Receiver
            </p>
            <div className="mt-3 flex items-center gap-2">
              <span
                className={cx(
                  "h-2 w-2 rounded-full",
                  hardware?.state === "connected"
                    ? "bg-emerald-400"
                    : hardware?.state === "disconnected"
                      ? "bg-amber-400"
                      : "bg-rose-400",
                )}
              />
              <span className="font-mono text-xs text-[var(--foreground)]">
                {hardware?.product || "HackRF One"}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              {hardware?.message || "Hardware status not loaded yet."}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                Map Tiles
              </p>
              <span
                className={cx(
                  "rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]",
                  snapshot?.tilePack.available
                    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                    : "border-amber-400/20 bg-amber-400/10 text-amber-200",
                )}
              >
                {snapshot?.tilePack.available ? "offline" : "live"}
              </span>
            </div>
            <p className="mt-2 text-sm text-[var(--foreground)]">
              {snapshot?.tilePack.name ?? "OpenStreetMap Live"}
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              {snapshot?.tilePack.available
                ? snapshot.tilePack.kind === "pmtiles"
                  ? `Local dark PMTiles basemap ready up to z${snapshot.tilePack.maxZoom}.`
                  : `Local raster pack ready up to z${snapshot.tilePack.maxZoom}.`
                : "No local tile pack installed yet. The module falls back to live OpenStreetMap tiles."}
            </p>
            {snapshot?.tilePack.installedAt ? (
              <p className="mt-2 font-mono text-[10px] text-[var(--muted)]">
                installed {formatTimestamp(snapshot.tilePack.installedAt)}
              </p>
            ) : null}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
              Channels
            </p>
            <div className="mt-3 space-y-2">
              {(snapshot?.channels ?? []).map((channel) => (
                <div
                  key={channel.id}
                  className="rounded-xl border border-white/8 bg-black/20 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-[var(--foreground)]">{channel.label}</span>
                    <span className="font-mono text-[10px] text-[var(--muted)]">
                      {formatFrequencyMHz(channel.freqHz)}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[10px] text-[var(--muted)]">
                    <p>{channel.messageCount} msgs</p>
                    <p>phase {channel.lastPhase ?? "\u2014"}</p>
                    <p>last {formatTimestamp(channel.lastSeenAt)}</p>
                    <p>{channel.lastMessageType ?? "No frame yet"}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {snapshot?.warnings.length ? (
            <div className="space-y-2 rounded-2xl border border-amber-400/20 bg-amber-400/8 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-200">
                Attention
              </p>
              {snapshot.warnings.map((warning) => (
                <p key={warning} className="text-xs leading-5 text-amber-100">
                  {warning}
                </p>
              ))}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-rose-400/20 bg-rose-400/8 p-4 text-xs leading-5 text-rose-100">
              {error}
            </div>
          ) : null}
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-2.5">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
              AIS Map
            </span>
            <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
              latest contact {formatTimestamp(snapshot?.latestPositionAt ?? null)}
            </p>
          </div>
          <span className="font-mono text-[10px] text-[var(--muted)]">
            {runtimeRunning
              ? "live HackRF decoder"
              : runtimeStarting
                ? "starting decoder"
                : snapshot?.tilePack.available
                  ? snapshot.tilePack.kind === "pmtiles"
                    ? "offline dark basemap"
                    : "offline raster basemap"
                  : "live OpenStreetMap"}
          </span>
        </div>

        <div className="relative flex-1 overflow-hidden">
          <div
            className={cx(
              "ais-map h-full w-full",
              snapshot?.tilePack.kind === "pmtiles" && "ais-map--blue-dark",
            )}
            ref={mapHostRef}
          />

          {selected ? (
            <div className="pointer-events-none absolute left-4 top-4 z-[1200] max-w-sm rounded-2xl border border-white/10 bg-[rgba(6,11,20,0.86)] px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-sm">
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

          <div className="pointer-events-none absolute bottom-4 left-4 z-[1200] max-w-sm rounded-2xl border border-white/10 bg-[rgba(6,11,20,0.78)] px-4 py-3 backdrop-blur-sm">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
              Attribution
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted-strong)]">
              {snapshot?.tilePack.attribution ?? "© OpenStreetMap contributors"}
            </p>
          </div>

          {loading && !snapshot ? (
            <div className="pointer-events-none absolute inset-0 z-[1200] flex items-center justify-center bg-black/25 backdrop-blur-[2px]">
              <div className="rounded-2xl border border-white/10 bg-[rgba(6,11,20,0.88)] px-4 py-3 text-sm text-[var(--muted-strong)]">
                Starting AIS decoder...
              </div>
            </div>
          ) : null}

          {!loading && snapshot && snapshot.vesselCount === 0 ? (
            <div className="pointer-events-none absolute inset-0 z-[1200] flex items-center justify-center bg-black/20">
              <div className="max-w-md rounded-2xl border border-white/10 bg-[rgba(6,11,20,0.88)] px-5 py-4 text-center">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
                  No Contacts
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  {runtimeState === "error"
                    ? snapshot.runtime.message
                    : runtimeRunning
                    ? "The decoder is running, but no valid AIS vessel positions have been decoded yet."
                    : runtimeStarting
                      ? "The decoder is still starting."
                      : "Start the AIS decoder to populate the map with live HackRF data."}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </main>

      <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-white/8 bg-black/15">
        <div className="border-b border-white/8 p-5">
          {selected ? (
            <>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                Vessel Detail
              </p>
              <h3 className="mt-2 text-xl font-semibold leading-tight text-[var(--foreground)]">
                {displayVesselName(selected)}
              </h3>
              <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">
                MMSI {selected.mmsi}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
                    Speed
                  </p>
                  <p className="mt-1 text-sm text-[var(--foreground)]">
                    {formatSpeed(selected.speedKnots)}
                  </p>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
                    Course
                  </p>
                  <p className="mt-1 text-sm text-[var(--foreground)]">
                    {formatCourse(selected.courseDeg)}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-2 text-sm">
                <p className="text-[var(--muted)]">
                  <span className="text-[var(--muted-strong)]">Status:</span> {selected.navStatus || "\u2014"}
                </p>
                <p className="text-[var(--muted)]">
                  <span className="text-[var(--muted-strong)]">Type:</span> {selected.shipType || "\u2014"}
                </p>
                <p className="text-[var(--muted)]">
                  <span className="text-[var(--muted-strong)]">Callsign:</span> {selected.callsign || "\u2014"}
                </p>
                <p className="text-[var(--muted)]">
                  <span className="text-[var(--muted-strong)]">IMO:</span> {selected.imo || "\u2014"}
                </p>
                <p className="text-[var(--muted)]">
                  <span className="text-[var(--muted-strong)]">Destination:</span> {selected.destination || "\u2014"}
                </p>
                <p className="text-[var(--muted)]">
                  <span className="text-[var(--muted-strong)]">Coords:</span> {formatCoordinates(selected)}
                </p>
                <p className="text-[var(--muted)]">
                  <span className="text-[var(--muted-strong)]">Last seen:</span> {formatTimestamp(selected.lastSeenAt)}
                </p>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                Vessel Detail
              </p>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                Pick a vessel from the map or list to inspect its live AIS data.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-b border-white/8 px-5 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
            Contacts
          </p>
          <span className="font-mono text-[10px] text-[var(--muted)]">
            {snapshot?.vesselCount ?? 0}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {(snapshot?.vessels ?? []).map((vessel) => {
            const isSelected = vessel.mmsi === selected?.mmsi;

            return (
              <button
                key={vessel.mmsi}
                className={cx(
                  "flex w-full items-start gap-3 border-b border-white/[0.05] px-5 py-3 text-left transition",
                  isSelected
                    ? "bg-[var(--accent)]/8"
                    : "hover:bg-white/[0.03]",
                )}
                onClick={() => {
                  setSelectedMmsi(vessel.mmsi);
                  focusVessel(vessel);
                }}
                type="button"
              >
                <span
                  className={cx(
                    "mt-1 h-2 w-2 shrink-0 rounded-full",
                    vessel.isMoving ? "bg-[var(--highlight)]" : "bg-[var(--accent)]",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--foreground)]">
                    {displayVesselName(vessel)}
                  </span>
                  <span className="mt-1 block font-mono text-[10px] text-[var(--muted)]">
                    MMSI {vessel.mmsi}
                  </span>
                  <span className="mt-1 block text-xs text-[var(--muted)]">
                    {vessel.navStatus || vessel.shipType || "AIS contact"}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-[10px] text-[var(--muted-strong)]">
                    {formatSpeed(vessel.speedKnots)}
                  </span>
                  <span className="mt-1 block font-mono text-[10px] text-[var(--muted)]">
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
