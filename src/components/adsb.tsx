"use client";

import type { Layer, LayerGroup, Map as LeafletMap } from "leaflet";
import { useEffect, useRef, useState } from "react";

import type {
  AdsbAircraftContact,
  AdsbFeedSnapshot,
  AdsbRuntimeState,
  HardwareStatus,
} from "@/lib/types";
import {
  buildBoundsPairs,
  buildPointBounds,
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

type AdsbModuleProps = {
  hardware: HardwareStatus | null;
  onRefreshHardware: () => Promise<void>;
};

function cx(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(" ");
}

function displayAircraftName(aircraft: AdsbAircraftContact): string {
  return aircraft.flight || aircraft.hex;
}

function formatSpeed(speedKnots: number | null): string {
  return speedKnots === null ? "\u2014" : `${speedKnots.toFixed(1)} kn`;
}

function formatTrack(trackDeg: number | null): string {
  return trackDeg === null ? "\u2014" : `${trackDeg.toFixed(1)}\u00b0`;
}

function formatAltitude(altitudeFeet: number | null): string {
  return altitudeFeet === null ? "\u2014" : `${Math.round(altitudeFeet).toLocaleString("en")} ft`;
}

function formatCoordinates(latitude: number | null, longitude: number | null): string {
  if (latitude === null || longitude === null) {
    return "\u2014";
  }

  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
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

function runtimeTone(state: AdsbRuntimeState | null): string {
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

function runtimeLabel(state: AdsbRuntimeState | null): string {
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

async function fetchAdsbFeed(): Promise<AdsbFeedSnapshot> {
  const response = await fetch("/api/adsb", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as AdsbFeedSnapshot;
}

async function requestAdsbRuntime(method: "POST" | "DELETE"): Promise<void> {
  const response = await fetch("/api/adsb-runtime", {
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
  aircraft: AdsbAircraftContact,
  isSelected: boolean,
) {
  const heading = Number.isFinite(aircraft.trackDeg ?? NaN) ? aircraft.trackDeg : 0;
  const color = aircraft.emergency
    ? "var(--rose-300, #fda4af)"
    : aircraft.onGround
      ? "var(--accent, #57d7ff)"
      : "var(--highlight, #3dd9b8)";
  const halo = aircraft.emergency
    ? "rgba(251, 113, 133, 0.32)"
    : aircraft.onGround
      ? "rgba(87, 215, 255, 0.18)"
      : "rgba(61, 217, 184, 0.18)";

  return leaflet.divIcon({
    className: "adsb-aircraft-icon-shell",
    html: `
      <span class="adsb-aircraft-icon ${isSelected ? "is-selected" : ""}" style="--adsb-heading:${heading}deg; --adsb-color:${color}; --adsb-halo:${halo};">
        <span class="adsb-aircraft-icon__halo"></span>
        <span class="adsb-aircraft-icon__body"></span>
        <span class="adsb-aircraft-icon__wing"></span>
      </span>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

export function AdsbModule({ hardware, onRefreshHardware }: AdsbModuleProps) {
  const mapHostRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerLayerRef = useRef<LayerGroup | null>(null);
  const basemapLayerRef = useRef<Layer | null>(null);
  const didFitBoundsRef = useRef(false);
  const [selectedHex, setSelectedHex] = useState("");
  const basemapSignatureRef = useRef("");

  const { savedCityResolved, savedCityView } = useSavedCityView();
  const {
    controlRuntime,
    error,
    loading,
    runtimeBusy,
    setError,
    snapshot,
  } = useManagedRuntimeFeed<AdsbFeedSnapshot>({
    fetchSnapshot: fetchAdsbFeed,
    messages: {
      refresh: "Could not refresh the ADS-B feed.",
      start: "Could not start the ADS-B decoder.",
      stop: "Could not stop the ADS-B decoder.",
    },
    onRefreshHardware,
    startRuntime: () => requestAdsbRuntime("POST"),
    stopRuntime: () => requestAdsbRuntime("DELETE"),
  });
  const tilePackKind = snapshot?.tilePack.kind ?? null;
  const tilePackTileUrlTemplate = snapshot?.tilePack.tileUrlTemplate ?? null;
  const tilePackPmtilesUrl = snapshot?.tilePack.pmtilesUrl ?? null;
  const tilePackFlavor = snapshot?.tilePack.flavor ?? null;
  const tilePackLang = snapshot?.tilePack.lang ?? null;
  const tilePackMinZoom = snapshot?.tilePack.minZoom ?? null;
  const tilePackMaxZoom = snapshot?.tilePack.maxZoom ?? null;
  const tilePackAttribution = snapshot?.tilePack.attribution ?? null;

  function focusAircraft(aircraft: AdsbAircraftContact): void {
    if (aircraft.latitude === null || aircraft.longitude === null) {
      return;
    }

    mapRef.current?.panTo([aircraft.latitude, aircraft.longitude], {
      animate: true,
      duration: 0.7,
    });
  }

  useEffect(() => {
    if (!snapshot?.aircraft.length) {
      setSelectedHex("");
      return;
    }

    if (!snapshot.aircraft.some((aircraft) => aircraft.hex === selectedHex)) {
      setSelectedHex(snapshot.aircraft[0].hex);
    }
  }, [selectedHex, snapshot]);

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
    snapshot?.aircraft.find((aircraft) => aircraft.hex === selectedHex) ??
    snapshot?.aircraft[0] ??
    null;

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    const markerLayer = markerLayerRef.current;
    if (!leaflet || !map || !markerLayer || !snapshot) {
      return;
    }

    markerLayer.clearLayers();

    for (const aircraft of snapshot.aircraft) {
      if (aircraft.latitude === null || aircraft.longitude === null) {
        continue;
      }

      const marker = leaflet.marker([aircraft.latitude, aircraft.longitude], {
        icon: buildMarkerIcon(leaflet, aircraft, aircraft.hex === selected?.hex),
        keyboard: false,
        riseOnHover: true,
      });

      marker.on("click", () => {
        setSelectedHex(aircraft.hex);
      });
      marker.bindTooltip(
        `${displayAircraftName(aircraft)} \u00b7 ${formatAltitude(aircraft.altitudeFeet)}`,
        {
          className: "ais-tooltip",
          direction: "top",
          offset: [0, -14],
          opacity: 1,
        },
      );
      markerLayer.addLayer(marker);
    }

    const receiver = snapshot.receiver;
    const receiverBounds =
      receiver && receiver.latitude !== null && receiver.longitude !== null
        ? buildPointBounds(receiver.latitude, receiver.longitude)
        : null;
    const boundsToFit = snapshot.bounds ?? (
      savedCityResolved && !savedCityView
        ? receiverBounds ?? snapshot.tilePack.bounds
        : null
    );

    if (!didFitBoundsRef.current && boundsToFit) {
      if (isPointBounds(boundsToFit)) {
        map.setView(
          [boundsToFit.south, boundsToFit.west],
          Math.min(snapshot.tilePack.maxZoom, 11),
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
  const positionedAircraft = snapshot?.aircraft.filter(
    (entry) => entry.latitude !== null && entry.longitude !== null,
  ) ?? [];

  return (
    <div className="flex flex-1 overflow-hidden">
      <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-white/8 bg-black/10">
        <div className="space-y-4 p-4">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--muted)]">
              ADS-B Feed
            </span>
            <h2 className="mt-2 text-xl font-semibold text-[var(--foreground)]">
              Air picture
            </h2>
            <p className="mt-1.5 text-sm leading-6 text-[var(--muted)]">
              Live ADS-B and Mode S traffic from the HackRF on 1090 MHz using a local dump1090-fa backend.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">
                Aircraft
              </p>
              <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">
                {snapshot?.aircraftCount ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">
                Positioned
              </p>
              <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">
                {snapshot?.positionCount ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">
                Airborne
              </p>
              <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">
                {snapshot?.airborneCount ?? 0}
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
              {snapshot?.runtime.message ?? "ADS-B decoder state not loaded yet."}
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
              <p>Center {formatFrequencyMHz(snapshot?.runtime.centerFreqHz ?? 1_090_000_000)}</p>
              <p>IQ rate {(snapshot?.runtime.sampleRate ?? 2_400_000).toLocaleString("en")} sps</p>
              <p>Started {formatTimestamp(snapshot?.runtime.startedAt ?? null)}</p>
              <p>Last JSON {formatTimestamp(snapshot?.runtime.lastJsonAt ?? null)}</p>
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
            {snapshot?.receiver ? (
              <div className="mt-3 space-y-1 font-mono text-[10px] text-[var(--muted)]">
                <p>dump1090 {snapshot.receiver.version || "\u2014"}</p>
                <p>refresh {snapshot.receiver.refreshMs ?? "\u2014"} ms</p>
                <p>coords {formatCoordinates(snapshot.receiver.latitude, snapshot.receiver.longitude)}</p>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                Decoder Stats
              </p>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--muted-strong)]">
                latest
              </span>
            </div>
            {snapshot?.stats ? (
              <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[10px] text-[var(--muted)]">
                <p>{snapshot.stats.messages.toLocaleString("en")} msgs</p>
                <p>{snapshot.stats.modes.toLocaleString("en")} preambles</p>
                <p>{snapshot.stats.bad.toLocaleString("en")} bad</p>
                <p>{snapshot.stats.strongSignals.toLocaleString("en")} strong</p>
                <p>signal {snapshot.stats.signalDbfs?.toFixed(1) ?? "\u2014"} dBFS</p>
                <p>noise {snapshot.stats.noiseDbfs?.toFixed(1) ?? "\u2014"} dBFS</p>
                <p>peak {snapshot.stats.peakSignalDbfs?.toFixed(1) ?? "\u2014"} dBFS</p>
                <p>gain {snapshot.stats.gainDb?.toFixed(1) ?? "\u2014"} dB</p>
              </div>
            ) : (
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                No decoder stats available yet.
              </p>
            )}
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
              ADS-B Map
            </span>
            <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
              latest aircraft {formatTimestamp(snapshot?.latestMessageAt ?? null)}
            </p>
          </div>
          <span className="font-mono text-[10px] text-[var(--muted)]">
            {runtimeRunning
              ? "live dump1090-fa decoder"
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
                Selected Aircraft
              </p>
              <p className="mt-1 text-lg font-semibold text-[var(--foreground)]">
                {displayAircraftName(selected)}
              </p>
              <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">
                HEX {selected.hex} · {formatAltitude(selected.altitudeFeet)} · {formatSpeed(selected.groundSpeedKnots)}
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
                Starting ADS-B decoder...
              </div>
            </div>
          ) : null}

          {!loading && snapshot && positionedAircraft.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 z-[1200] flex items-center justify-center bg-black/20">
              <div className="max-w-md rounded-2xl border border-white/10 bg-[rgba(6,11,20,0.88)] px-5 py-4 text-center">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
                  No Aircraft
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  {runtimeState === "error"
                    ? snapshot.runtime.message
                    : runtimeRunning
                      ? "The decoder is running, but no aircraft positions have been produced yet."
                      : runtimeStarting
                        ? "The decoder is still starting."
                        : "Start the ADS-B decoder to populate the map with live HackRF data."}
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
                Aircraft Detail
              </p>
              <h3 className="mt-2 text-xl font-semibold leading-tight text-[var(--foreground)]">
                {displayAircraftName(selected)}
              </h3>
              <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">
                HEX {selected.hex}
              </p>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
                    Altitude
                  </p>
                  <p className="mt-1 text-sm text-[var(--foreground)]">
                    {formatAltitude(selected.altitudeFeet)}
                  </p>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
                    Speed
                  </p>
                  <p className="mt-1 text-sm text-[var(--foreground)]">
                    {formatSpeed(selected.groundSpeedKnots)}
                  </p>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
                    Track
                  </p>
                  <p className="mt-1 text-sm text-[var(--foreground)]">
                    {formatTrack(selected.trackDeg)}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-2 text-sm">
                <p className="text-[var(--muted)]">
                  <span className="text-[var(--muted-strong)]">Source:</span> {selected.sourceLabel || "\u2014"}
                </p>
                <p className="text-[var(--muted)]">
                  <span className="text-[var(--muted-strong)]">Type:</span> {selected.type || "\u2014"}
                </p>
                <p className="text-[var(--muted)]">
                  <span className="text-[var(--muted-strong)]">Category:</span> {selected.category || "\u2014"}
                </p>
                <p className="text-[var(--muted)]">
                  <span className="text-[var(--muted-strong)]">Squawk:</span> {selected.squawk || "\u2014"}
                </p>
                <p className="text-[var(--muted)]">
                  <span className="text-[var(--muted-strong)]">Emergency:</span> {selected.emergency || "\u2014"}
                </p>
                <p className="text-[var(--muted)]">
                  <span className="text-[var(--muted-strong)]">Vertical rate:</span> {selected.verticalRateFpm === null ? "\u2014" : `${Math.round(selected.verticalRateFpm).toLocaleString("en")} fpm`}
                </p>
                <p className="text-[var(--muted)]">
                  <span className="text-[var(--muted-strong)]">RSSI:</span> {selected.rssi === null ? "\u2014" : `${selected.rssi.toFixed(1)} dBFS`}
                </p>
                <p className="text-[var(--muted)]">
                  <span className="text-[var(--muted-strong)]">Coords:</span> {formatCoordinates(selected.latitude, selected.longitude)}
                </p>
                <p className="text-[var(--muted)]">
                  <span className="text-[var(--muted-strong)]">Last seen:</span> {formatTimestamp(selected.seenAt)}
                </p>
                <p className="text-[var(--muted)]">
                  <span className="text-[var(--muted-strong)]">Last position:</span> {formatTimestamp(selected.seenPosAt)}
                </p>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm leading-6 text-[var(--muted)]">
                Pick an aircraft from the map or list to inspect it.
              </p>
            </>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
              Contacts
            </p>
            <span className="font-mono text-[10px] text-[var(--muted)]">
              {snapshot?.aircraftCount ?? 0}
            </span>
          </div>

          <div className="space-y-2">
            {(snapshot?.aircraft ?? []).map((aircraft) => {
              const active = aircraft.hex === selected?.hex;

              return (
                <button
                  key={aircraft.hex}
                  className={cx(
                    "group w-full rounded-2xl border px-3 py-3 text-left transition",
                    active
                      ? "border-[var(--accent)]/40 bg-[var(--accent)]/10"
                      : "border-white/8 bg-white/[0.02] hover:border-white/14 hover:bg-white/[0.04]",
                  )}
                  onClick={() => {
                    setSelectedHex(aircraft.hex);
                    focusAircraft(aircraft);
                  }}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-[var(--foreground)]">
                        {displayAircraftName(aircraft)}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
                        HEX {aircraft.hex}
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {aircraft.emergency || aircraft.squawk || aircraft.sourceLabel}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-[10px] text-[var(--muted-strong)]">
                        {formatAltitude(aircraft.altitudeFeet)}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
                        {formatSpeed(aircraft.groundSpeedKnots)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}
