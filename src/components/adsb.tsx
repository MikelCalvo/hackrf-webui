"use client";

import type { Layer, LayerGroup, Map as LeafletMap } from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AdsbAircraftContact,
  AdsbFeedSnapshot,
  AdsbRuntimeState,
  HardwareStatus,
  ResolvedAppLocation,
} from "@/lib/types";
import { MapOverlayCard } from "@/components/map-overlay-card";
import {
  buildBasemapSources,
  buildBoundsPairs,
  buildPointBounds,
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
const AIRCRAFT_ICON_PATH =
  "M32 4c2 0 3.5 1.6 3.5 3.6v14.7l13.8 5.6c2 .8 3.2 2.7 3.2 4.8v2.7l-17-2.7v8.2l6.2 4.2c1.1.8 1.9 1.9 2.1 3.3L45 60h-5.4L32 53.4 24.4 60H19l1.1-9.8c.2-1.4 1-2.5 2.1-3.3l6.2-4.2v-8.2l-17 2.7v-2.7c0-2.1 1.3-4 3.2-4.8l13.8-5.6V7.6C28.5 5.6 30 4 32 4z";

type AdsbModuleProps = {
  hardware: HardwareStatus | null;
  location: ResolvedAppLocation | null;
  onRefreshHardware: () => Promise<void>;
};

function cx(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(" ");
}

function displayAircraftName(aircraft: AdsbAircraftContact): string {
  return aircraft.flight || aircraft.hex;
}

function buildAdsbContactList(snapshot: AdsbFeedSnapshot | null): AdsbAircraftContact[] {
  if (!snapshot) {
    return [];
  }

  const ordered: AdsbAircraftContact[] = [];
  const seen = new Set<string>();

  for (const aircraft of snapshot.aircraft) {
    if (seen.has(aircraft.hex)) {
      continue;
    }
    seen.add(aircraft.hex);
    ordered.push(aircraft);
  }

  for (const aircraft of snapshot.recentAircraft ?? []) {
    if (seen.has(aircraft.hex)) {
      continue;
    }
    seen.add(aircraft.hex);
    ordered.push(aircraft);
  }

  return ordered;
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

function runtimeDotColor(state: AdsbRuntimeState | null): string {
  switch (state) {
    case "running": return "bg-emerald-400";
    case "starting": return "bg-amber-400";
    case "error": return "bg-rose-400";
    default: return "bg-white/25";
  }
}

function runtimeTextColor(state: AdsbRuntimeState | null): string {
  switch (state) {
    case "running": return "text-emerald-300";
    case "starting": return "text-amber-300";
    case "error": return "text-rose-300";
    default: return "text-[var(--muted-strong)]";
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
    ? "rgba(251, 113, 133, 0.3)"
    : aircraft.onGround
      ? "rgba(87, 215, 255, 0.16)"
      : "rgba(61, 217, 184, 0.16)";

  return leaflet.divIcon({
    className: "adsb-aircraft-icon-shell",
    html: `
      <span class="adsb-aircraft-icon ${isSelected ? "is-selected" : ""}" style="--adsb-heading:${heading}deg; --adsb-color:${color}; --adsb-halo:${halo};">
        <span class="adsb-aircraft-icon__halo"></span>
        <span class="adsb-aircraft-icon__frame">
          <svg class="adsb-aircraft-icon__plane" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
            <path d="${AIRCRAFT_ICON_PATH}"></path>
          </svg>
        </span>
      </span>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

export function AdsbModule({ hardware, location, onRefreshHardware }: AdsbModuleProps) {
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
  const [selectedHex, setSelectedHex] = useState("");
  const [followSelected, setFollowSelected] = useState(false);
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
  const mapsMinZoom = snapshot?.maps.minZoom ?? null;
  const mapsMaxZoom = snapshot?.maps.maxZoom ?? null;
  const selectedCountryLayer = snapshot?.maps.layers.find(
    (layer) => layer.role === "country" && layer.countryId === savedCountryId,
  ) ?? null;
  const selectedCountryBounds = selectedCountryLayer?.bounds ?? null;
  const contactList = buildAdsbContactList(snapshot);
  const liveHexSet = useMemo(
    () => new Set((snapshot?.aircraft ?? []).map((aircraft) => aircraft.hex)),
    [snapshot?.aircraft],
  );

  const focusAircraft = useCallback((aircraft: AdsbAircraftContact, reason: "select" | "follow" = "select"): void => {
    const map = mapRef.current;
    if (!map || aircraft.latitude === null || aircraft.longitude === null) {
      return;
    }

    userViewportLockedRef.current = true;
    if (reason === "follow" && map.getZoom() >= 10.5) {
      const targetPoint = map.latLngToContainerPoint([aircraft.latitude, aircraft.longitude]);
      const mapSize = map.getSize();
      const dx = targetPoint.x - mapSize.x / 2;
      const dy = targetPoint.y - mapSize.y / 2;
      if (Math.hypot(dx, dy) < 28) {
        return;
      }
      map.panTo([aircraft.latitude, aircraft.longitude], {
        animate: true,
        duration: 0.7,
      });
      return;
    }

    if (reason === "follow") {
      map.panTo([aircraft.latitude, aircraft.longitude], {
        animate: true,
        duration: 0.7,
      });
      return;
    }

    map.flyTo([aircraft.latitude, aircraft.longitude], Math.max(map.getZoom(), 10.5), {
      animate: true,
      duration: 0.85,
    });
  }, []);

  const selectAircraft = useCallback((hex: string, aircraft?: AdsbAircraftContact): void => {
    setSelectedHex(hex);
    const nextAircraft = aircraft ?? contactList.find((entry) => entry.hex === hex);
    if (nextAircraft) {
      const nextCanFollow =
        liveHexSet.has(nextAircraft.hex) &&
        nextAircraft.latitude !== null &&
        nextAircraft.longitude !== null;
      setFollowSelected(true);
      if (nextCanFollow) {
        focusAircraft(nextAircraft, "follow");
      }
    }
  }, [contactList, focusAircraft, liveHexSet]);

  function clearSelectedAircraft(): void {
    setFollowSelected(false);
    setSelectedHex("");
  }

  useEffect(() => {
    if (contactList.length === 0) {
      setFollowSelected(false);
      setSelectedHex("");
      return;
    }

    if (selectedHex && !contactList.some((aircraft) => aircraft.hex === selectedHex)) {
      setFollowSelected(false);
      setSelectedHex("");
    }
  }, [contactList, selectedHex]);

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

  const selected = selectedHex
    ? contactList.find((aircraft) => aircraft.hex === selectedHex) ?? null
    : null;
  const selectedIsLive = selected ? liveHexSet.has(selected.hex) : false;
  const canFollowSelected =
    !!selected &&
    selectedIsLive &&
    selected.latitude !== null &&
    selected.longitude !== null;
  const followIsArmed = !!selected && followSelected;
  const followIsActive = followIsArmed && canFollowSelected;

  useEffect(() => {
    if (!selected) {
      setFollowSelected(false);
    }
  }, [selected]);

  useEffect(() => {
    if (!selected || !followSelected || !canFollowSelected) {
      return;
    }
    focusAircraft(selected, "follow");
  }, [canFollowSelected, followSelected, focusAircraft, selected]);

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    const markerLayer = markerLayerRef.current;
    if (!leaflet || !map || !markerLayer || !snapshot) {
      return;
    }

    syncLeafletMarkers({
      entries: snapshot.aircraft.filter(
        (aircraft) => aircraft.latitude !== null && aircraft.longitude !== null,
      ),
      getId: (aircraft) => aircraft.hex,
      getLatitude: (aircraft) => aircraft.latitude!,
      getLongitude: (aircraft) => aircraft.longitude!,
      getIconSignature: (aircraft) =>
        [
          aircraft.hex === selected?.hex ? "selected" : "idle",
          aircraft.emergency ? "emergency" : "normal",
          aircraft.onGround ? "ground" : "airborne",
          aircraft.trackDeg ?? "none",
        ].join("|"),
      getTooltipText: (aircraft) => `${displayAircraftName(aircraft)} \u00b7 ${formatAltitude(aircraft.altitudeFeet)}`,
      buildIcon: (aircraft) => buildMarkerIcon(leaflet, aircraft, aircraft.hex === selected?.hex),
      leaflet,
      layerGroup: markerLayer,
      recordsRef: markerRecordsRef,
      onSelect: (hex) => selectAircraft(hex),
      tooltipOptions: {
        className: "ais-tooltip",
        direction: "top",
        offset: [0, -14],
        opacity: 1,
      },
    });

    const receiver = snapshot.receiver;
    const receiverBounds =
      receiver && receiver.latitude !== null && receiver.longitude !== null
        ? buildPointBounds(receiver.latitude, receiver.longitude)
        : null;
    const boundsToFit = snapshot.bounds ?? (
      savedCityResolved && !savedCityView
        ? receiverBounds ?? selectedCountryBounds ?? snapshot.maps.bounds
        : null
    );

    if (!didFitBoundsRef.current && boundsToFit) {
      suppressViewportEventRef.current = true;
      if (isPointBounds(boundsToFit)) {
        map.setView(
          [boundsToFit.south, boundsToFit.west],
          Math.min(snapshot.maps.maxZoom, 11),
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
  }, [focusAircraft, savedCityResolved, savedCityView, selectAircraft, selected, selectedCountryBounds, snapshot]);

  const runtimeState = snapshot?.runtime.state ?? null;
  const runtimeRunning = runtimeState === "running";
  const runtimeStarting = runtimeState === "starting";
  const positionedAircraft = snapshot?.aircraft.filter(
    (entry) => entry.latitude !== null && entry.longitude !== null,
  ) ?? [];

  return (
    <div className="flex flex-1 overflow-hidden">
      <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-white/8 bg-black/10">
        {/* Title + live status */}
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--foreground)]">ADS-B</span>
            <span className="font-mono text-[10px] text-[var(--muted)]">1090 MHz</span>
          </div>
          <span className={cx("inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em]", runtimeTextColor(runtimeState))}>
            <span className={cx("h-1.5 w-1.5 rounded-full", runtimeDotColor(runtimeState))} />
            {runtimeLabel(runtimeState)}
          </span>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 border-b border-white/[0.07]">
          <div className="border-r border-white/[0.07] px-3.5 py-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--muted)]">Aircraft</p>
            <p className="mt-1.5 font-mono text-[22px] font-semibold tabular-nums leading-none text-[var(--foreground)]">
              {snapshot?.aircraftCount ?? 0}
            </p>
          </div>
          <div className="border-r border-white/[0.07] px-3.5 py-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--muted)]">Positioned</p>
            <p className="mt-1.5 font-mono text-[22px] font-semibold tabular-nums leading-none text-[var(--foreground)]">
              {snapshot?.positionCount ?? 0}
            </p>
          </div>
          <div className="px-3.5 py-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--muted)]">Airborne</p>
            <p className="mt-1.5 font-mono text-[22px] font-semibold tabular-nums leading-none text-[var(--foreground)]">
              {snapshot?.airborneCount ?? 0}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Decoder */}
          <div className="border-b border-white/[0.07] px-4 py-3">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Decoder</p>
            <p className="text-xs leading-5 text-[var(--muted-strong)]">
              {snapshot?.runtime.message ?? "ADS-B decoder state not loaded yet."}
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
              <span className="text-[var(--muted-strong)]">{formatFrequencyMHz(snapshot?.runtime.centerFreqHz ?? 1_090_000_000)}</span>
              <span className="text-[var(--muted)]">IQ rate</span>
              <span className="text-[var(--muted-strong)]">{(snapshot?.runtime.sampleRate ?? 2_400_000).toLocaleString("en")} sps</span>
              <span className="text-[var(--muted)]">Started</span>
              <span className="text-[var(--muted-strong)]">{formatTimestamp(snapshot?.runtime.startedAt ?? null)}</span>
              <span className="text-[var(--muted)]">Last JSON</span>
              <span className="text-[var(--muted-strong)]">{formatTimestamp(snapshot?.runtime.lastJsonAt ?? null)}</span>
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
            {snapshot?.receiver ? (
              <div className="mt-2.5 grid grid-cols-[4.5rem_1fr] gap-y-1.5 font-mono text-[10px]">
                <span className="text-[var(--muted)]">dump1090</span>
                <span className="text-[var(--muted-strong)]">{snapshot.receiver.version || "\u2014"}</span>
                <span className="text-[var(--muted)]">Refresh</span>
                <span className="text-[var(--muted-strong)]">{snapshot.receiver.refreshMs ?? "\u2014"} ms</span>
                <span className="text-[var(--muted)]">Coords</span>
                <span className="text-[var(--muted-strong)]">{formatCoordinates(snapshot.receiver.latitude, snapshot.receiver.longitude)}</span>
              </div>
            ) : null}
          </div>

          {/* Decoder stats */}
          {snapshot?.stats ? (
            <div className="border-b border-white/[0.07] px-4 py-3">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Stats</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[10px]">
                <div><span className="text-[var(--muted)]">Msgs </span><span className="text-[var(--muted-strong)]">{snapshot.stats.messages.toLocaleString("en")}</span></div>
                <div><span className="text-[var(--muted)]">Strong </span><span className="text-[var(--muted-strong)]">{snapshot.stats.strongSignals.toLocaleString("en")}</span></div>
                <div><span className="text-[var(--muted)]">Signal </span><span className="text-[var(--muted-strong)]">{snapshot.stats.signalDbfs?.toFixed(1) ?? "\u2014"} dBFS</span></div>
                <div><span className="text-[var(--muted)]">Noise </span><span className="text-[var(--muted-strong)]">{snapshot.stats.noiseDbfs?.toFixed(1) ?? "\u2014"} dBFS</span></div>
                <div><span className="text-[var(--muted)]">Peak </span><span className="text-[var(--muted-strong)]">{snapshot.stats.peakSignalDbfs?.toFixed(1) ?? "\u2014"} dBFS</span></div>
                <div><span className="text-[var(--muted)]">Gain </span><span className="text-[var(--muted-strong)]">{snapshot.stats.gainDb?.toFixed(1) ?? "\u2014"} dB</span></div>
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
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--foreground)]">Air Picture</span>
            <p className="mt-0.5 font-mono text-[10px] text-[var(--muted)]">
              last contact {formatTimestamp(snapshot?.latestMessageAt ?? null)}
            </p>
          </div>
          <span className="font-mono text-[10px] text-[var(--muted)]">
            {runtimeRunning
              ? "live dump1090-fa decoder"
              : runtimeStarting
                ? "starting decoder"
                : snapshot?.maps.available
                  ? snapshot.maps.kind === "pmtiles"
                    ? "offline dark basemap"
                    : "offline raster layers"
                  : "live OpenStreetMap"}
          </span>
        </div>

        <div className="relative isolate flex-1 overflow-hidden">
          <div
            className={cx(
              "ais-map h-full w-full",
              snapshot?.maps.kind === "pmtiles" && "ais-map--blue-dark",
            )}
            ref={mapHostRef}
          />

          {selected ? (
            <MapOverlayCard
              badge={(
                <span className={cx(
                  "mt-0.5 shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em]",
                  !selectedIsLive
                    ? "bg-white/[0.05] text-[var(--muted-strong)]"
                    : selected.emergency
                      ? "bg-rose-400/15 text-rose-300"
                      : selected.onGround
                        ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                        : "bg-[var(--highlight)]/10 text-[var(--highlight)]",
                )}>
                  {!selectedIsLive
                    ? "History"
                    : selected.emergency || (selected.onGround ? "Ground" : "Airborne")}
                </span>
              )}
              eyebrow="Selected Aircraft"
              position="top-left"
              footer={(
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] leading-5 text-[var(--muted)]">
                    {followIsActive
                      ? "Map follow is active for this aircraft."
                      : followIsArmed
                        ? "Follow is armed. Tracking will start when this aircraft returns to the live map."
                        : canFollowSelected
                        ? "Pinned to the map overlay. Toggle follow to keep it centered."
                        : "Historical contact pinned from the archive list."}
                  </p>
                  <button
                    className={cx(
                      "inline-flex shrink-0 items-center gap-5 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition",
                      followIsArmed
                        ? "border-emerald-300/45 bg-emerald-300/14 text-emerald-50 shadow-[0_0_0_1px_rgba(110,231,183,0.22)] hover:border-emerald-300/65"
                        : followIsActive
                          ? "border-emerald-300/45 bg-emerald-300/14 text-emerald-50 shadow-[0_0_0_1px_rgba(110,231,183,0.22)] hover:border-emerald-300/65"
                          : "border-white/10 bg-white/[0.04] text-[var(--muted-strong)] hover:border-white/20 hover:bg-white/[0.08] hover:text-[var(--foreground)]",
                    )}
                    onClick={() => {
                      setFollowSelected((current) => {
                        const next = !current;
                        if (next && canFollowSelected) {
                          focusAircraft(selected, "follow");
                        }
                        return next;
                      });
                    }}
                    type="button"
                  >
                    <span>{followIsActive ? "Following" : followIsArmed ? "Waiting live" : "Follow"}</span>
                    <span className={cx(
                      "inline-flex h-4 w-4 shrink-0 items-center justify-center self-center rounded-full border text-[9px] leading-none",
                      followIsArmed
                        ? "border-emerald-200/70 bg-emerald-200/22 text-emerald-50"
                        : "",
                      followIsActive
                        ? "border-emerald-200/70 bg-emerald-200/22 text-emerald-50"
                        : "border-white/20 text-white/35",
                    )}>
                      {followIsArmed ? "✓" : ""}
                    </span>
                  </button>
                </div>
              )}
              onClose={clearSelectedAircraft}
              title={displayAircraftName(selected)}
              subtitle={`HEX ${selected.hex}${selected.squawk ? ` · SQ ${selected.squawk}` : ""}${selected.type ? ` · ${selected.type}` : ""}`}
            >
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "ALT", value: formatAltitude(selected.altitudeFeet) },
                  { label: "SPD", value: formatSpeed(selected.groundSpeedKnots) },
                  { label: "TRK", value: formatTrack(selected.trackDeg) },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2">
                    <p className="font-mono text-[8px] uppercase tracking-[0.16em] text-[var(--muted)]">{stat.label}</p>
                    <p className="mt-1 font-mono text-[12px] font-medium tabular-nums text-[var(--foreground)]">{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-3 grid grid-cols-[5.25rem_1fr] gap-y-2 font-mono text-[10px]">
                <span className="text-[var(--muted)]">Source</span>
                <span className="text-[var(--muted-strong)]">{selected.sourceLabel || "—"}</span>
                <span className="text-[var(--muted)]">Category</span>
                <span className="text-[var(--muted-strong)]">{selected.category || "—"}</span>
                <span className="text-[var(--muted)]">V/S</span>
                <span className="text-[var(--muted-strong)]">{selected.verticalRateFpm === null ? "—" : `${Math.round(selected.verticalRateFpm).toLocaleString("en")} fpm`}</span>
                <span className="text-[var(--muted)]">RSSI</span>
                <span className="text-[var(--muted-strong)]">{selected.rssi === null ? "—" : `${selected.rssi.toFixed(1)} dBFS`}</span>
                <span className="text-[var(--muted)]">Position</span>
                <span className="text-[var(--muted-strong)]">{formatCoordinates(selected.latitude, selected.longitude)}</span>
                <span className="text-[var(--muted)]">Last seen</span>
                <span className="text-[var(--muted-strong)]">{formatTimestamp(selected.seenAt)}</span>
                <span className="text-[var(--muted)]">Last pos</span>
                <span className="text-[var(--muted-strong)]">{formatTimestamp(selected.seenPosAt)}</span>
              </div>
            </MapOverlayCard>
          ) : null}

          <div className="pointer-events-none absolute bottom-3 left-3 z-[1200] max-w-xs rounded border border-white/[0.07] bg-[rgba(4,8,15,0.72)] px-2.5 py-1.5 backdrop-blur-sm">
            <p className="font-mono text-[9px] leading-4 text-[var(--muted)]">
              {snapshot?.maps.attribution ?? "© OpenStreetMap contributors"}
            </p>
          </div>

          {loading && !snapshot ? (
            <div className="pointer-events-none absolute inset-0 z-[1200] flex items-center justify-center bg-black/25 backdrop-blur-[2px]">
              <div className="rounded-lg border border-white/10 bg-[rgba(6,11,20,0.88)] px-4 py-3 text-sm text-[var(--muted-strong)]">
                Starting ADS-B decoder...
              </div>
            </div>
          ) : null}

          {!loading && snapshot && positionedAircraft.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 z-[1200] flex items-end justify-center pb-20">
              <div className="flex flex-col items-center gap-3 rounded border border-white/[0.07] bg-[rgba(4,8,15,0.72)] px-6 py-4 text-center backdrop-blur-sm">
                <div className="h-px w-8 bg-[var(--accent)]/20" />
                <p className="font-mono text-[9px] uppercase tracking-[0.32em] text-[var(--accent)]/60">
                  No Positions
                </p>
                <p className="max-w-[22rem] text-[11px] leading-6 text-[var(--muted)]">
                  {runtimeState === "error"
                    ? snapshot.runtime.message
                    : runtimeRunning
                      ? "Decoder is live — no aircraft positions decoded yet."
                      : runtimeStarting
                        ? "Decoder starting\u2026"
                        : contactList.length > 0
                          ? "No live positions right now. Historical contacts remain available in the sidebar."
                          : "Start Scanning to populate the air picture with live HackRF data."}
                </p>
                <div className="h-px w-8 bg-[var(--accent)]/20" />
              </div>
            </div>
          ) : null}
        </div>
      </main>

      <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-white/8 bg-black/15">
        <div className="border-b border-white/[0.07] px-5 py-3">
          {selected ? (
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Pinned on map</p>
              <p className="mt-1 truncate text-sm font-medium text-[var(--foreground)]">{displayAircraftName(selected)}</p>
            </div>
          ) : (
            <p className="text-xs leading-5 text-[var(--muted)]">Select an aircraft from the map or list to inspect it in the overlay.</p>
          )}
        </div>

        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Contacts</span>
          <span className="font-mono text-[10px] text-[var(--muted)]">{contactList.length}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {contactList.map((aircraft) => {
            const active = aircraft.hex === selected?.hex;
            const isLive = liveHexSet.has(aircraft.hex);
            return (
              <button
                key={aircraft.hex}
                className={cx(
                  "flex w-full items-start gap-3 border-b border-white/[0.05] px-5 py-3 text-left transition",
                  active ? "bg-[var(--accent)]/8 border-l-accent" : "hover:bg-white/[0.025] border-l-clear",
                )}
                onClick={() => {
                  selectAircraft(aircraft.hex, aircraft);
                }}
                type="button"
              >
                <span className={cx(
                  "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                  !isLive ? "bg-white/25"
                  : aircraft.emergency ? "bg-rose-400"
                  : aircraft.onGround ? "bg-[var(--accent)]"
                  : "bg-[var(--highlight)]",
                )} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs font-medium text-[var(--foreground)]">
                    {displayAircraftName(aircraft)}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-[var(--muted)]">
                    {aircraft.hex}{aircraft.squawk ? ` \u00b7 SQ\u00a0${aircraft.squawk}` : ""}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-[var(--muted)]">
                    {isLive ? "Live contact" : `History only · ${formatTimestamp(aircraft.seenAt)}`}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-[10px] text-[var(--muted-strong)]">
                    {formatAltitude(aircraft.altitudeFeet)}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-[var(--muted)]">
                    {formatSpeed(aircraft.groundSpeedKnots)}
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
