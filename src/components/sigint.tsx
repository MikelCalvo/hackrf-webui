"use client";

import type { Layer, LayerGroup, Map as LeafletMap } from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  fetchSigintCaptureDetail,
  fetchSigintCaptures,
  fetchSigintTrackHistory,
  fetchSigintTrackSummaries,
  updateSigintCaptureReview,
  type SigintCaptureDetail,
  type SigintCaptureListFilters,
  type SigintCaptureSummary,
  type SigintCaptureTab,
  type SigintReviewPriority,
  type SigintReviewStatus,
  type SigintTrackSummary,
} from "@/lib/sigint";
import type {
  AdsbTrackHistoryResponse,
  AisTrackHistoryResponse,
  OfflineMapSummary,
  ResolvedAppLocation,
} from "@/lib/types";
import {
  CLS_BTN_GHOST,
  CLS_BTN_PRIMARY,
  CLS_INPUT,
  Spinner,
  cx,
} from "@/components/module-ui";
import {
  buildBasemapSources,
  syncLeafletBasemap,
} from "@/components/live-map";

const EMPTY_TILE_DATA_URL =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const DEFAULT_CENTER: [number, number] = [20, 0];
const DEFAULT_ZOOM = 2;
const DEFAULT_CAPTURE_FILTERS: SigintCaptureListFilters = {
  module: "all",
  reviewStatus: "all",
  hasAudio: false,
  hasRawIq: false,
  q: "",
  limit: 200,
};

type SigintModuleProps = {
  location: ResolvedAppLocation | null;
};

type ReplayPoint = {
  latitude: number;
  longitude: number;
  observedAt: string;
  primaryLabel: string;
  secondaryLabel: string;
};

type MapsPayload = {
  maps: OfflineMapSummary;
  warnings: string[];
};

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "—";
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

function formatDuration(durationMs: number | null): string {
  if (durationMs === null || durationMs < 0) {
    return "—";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 1 : 2)} s`;
}

function formatFrequency(freqMhz: number | null): string {
  return freqMhz === null ? "—" : `${freqMhz.toFixed(freqMhz < 200 ? 3 : 5)} MHz`;
}

function formatCoordinatePair(latitude: number | null, longitude: number | null): string {
  if (latitude === null || longitude === null) {
    return "—";
  }
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

function statusTone(status: SigintReviewStatus): string {
  switch (status) {
    case "kept":
      return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
    case "discarded":
      return "border-rose-300/30 bg-rose-300/10 text-rose-100";
    case "flagged":
      return "border-amber-300/30 bg-amber-300/10 text-amber-100";
    default:
      return "border-cyan-300/30 bg-cyan-300/10 text-cyan-100";
  }
}

function moduleTone(moduleId: SigintCaptureSummary["module"]): string {
  switch (moduleId) {
    case "pmr":
      return "text-sky-200";
    case "airband":
      return "text-emerald-200";
    case "maritime":
      return "text-amber-200";
    default:
      return "text-[var(--muted-strong)]";
  }
}

function compactModuleLabel(moduleId: SigintCaptureSummary["module"]): string {
  switch (moduleId) {
    case "pmr":
      return "PMR";
    case "airband":
      return "AIR";
    case "maritime":
      return "SEA";
  }
}

async function fetchMaps(): Promise<MapsPayload> {
  const response = await fetch("/api/location/maps", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as MapsPayload;
}

function buildReplayPoints(
  tab: SigintCaptureTab,
  history: AdsbTrackHistoryResponse | AisTrackHistoryResponse | null,
): ReplayPoint[] {
  if (!history) {
    return [];
  }

  if (tab === "adsb") {
    const adsb = history as AdsbTrackHistoryResponse;
    return adsb.points.map((point) => ({
      latitude: point.latitude,
      longitude: point.longitude,
      observedAt: point.seenPosAt ?? point.seenAt,
      primaryLabel: point.flight || point.hex,
      secondaryLabel: [point.type || null, point.hex].filter(Boolean).join(" · "),
    }));
  }

  const ais = history as AisTrackHistoryResponse;
  return ais.points.map((point) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    observedAt: point.lastPositionAt,
    primaryLabel: point.name || point.callsign || point.mmsi,
    secondaryLabel: [point.shipType || null, point.mmsi].filter(Boolean).join(" · "),
  }));
}

function RouteReplayMap({
  maps,
  savedCountryId,
  trackKey,
  points,
  activeIndex,
}: {
  maps: OfflineMapSummary | null;
  savedCountryId: string | null;
  trackKey: string;
  points: ReplayPoint[];
  activeIndex: number;
}) {
  const mapHostRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const routeLayerRef = useRef<LayerGroup | null>(null);
  const basemapLayerRef = useRef<Layer[]>([]);
  const lastTrackKeyRef = useRef("");
  const basemapSignatureRef = useRef("");
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    let active = true;

    const setup = async () => {
      if (!mapHostRef.current || mapRef.current) {
        return;
      }

      const leaflet = await import("leaflet");
      if (!active || !mapHostRef.current) {
        return;
      }

      leafletRef.current = leaflet;
      const map = leaflet.map(mapHostRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: true,
        preferCanvas: true,
        attributionControl: false,
      });
      leaflet.tileLayer(EMPTY_TILE_DATA_URL, { attribution: "" }).addTo(map);
      routeLayerRef.current = leaflet.layerGroup().addTo(map);
      mapRef.current = map;
      setMapReady(true);
    };

    void setup();

    return () => {
      active = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      routeLayerRef.current = null;
      leafletRef.current = null;
      basemapLayerRef.current = [];
      basemapSignatureRef.current = "";
      lastTrackKeyRef.current = "";
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    if (!mapReady) {
      return;
    }

    const map = mapRef.current;
    if (!map) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      map.invalidateSize(false);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [mapReady, trackKey]);

  useEffect(() => {
    const map = mapRef.current;
    const leaflet = leafletRef.current;
    if (!map || !leaflet || !mapReady) {
      return;
    }

    let cancelled = false;
    const sync = async () => {
      const sources = buildBasemapSources(maps, savedCountryId);
      if (!cancelled) {
        await syncLeafletBasemap({
          cancelled: () => cancelled,
          emptyTileDataUrl: EMPTY_TILE_DATA_URL,
          errorMessage: "Could not load the SIGINT replay basemap.",
          leaflet,
          map,
          onError: () => undefined,
          layerRef: basemapLayerRef,
          signatureRef: basemapSignatureRef,
          sources,
        });
      }
    };

    void sync();
    return () => {
      cancelled = true;
    };
  }, [mapReady, maps, savedCountryId]);

  useEffect(() => {
    const map = mapRef.current;
    const leaflet = leafletRef.current;
    const routeLayer = routeLayerRef.current;
    if (!map || !leaflet || !routeLayer || !mapReady) {
      return;
    }

    routeLayer.clearLayers();
    if (points.length === 0) {
      return;
    }

    const latLngs = points.map((point) => [point.latitude, point.longitude] as [number, number]);
    const polyline = leaflet.polyline(latLngs, {
      color: "rgba(87, 215, 255, 0.86)",
      weight: 3,
      opacity: 0.92,
    });
    routeLayer.addLayer(polyline);

    const safeIndex = Math.max(0, Math.min(activeIndex, points.length - 1));
    const activePoint = points[safeIndex];
    const marker = leaflet.circleMarker([activePoint.latitude, activePoint.longitude], {
      radius: 7,
      weight: 2,
      color: "#57d7ff",
      fillColor: "#0a1526",
      fillOpacity: 1,
    });
    routeLayer.addLayer(marker);

    if (lastTrackKeyRef.current !== trackKey) {
      lastTrackKeyRef.current = trackKey;
      if (points.length === 1) {
        map.setView([activePoint.latitude, activePoint.longitude], 7, { animate: false });
      } else {
        map.fitBounds(polyline.getBounds().pad(0.42), { animate: false });
      }
    }
  }, [activeIndex, mapReady, points, trackKey]);

  return <div className="h-full w-full" ref={mapHostRef} />;
}

export function SigintModule({ location }: SigintModuleProps) {
  const [tab, setTab] = useState<SigintCaptureTab>("captures");
  const [filters, setFilters] = useState<SigintCaptureListFilters>(DEFAULT_CAPTURE_FILTERS);
  const [captureItems, setCaptureItems] = useState<SigintCaptureSummary[]>([]);
  const [captureCounts, setCaptureCounts] = useState({
    total: 0,
    pending: 0,
    kept: 0,
    discarded: 0,
    flagged: 0,
    withAudio: 0,
    withRawIq: 0,
  });
  const [capturesLoading, setCapturesLoading] = useState(true);
  const [capturesError, setCapturesError] = useState("");
  const [selectedCaptureId, setSelectedCaptureId] = useState("");
  const [captureDetail, setCaptureDetail] = useState<SigintCaptureDetail | null>(null);
  const [captureDetailLoading, setCaptureDetailLoading] = useState(false);
  const [captureDetailError, setCaptureDetailError] = useState("");
  const [reviewStatus, setReviewStatus] = useState<SigintReviewStatus>("pending");
  const [reviewPriority, setReviewPriority] = useState<SigintReviewPriority>("normal");
  const [reviewNotes, setReviewNotes] = useState("");
  const [savingReview, setSavingReview] = useState(false);

  const [maps, setMaps] = useState<OfflineMapSummary | null>(null);
  const [mapsError, setMapsError] = useState("");
  const [trackItems, setTrackItems] = useState<SigintTrackSummary[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [tracksError, setTracksError] = useState("");
  const [selectedTrackKey, setSelectedTrackKey] = useState("");
  const [trackHistory, setTrackHistory] = useState<AdsbTrackHistoryResponse | AisTrackHistoryResponse | null>(null);
  const [trackHistoryLoading, setTrackHistoryLoading] = useState(false);
  const [trackHistoryError, setTrackHistoryError] = useState("");
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);

  const trackKind = tab === "ais" ? "ais" : "adsb";
  const activeTrack = useMemo(
    () => trackItems.find((item) => item.key === selectedTrackKey) ?? null,
    [selectedTrackKey, trackItems],
  );
  const replayPoints = useMemo(() => buildReplayPoints(tab, trackHistory), [tab, trackHistory]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setCapturesLoading(true);
      try {
        const payload = await fetchSigintCaptures(filters);
        if (cancelled) {
          return;
        }
        setCaptureItems(payload.items);
        setCaptureCounts(payload.counts);
        setCapturesError("");
      } catch (error) {
        if (!cancelled) {
          setCapturesError(error instanceof Error ? error.message : "Could not load capture queue.");
        }
      } finally {
        if (!cancelled) {
          setCapturesLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [filters]);

  useEffect(() => {
    if (!captureItems.some((item) => item.id === selectedCaptureId)) {
      setSelectedCaptureId(captureItems[0]?.id ?? "");
    }
  }, [captureItems, selectedCaptureId]);

  useEffect(() => {
    if (!selectedCaptureId) {
      setCaptureDetail(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setCaptureDetailLoading(true);
      try {
        const detail = await fetchSigintCaptureDetail(selectedCaptureId);
        if (cancelled) {
          return;
        }
        setCaptureDetail(detail);
        setCaptureDetailError("");
      } catch (error) {
        if (!cancelled) {
          setCaptureDetailError(error instanceof Error ? error.message : "Could not load capture detail.");
        }
      } finally {
        if (!cancelled) {
          setCaptureDetailLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedCaptureId]);

  useEffect(() => {
    setReviewStatus(captureDetail?.reviewStatus ?? "pending");
    setReviewPriority(captureDetail?.reviewPriority ?? "normal");
    setReviewNotes(captureDetail?.reviewNotes ?? "");
  }, [captureDetail]);

  useEffect(() => {
    let cancelled = false;

    const loadMaps = async () => {
      try {
        const payload = await fetchMaps();
        if (!cancelled) {
          setMaps(payload.maps);
          setMapsError("");
        }
      } catch (error) {
        if (!cancelled) {
          setMapsError(error instanceof Error ? error.message : "Could not load map basemap.");
        }
      }
    };

    void loadMaps();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (tab === "captures") {
      return;
    }

    let cancelled = false;
    const loadTracks = async () => {
      setTracksLoading(true);
      try {
        const payload = await fetchSigintTrackSummaries(trackKind, 160);
        if (cancelled) {
          return;
        }
        setTrackItems(payload.items);
        setTracksError("");
      } catch (error) {
        if (!cancelled) {
          setTracksError(error instanceof Error ? error.message : "Could not load route targets.");
        }
      } finally {
        if (!cancelled) {
          setTracksLoading(false);
        }
      }
    };

    void loadTracks();
    return () => {
      cancelled = true;
    };
  }, [tab, trackKind]);

  useEffect(() => {
    if (tab === "captures") {
      return;
    }

    if (!trackItems.some((item) => item.key === selectedTrackKey)) {
      setSelectedTrackKey(trackItems[0]?.key ?? "");
    }
  }, [selectedTrackKey, tab, trackItems]);

  useEffect(() => {
    if (tab === "captures" || !selectedTrackKey) {
      setTrackHistory(null);
      return;
    }

    let cancelled = false;
    const loadHistory = async () => {
      setTrackHistoryLoading(true);
      try {
        const payload = await fetchSigintTrackHistory(trackKind, selectedTrackKey);
        if (cancelled) {
          return;
        }
        setTrackHistory(payload);
        setTrackHistoryError("");
      } catch (error) {
        if (!cancelled) {
          setTrackHistoryError(error instanceof Error ? error.message : "Could not load route history.");
        }
      } finally {
        if (!cancelled) {
          setTrackHistoryLoading(false);
        }
      }
    };

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [selectedTrackKey, tab, trackKind]);

  useEffect(() => {
    setReplayPlaying(false);
    setReplayIndex(replayPoints.length > 0 ? replayPoints.length - 1 : 0);
  }, [replayPoints]);

  useEffect(() => {
    if (!replayPlaying || replayPoints.length <= 1) {
      return;
    }

    const interval = window.setInterval(() => {
      setReplayIndex((current) => {
        if (current >= replayPoints.length - 1) {
          setReplayPlaying(false);
          return current;
        }

        return current + 1;
      });
    }, 240);

    return () => clearInterval(interval);
  }, [replayPlaying, replayPoints.length]);

  async function handleSaveReview(): Promise<void> {
    if (!captureDetail) {
      return;
    }

    setSavingReview(true);
    try {
      const nextDetail = await updateSigintCaptureReview(captureDetail.id, {
        status: reviewStatus,
        priority: reviewPriority,
        notes: reviewNotes,
      });
      setCaptureDetail(nextDetail);
      setCaptureItems((current) => {
        const nextItems = current.map((item) => (item.id === nextDetail.id ? nextDetail : item));
        setCaptureCounts({
          total: nextItems.length,
          pending: nextItems.filter((item) => item.reviewStatus === "pending").length,
          kept: nextItems.filter((item) => item.reviewStatus === "kept").length,
          discarded: nextItems.filter((item) => item.reviewStatus === "discarded").length,
          flagged: nextItems.filter((item) => item.reviewStatus === "flagged").length,
          withAudio: nextItems.filter((item) => item.audioCapture).length,
          withRawIq: nextItems.filter((item) => item.rawIqCapture).length,
        });
        return nextItems;
      });
    } catch (error) {
      setCaptureDetailError(error instanceof Error ? error.message : "Could not update the review.");
    } finally {
      setSavingReview(false);
    }
  }

  const activeReplayPoint =
    replayPoints.length > 0
      ? replayPoints[Math.max(0, Math.min(replayIndex, replayPoints.length - 1))]
      : null;

  const hasReviewChanges =
    captureDetail
    && (captureDetail.reviewStatus !== reviewStatus
      || captureDetail.reviewPriority !== reviewPriority
      || captureDetail.reviewNotes !== reviewNotes);

  return (
    <div className="flex flex-1 overflow-hidden">
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-white/8 bg-[rgba(4,8,16,0.76)]">
        <div className="border-b border-white/[0.07] px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-cyan-200">SIGINT</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--muted)]">Capture Intelligence</p>
          </div>
        </div>

        <div className="border-b border-white/[0.07] px-4 py-2.5">
          <div className="flex gap-1.5">
            {[
              { id: "captures", label: "Captures" },
              { id: "adsb", label: "ADS-B" },
              { id: "ais", label: "AIS" },
            ].map((item) => (
              <button
                key={item.id}
                className={cx(
                  "flex-1 whitespace-nowrap rounded border px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.1em] transition",
                  tab === item.id
                    ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100"
                    : "border-white/10 bg-white/[0.03] text-[var(--muted-strong)] hover:border-white/18 hover:bg-white/[0.05]",
                )}
                onClick={() => setTab(item.id as SigintCaptureTab)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {tab === "captures" ? (
          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 border-b border-white/[0.07]">
              <div className="border-r border-white/[0.07] px-4 py-2.5">
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">Pending</p>
                <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--foreground)]">{captureCounts.pending}</p>
              </div>
              <div className="px-4 py-2.5">
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">Flagged</p>
                <p className={cx("mt-1 font-mono text-xl font-semibold tabular-nums", captureCounts.flagged > 0 ? "text-amber-200" : "text-[var(--foreground)]")}>{captureCounts.flagged}</p>
              </div>
            </div>

            <div className="space-y-2 px-4 py-3">
              <input
                className={CLS_INPUT}
                placeholder="Search captures…"
                type="search"
                value={filters.q}
                onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
              />

              <select
                className={CLS_INPUT}
                value={filters.module}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    module: event.target.value as SigintCaptureListFilters["module"],
                  }))
                }
              >
                <option value="all">All modules</option>
                <option value="pmr">PMR</option>
                <option value="airband">Airband</option>
                <option value="maritime">Maritime</option>
              </select>

              <select
                className={CLS_INPUT}
                value={filters.reviewStatus}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    reviewStatus: event.target.value as SigintCaptureListFilters["reviewStatus"],
                  }))
                }
              >
                <option value="all">All review states</option>
                <option value="pending">Pending</option>
                <option value="kept">Kept</option>
                <option value="flagged">Flagged</option>
                <option value="discarded">Discarded</option>
              </select>

              <label className="flex cursor-pointer items-center gap-2.5 rounded border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-xs text-[var(--muted-strong)] transition hover:bg-white/[0.05]">
                <input
                  checked={filters.hasAudio}
                  type="checkbox"
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, hasAudio: event.target.checked }))
                  }
                />
                WAV only
              </label>

              <label className="flex cursor-pointer items-center gap-2.5 rounded border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-xs text-[var(--muted-strong)] transition hover:bg-white/[0.05]">
                <input
                  checked={filters.hasRawIq}
                  type="checkbox"
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, hasRawIq: event.target.checked }))
                  }
                />
                IQ only
              </label>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="border-b border-white/[0.07] px-4 py-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">Replay scope</p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
                {tab === "adsb"
                  ? "Persisted aircraft tracks can be replayed from SQLite even after leaving the live ADS-B view."
                  : "Persisted vessel routes stay available for forensic review without reopening the live AIS module."}
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">Map context</p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
                {location?.catalogScope.countryName
                  ? `Using ${location.catalogScope.countryName} as the preferred offline basemap layer.`
                  : "Using the global basemap pack because no catalog country is selected."}
              </p>
              {mapsError ? (
                <p className="mt-2 text-xs text-amber-200">{mapsError}</p>
              ) : null}
            </div>
          </div>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 border-r border-white/8 bg-black/10">
        {tab === "captures" ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">Queue</p>
                <h3 className="mt-1 text-lg font-semibold text-[var(--foreground)]">
                  {captureCounts.total.toLocaleString("en")} filtered captures
                </h3>
              </div>
              {capturesLoading ? <Spinner /> : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {capturesError ? (
                <div className="p-5 text-sm text-rose-200">{capturesError}</div>
              ) : captureItems.length === 0 && !capturesLoading ? (
                <div className="p-5 text-sm text-[var(--muted)]">No captures match the current filters.</div>
              ) : (
                captureItems.map((item) => {
                  const isActive = item.id === selectedCaptureId;
                  return (
                    <button
                      key={item.id}
                      className={cx(
                        "flex w-full flex-col gap-3 border-b border-white/[0.05] px-5 py-4 text-left transition",
                        isActive ? "bg-[var(--accent)]/10" : "hover:bg-white/[0.03]",
                      )}
                      onClick={() => setSelectedCaptureId(item.id)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cx("font-mono text-[10px] uppercase tracking-[0.2em]", moduleTone(item.module))}>
                              {compactModuleLabel(item.module)}
                            </span>
                            <span className={cx("rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em]", statusTone(item.reviewStatus))}>
                              {item.reviewStatus}
                            </span>
                          </div>
                          <p className="mt-2 truncate text-lg font-semibold text-[var(--foreground)]">{item.label}</p>
                          <p className="mt-1 text-sm text-[var(--muted)]">
                            {formatFrequency(item.freqMhz)} · {item.locationLabel}
                          </p>
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="font-mono text-[11px] text-[var(--foreground)]">{formatTimestamp(item.startedAt)}</p>
                          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
                            {formatDuration(item.durationMs)}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {item.audioCapture ? (
                          <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-emerald-100">
                            WAV
                          </span>
                        ) : null}
                        {item.rawIqCapture ? (
                          <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-cyan-100">
                            IQ
                          </span>
                        ) : null}
                        {item.locationSource ? (
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted-strong)]">
                            {item.locationSource}
                          </span>
                        ) : null}
                        {item.reviewPriority === "high" ? (
                          <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-amber-100">
                            high priority
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">Replay targets</p>
                <h3 className="mt-1 text-lg font-semibold text-[var(--foreground)]">
                  {tab === "adsb" ? "Aircraft route archive" : "Vessel route archive"}
                </h3>
              </div>
              {tracksLoading ? <Spinner /> : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {tracksError ? (
                <div className="p-5 text-sm text-rose-200">{tracksError}</div>
              ) : trackItems.length === 0 && !tracksLoading ? (
                <div className="p-5 text-sm text-[var(--muted)]">No persisted route targets yet.</div>
              ) : (
                trackItems.map((item) => {
                  const isActive = item.key === selectedTrackKey;
                  return (
                    <button
                      key={item.key}
                      className={cx(
                        "flex w-full flex-col gap-2 border-b border-white/[0.05] px-5 py-4 text-left transition",
                        isActive ? "bg-[var(--accent)]/10" : "hover:bg-white/[0.03]",
                      )}
                      onClick={() => setSelectedTrackKey(item.key)}
                      type="button"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="truncate text-lg font-semibold text-[var(--foreground)]">{item.label}</p>
                          <p className="mt-1 truncate text-sm text-[var(--muted)]">{item.secondaryLabel}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-[11px] text-[var(--foreground)]">{item.pointCount.toLocaleString("en")}</p>
                          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">points</p>
                        </div>
                      </div>
                      <p className="font-mono text-[10px] text-[var(--muted)]">
                        {item.sourceLabel} · {formatTimestamp(item.lastSeenAt)}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </main>

      <aside className="flex w-[430px] shrink-0 flex-col bg-[rgba(6,12,20,0.78)]">
        {tab === "captures" ? (
          <>
            <div className="border-b border-white/[0.07] px-5 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">Evidence detail</p>
              {captureDetailLoading ? <p className="mt-3 text-sm text-[var(--muted)]">Loading capture...</p> : null}
              {captureDetailError ? <p className="mt-3 text-sm text-rose-200">{captureDetailError}</p> : null}
            </div>

            {captureDetail ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                {/* Header: module label, title, freq, status + capture buttons */}
                <div className="border-b border-white/[0.07] px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className={cx("font-mono text-[9px] uppercase tracking-[0.22em]", moduleTone(captureDetail.module))}>
                        {captureDetail.module}
                      </p>
                      <h3 className="mt-1 truncate text-xl font-semibold text-[var(--foreground)]">{captureDetail.label}</h3>
                      <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">
                        {formatFrequency(captureDetail.freqMhz)} · {captureDetail.locationLabel}
                      </p>
                    </div>
                    <span className={cx("shrink-0 rounded border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em]", statusTone(captureDetail.reviewStatus))}>
                      {captureDetail.reviewStatus}
                    </span>
                  </div>
                  {(captureDetail.audioCapture || captureDetail.rawIqCapture) ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {captureDetail.audioCapture ? (
                        <a className={CLS_BTN_PRIMARY} href={captureDetail.audioCapture.url} rel="noreferrer" target="_blank">
                          Open WAV
                        </a>
                      ) : null}
                      {captureDetail.rawIqCapture ? (
                        <a className={CLS_BTN_GHOST} href={captureDetail.rawIqCapture.url} rel="noreferrer" target="_blank">
                          Download IQ
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                  {captureDetail.audioCapture ? (
                    <audio className="mt-3 h-9 w-full" controls preload="metadata" src={captureDetail.audioCapture.url} />
                  ) : null}
                </div>

                {/* Signal metadata — flat 2-col data grid */}
                <div className="border-b border-white/[0.07]">
                  <div className="border-b border-white/[0.05] px-5 py-2.5">
                    <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--muted)]">Signal metadata</p>
                  </div>
                  <div className="grid grid-cols-2">
                    {([
                      ["Captured at", formatTimestamp(captureDetail.startedAt)],
                      ["Duration", formatDuration(captureDetail.durationMs)],
                      ["Demod", captureDetail.demodMode?.toUpperCase() ?? "—"],
                      ["Source", captureDetail.locationSourceDetail ?? captureDetail.locationSource ?? "—"],
                      ["Coordinates", formatCoordinatePair(captureDetail.resolvedLatitude, captureDetail.resolvedLongitude)],
                      ["Device", [captureDetail.deviceLabel, captureDetail.deviceSerial].filter(Boolean).join(" · ") || "—"],
                      ["RF gains", `LNA ${captureDetail.lna ?? "—"} · VGA ${captureDetail.vga ?? "—"}`],
                      ["Vol / squelch", `${captureDetail.audioGain?.toFixed(1) ?? "—"}× · ${captureDetail.squelch?.toFixed(4) ?? "—"}`],
                      ["Signal", `RMS ${captureDetail.rmsPeak?.toFixed(4) ?? "—"} · RF ${captureDetail.rfPeak?.toFixed(4) ?? "—"}`],
                      ["Reason", captureDetail.reason],
                    ] as [string, string][]).map(([label, value]) => (
                      <div key={label} className="border-b border-r border-white/[0.05] px-4 py-2.5 last:border-r-0">
                        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">{label}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-[var(--foreground)]">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Review */}
                <div className="border-b border-white/[0.07]">
                  <div className="flex items-center justify-between border-b border-white/[0.05] px-5 py-2.5">
                    <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--muted)]">Review</p>
                    {savingReview ? <Spinner /> : null}
                  </div>
                  <div className="space-y-3 px-5 py-3">
                    <div className="grid grid-cols-2 gap-2">
                      {(["pending", "kept", "flagged", "discarded"] as SigintReviewStatus[]).map((status) => (
                        <button
                          key={status}
                          className={cx(
                            "rounded border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] transition",
                            reviewStatus === status
                              ? statusTone(status)
                              : "border-white/10 bg-white/[0.03] text-[var(--muted-strong)] hover:border-white/18 hover:bg-white/[0.05]",
                          )}
                          onClick={() => setReviewStatus(status)}
                          type="button"
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      {(["normal", "high"] as SigintReviewPriority[]).map((priority) => (
                        <button
                          key={priority}
                          className={cx(
                            "rounded border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] transition",
                            reviewPriority === priority
                              ? "border-amber-300/25 bg-amber-300/10 text-amber-100"
                              : "border-white/10 bg-white/[0.03] text-[var(--muted-strong)] hover:border-white/18 hover:bg-white/[0.05]",
                          )}
                          onClick={() => setReviewPriority(priority)}
                          type="button"
                        >
                          {priority}
                        </button>
                      ))}
                    </div>
                    <label className="block">
                      <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">
                        Analyst notes
                      </span>
                      <textarea
                        className={cx(CLS_INPUT, "min-h-24 resize-y")}
                        placeholder="Keep/discard rationale, callouts, routing notes..."
                        value={reviewNotes}
                        onChange={(event) => setReviewNotes(event.target.value)}
                      />
                    </label>
                    <div className="flex justify-end">
                      <button
                        className={CLS_BTN_PRIMARY}
                        disabled={!hasReviewChanges || savingReview}
                        onClick={() => void handleSaveReview()}
                        type="button"
                      >
                        {savingReview ? <Spinner /> : null}
                        Save review
                      </button>
                    </div>
                  </div>
                </div>

                {/* Analysis queue */}
                <div>
                  <div className="border-b border-white/[0.05] px-5 py-2.5">
                    <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--muted)]">Analysis queue</p>
                  </div>
                  {captureDetail.analysisJobs.length > 0 ? (
                    <div className="divide-y divide-white/[0.05]">
                      {captureDetail.analysisJobs.map((job) => (
                        <div key={job.id} className="px-5 py-2.5">
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-strong)]">
                            {job.engine} · {job.status}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] text-[var(--muted)]">
                            {formatTimestamp(job.createdAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="px-5 py-3 text-xs text-[var(--muted)]">
                      No analysis jobs yet.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--muted)]">
                Select a capture from the queue to review it.
              </div>
            )}
          </>
        ) : (
          <>
            <div className="border-b border-white/[0.07] px-5 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">Route replay</p>
              {trackHistoryError ? <p className="mt-3 text-sm text-rose-200">{trackHistoryError}</p> : null}
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="relative min-h-[340px] flex-1 border-b border-white/[0.07] bg-black/25">
                {maps && replayPoints.length > 0 ? (
                  <RouteReplayMap
                    activeIndex={replayIndex}
                    maps={maps}
                    points={replayPoints}
                    savedCountryId={location?.catalogScope.countryId ?? null}
                    trackKey={`${tab}:${selectedTrackKey}`}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-[var(--muted)]">
                    {trackHistoryLoading
                      ? "Loading route history..."
                      : "Select a persisted aircraft or vessel track to replay it here."}
                  </div>
                )}
              </div>

              {activeTrack ? (
                <>
                  <div className="border-b border-white/[0.07] px-5 py-4">
                    <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--muted)]">Selected track</p>
                    <h3 className="mt-1 text-xl font-semibold text-[var(--foreground)]">{activeTrack.label}</h3>
                    <p className="mt-1 text-sm text-[var(--muted)]">{activeTrack.secondaryLabel}</p>
                    <div className="mt-3 grid grid-cols-2 gap-x-4 font-mono text-[11px]">
                      <div>
                        <span className="text-[var(--muted)]">Points · </span>
                        <span className="font-semibold text-[var(--foreground)]">{activeTrack.pointCount.toLocaleString("en")}</span>
                      </div>
                      <div>
                        <span className="text-[var(--muted)]">Source · </span>
                        <span className="font-semibold text-[var(--foreground)]">{activeTrack.sourceLabel}</span>
                      </div>
                    </div>
                  </div>

                  <div className="border-b border-white/[0.07] px-5 py-4">
                    <div className="flex items-center gap-3">
                      <button
                        className={CLS_BTN_PRIMARY}
                        disabled={replayPoints.length <= 1}
                        onClick={() => {
                          if (replayIndex >= replayPoints.length - 1) {
                            setReplayIndex(0);
                          }
                          setReplayPlaying((current) => !current);
                        }}
                        type="button"
                      >
                        {replayPlaying ? "Pause" : "Play"}
                      </button>
                      <button
                        className={CLS_BTN_GHOST}
                        disabled={replayPoints.length === 0}
                        onClick={() => setReplayIndex(replayPoints.length > 0 ? replayPoints.length - 1 : 0)}
                        type="button"
                      >
                        Jump to latest
                      </button>
                    </div>

                    <input
                      className="rf-slider mt-4 w-full"
                      max={Math.max(0, replayPoints.length - 1)}
                      min={0}
                      step={1}
                      type="range"
                      value={Math.max(0, Math.min(replayIndex, Math.max(0, replayPoints.length - 1)))}
                      onChange={(event) => setReplayIndex(Number.parseInt(event.target.value, 10))}
                    />

                    <div className="mt-3 grid grid-cols-2 gap-x-4 border-t border-white/[0.05] pt-3">
                      <div>
                        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">Frame</p>
                        <p className="mt-0.5 font-mono text-[11px] text-[var(--foreground)]">
                          {replayPoints.length > 0 ? `${replayIndex + 1} / ${replayPoints.length}` : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">Observed at</p>
                        <p className="mt-0.5 font-mono text-[11px] text-[var(--foreground)]">
                          {activeReplayPoint ? formatTimestamp(activeReplayPoint.observedAt) : "—"}
                        </p>
                      </div>
                      <div className="col-span-2 mt-2">
                        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">Coordinates</p>
                        <p className="mt-0.5 font-mono text-[11px] text-[var(--foreground)]">
                          {activeReplayPoint
                            ? formatCoordinatePair(activeReplayPoint.latitude, activeReplayPoint.longitude)
                            : "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <p className="px-5 py-4 text-sm text-[var(--muted)]">Select a route target to replay its stored path.</p>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
