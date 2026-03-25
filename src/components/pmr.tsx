"use client";

import { useEffect, useRef, useState } from "react";
import { ActivityCaptureActions, ConfirmDialog } from "@/components/module-ui";
import {
  buildActivityCaptureMeta,
  buildRadioRetuneUrl,
  buildRadioStreamUrl,
  CLS_BTN_PRIMARY,
  formatAdaptiveFrequency,
  RfControlsPanel,
  Spinner,
  cx,
} from "@/components/radio-shared";
import type { HardwareStatus, ResolvedAppLocation } from "@/lib/types";
import type { AudioControls } from "@/lib/radio";
import { PMR_BANDS, getChannelsForBand, type PmrChannel } from "@/data/pmr-channels";
import {
  ACTIVITY_EVENTS_DEFAULT_LIMIT,
  clearActivityEvents as clearPersistedActivityEvents,
  createActivityLogEntryFallback,
  fetchActivityEvents,
  persistActivityEvent,
  type ActivityLogEntry,
} from "@/lib/activity-events";
import {
  ACTIVE_LISTEN_TELEMETRY_REFRESH_MS,
  createActivityWindowMetrics,
  hasRmsActivity,
  mergeActivityWindowMetrics,
  SCANNER_HOLD_GRACE_MS,
  SCANNER_STARTUP_MS,
  TELEMETRY_REFRESH_MS,
} from "@/lib/signal-activity";

type ScannerState = "idle" | "scanning" | "locked";
type ScanMode = "sequential" | "random";

const STORAGE_KEY = "hackrf-webui.pmr-config.v1";
const CONTACT_REFRESH_MS = 4000;

type PersistedConfig = {
  scanMode: ScanMode;
  squelch: number;
  dwellTime: number;
  selectedBandId: string;
};

function loadConfig(): PersistedConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedConfig) : null;
  } catch {
    return null;
  }
}

function buildPmrUrl(
  ch: PmrChannel,
  controls: AudioControls,
  mode: "manual" | "scan",
  location: ResolvedAppLocation | null,
  squelch: number,
): string {
  return buildRadioStreamUrl(
    "/api/pmr-stream",
    { ...ch, label: `${ch.bandId.toUpperCase()} ${ch.label}` },
    controls,
    buildActivityCaptureMeta(
      {
        module: "pmr",
        mode,
        bandId: ch.bandId,
        channelId: ch.id,
        channelNumber: ch.number,
      },
      {
        location,
        squelch,
        channelNotes: ch.notes ?? null,
      },
    ),
  );
}

/** PATCH url to retune an existing stream — no reconnect, no buffering delay */
function buildRetuneUrl(
  ch: PmrChannel,
  mode: "manual" | "scan",
  location: ResolvedAppLocation | null,
  squelch: number,
): string {
  return buildRadioRetuneUrl(
    "/api/pmr-stream",
    {
      ...ch,
      label: `${ch.bandId.toUpperCase()} ${ch.label}`,
    },
    buildActivityCaptureMeta(
      {
        module: "pmr",
        mode,
        bandId: ch.bandId,
        channelId: ch.id,
        channelNumber: ch.number,
      },
      {
        location,
        squelch,
        channelNotes: ch.notes ?? null,
      },
    ),
  );
}

export function PmrModule({
  hardware,
  location,
  onRefreshHardware,
  controls,
  onControlsChange,
}: {
  hardware: HardwareStatus | null;
  location: ResolvedAppLocation | null;
  onRefreshHardware: () => Promise<void>;
  controls: AudioControls;
  onControlsChange: (c: AudioControls) => void;
}) {
  // PmrModule has its own audio element — no dependency on a shared ref from the dashboard
  const audioRef = useRef<HTMLAudioElement>(null);

  // PmrModule only renders after user interaction — never during SSR — so localStorage is safe here
  const [selectedBandId, setSelectedBandId] = useState(() => loadConfig()?.selectedBandId ?? "pmr446");
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [playingChannelId, setPlayingChannelId] = useState<string | null>(null);

  const [scannerState, setScannerState] = useState<ScannerState>("idle");
  const [scanMode, setScanMode] = useState<ScanMode>(() => loadConfig()?.scanMode ?? "sequential");
  const [scanIndex, setScanIndex] = useState(0);
  const [squelch, setSquelch] = useState(() => loadConfig()?.squelch ?? 0.004);
  const [dwellTime, setDwellTime] = useState(() => loadConfig()?.dwellTime ?? 3);

  const [startingChannelId, setStartingChannelId] = useState<string | null>(null);
  const isStarting = startingChannelId !== null;
  const [streamError, setStreamError] = useState("");
  const [scanLog, setScanLog] = useState<ActivityLogEntry[]>([]);
  const [manualActivityRms, setManualActivityRms] = useState<number | null>(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearingActivity, setClearingActivity] = useState(false);

  // Refs to avoid stale closures in timer callbacks — initialised from state (which already has restored values)
  const scannerStateRef  = useRef<ScannerState>("idle");
  const scanModeRef      = useRef(scanMode);
  const squelchRef       = useRef(squelch);
  const dwellTimeRef     = useRef(dwellTime);
  const hardwareRef      = useRef<HardwareStatus | null>(null);
  const playingIdRef     = useRef<string | null>(null);
  const selectedBandRef  = useRef(selectedBandId);
  const locationRef = useRef<ResolvedAppLocation | null>(location);
  const refreshHardwareRef = useRef(onRefreshHardware);
  const pollInFlightRef = useRef(false);

  useEffect(() => { scannerStateRef.current = scannerState; }, [scannerState]);
  useEffect(() => { scanModeRef.current = scanMode; }, [scanMode]);
  useEffect(() => { squelchRef.current = squelch; }, [squelch]);
  useEffect(() => { dwellTimeRef.current = dwellTime; }, [dwellTime]);
  useEffect(() => { hardwareRef.current = hardware; }, [hardware]);
  useEffect(() => { playingIdRef.current = playingChannelId; }, [playingChannelId]);
  useEffect(() => { selectedBandRef.current = selectedBandId; }, [selectedBandId]);
  useEffect(() => { locationRef.current = location; }, [location]);
  useEffect(() => { refreshHardwareRef.current = onRefreshHardware; }, [onRefreshHardware]);

  // Persist config on every change (initial values already come from localStorage via useState initializers)
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scanMode, squelch, dwellTime, selectedBandId }));
  }, [scanMode, squelch, dwellTime, selectedBandId]);

  useEffect(() => {
    let cancelled = false;
    const refreshLog = async () => {
      try {
        const events = await fetchActivityEvents("pmr", ACTIVITY_EVENTS_DEFAULT_LIMIT);
        if (!cancelled) {
          setScanLog(events);
        }
      } catch {
        // Ignore transient polling failures; the next refresh will retry.
      }
    };

    void refreshLog();
    const interval = window.setInterval(() => void refreshLog(), CONTACT_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Attach audio event listeners to the shared audio element (owned by dashboard)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    function handleEnded() {
      setPlayingChannelId(null);
    }
    function handleError() {
      setPlayingChannelId(null);
      if (scannerStateRef.current === "scanning" || scannerStateRef.current === "locked") {
        setStreamError("Audio error — scanner will continue.");
      } else {
        setStreamError("Could not open stream. Check HackRF status and the native binary.");
      }
      void onRefreshHardware();
    }

    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
    // audioRef.current is stable after mount; onRefreshHardware is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const channels = getChannelsForBand(selectedBandId);
  const currentScanChannel = scannerState !== "idle"
    ? (channels[scanIndex % channels.length] ?? null)
    : null;

  // ── Stream control ────────────────────────────────────────────────────────

  async function startChannel(ch: PmrChannel, mode: "manual" | "scan"): Promise<void> {
    if (!audioRef.current) return;
    setStreamError("");
    setPlayingChannelId(null);
    setSelectedChannelId(ch.id);
    setStartingChannelId(ch.id);

    const audio = audioRef.current;

    // Fast path: if a PMR stream is already live, retune in-place.
    // The hackrf process receives a FREQ command via stdin and calls hackrf_set_freq()
    // without restarting — no process teardown, no reconnect, no re-buffering.
    if (hardwareRef.current?.activeStream?.demodMode === "nfm") {
      try {
        const resp = await fetch(buildRetuneUrl(ch, mode, locationRef.current, squelchRef.current), { method: "PATCH" });
        if (resp.ok) {
          setPlayingChannelId(ch.id);
          setSelectedChannelId(ch.id);
          void onRefreshHardware();
          setStartingChannelId(null);
          return;
        }
        // 409 = server has no active stream (process died) → fall through to full start
      } catch {
        // Network error → fall through to full start
      }
    }

    // Full start: stop current audio, set new src, wait for browser to buffer & play
    audio.pause();
    audio.src = buildPmrUrl(ch, controls, mode, locationRef.current, squelchRef.current);
    try {
      await audio.play();
      setPlayingChannelId(ch.id);
      setSelectedChannelId(ch.id);
      void onRefreshHardware();
    } catch (err) {
      // AbortError = play() interrupted by a rapid pause()/src-change — safe to ignore
      if (err instanceof DOMException && err.name === "AbortError") return;
      audio.removeAttribute("src");
      audio.load();
      setPlayingChannelId(null);
      setStreamError(err instanceof Error ? err.message : "Could not start PMR stream.");
    } finally {
      setStartingChannelId(null);
    }
  }

  function stopChannel(): void {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setStartingChannelId(null);
    setPlayingChannelId(null);
  }

  function queueActivityLog(channel: PmrChannel, mode: "manual" | "scan", rms: number): void {
    const occurredAt = new Date().toISOString();
    const band = PMR_BANDS.find((entry) => entry.id === channel.bandId) ?? null;
    const payload = {
      module: "pmr" as const,
      mode,
      label: channel.label,
      freqMhz: channel.freqMhz,
      rms,
      occurredAt,
      bandId: channel.bandId,
      channelId: channel.id,
      channelNumber: channel.number,
      demodMode: "nfm" as const,
      squelch: squelchRef.current,
      location: locationRef.current,
      metadata: {
        bandName: band?.name ?? null,
      },
    };

    void persistActivityEvent(payload)
      .then((entry) => {
        setScanLog((log) => [entry, ...log].slice(0, ACTIVITY_EVENTS_DEFAULT_LIMIT));
      })
      .catch(() => {
        setScanLog((log) => [
          createActivityLogEntryFallback(payload),
          ...log,
        ].slice(0, ACTIVITY_EVENTS_DEFAULT_LIMIT));
      });
  }

  async function handleClearActivity(): Promise<void> {
    setClearingActivity(true);
    try {
      await clearPersistedActivityEvents("pmr");
      setScanLog([]);
      setClearDialogOpen(false);
    } finally {
      setClearingActivity(false);
    }
  }

  function nextScanIndex(channelCount: number, currentIndex: number): number {
    if (channelCount <= 0) {
      return 0;
    }

    return scanModeRef.current === "random"
      ? Math.floor(Math.random() * channelCount)
      : (currentIndex + 1) % channelCount;
  }

  useEffect(() => {
    const shouldPollTelemetry =
      scannerState !== "idle" || playingChannelId !== null || startingChannelId !== null;

    if (!shouldPollTelemetry) {
      return;
    }

    const refreshIntervalMs =
      scannerState !== "idle" ? TELEMETRY_REFRESH_MS : ACTIVE_LISTEN_TELEMETRY_REFRESH_MS;

    let cancelled = false;

    const pollHardware = async () => {
      if (cancelled || pollInFlightRef.current) {
        return;
      }

      pollInFlightRef.current = true;
      try {
        await refreshHardwareRef.current();
      } finally {
        pollInFlightRef.current = false;
      }
    };

    void pollHardware();
    const interval = window.setInterval(() => void pollHardware(), refreshIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [playingChannelId, scannerState, startingChannelId]);

  // ── Scanner: cycle through channels while state === "scanning" ────────────

  useEffect(() => {
    if (scannerState !== "scanning") return;

    const chs = getChannelsForBand(selectedBandRef.current);
    const ch = chs[scanIndex % chs.length];
    if (!ch) return;

    void startChannel(ch, "scan");

    const startedAt = Date.now();
    const activateAt = startedAt + SCANNER_STARTUP_MS;
    const deadlineAt = activateAt + dwellTimeRef.current * 1000;
    let peakWindow = createActivityWindowMetrics();
    let finished = false;

    const timer = window.setInterval(() => {
      if (finished || scannerStateRef.current !== "scanning") {
        return;
      }

      const now = Date.now();
      const telemetry = hardwareRef.current?.activeStream?.telemetry ?? null;
      peakWindow = mergeActivityWindowMetrics(peakWindow, telemetry, now);

      if (now < activateAt) {
        return;
      }

      if (hasRmsActivity(telemetry, squelchRef.current, now)) {
        finished = true;
        clearInterval(timer);
        setScannerState("locked");
        queueActivityLog(ch, "scan", peakWindow.rms);
        return;
      }

      if (now >= deadlineAt) {
        finished = true;
        clearInterval(timer);
        setScanIndex(nextScanIndex(chs.length, scanIndex));
      }
    }, TELEMETRY_REFRESH_MS);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerState, scanIndex, selectedBandId]);

  // ── Scanner: monitor silence while locked ────────────────────────────────

  useEffect(() => {
    if (scannerState !== "locked") return;

    let lastActivityAt = Date.now();
    let released = false;

    const interval = window.setInterval(() => {
      if (released) {
        return;
      }

      const now = Date.now();
      const telemetry = hardwareRef.current?.activeStream?.telemetry ?? null;

      if (hasRmsActivity(telemetry, squelchRef.current, now)) {
        lastActivityAt = now;
        return;
      }

      if (now - lastActivityAt < SCANNER_HOLD_GRACE_MS) {
        return;
      }

      const chs = getChannelsForBand(selectedBandRef.current);
      const lockedIdx = chs.findIndex(c => c.id === playingIdRef.current);
      const base = lockedIdx >= 0 ? lockedIdx : 0;
      released = true;
      clearInterval(interval);
      setScanIndex(nextScanIndex(chs.length, base));
      setScannerState("scanning");
    }, TELEMETRY_REFRESH_MS);

    return () => clearInterval(interval);
  }, [scannerState]);

  function startScan(): void {
    setScanIndex(0);
    setScannerState("scanning");
  }

  function stopScan(): void {
    setScannerState("idle");
    stopChannel();
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const band = PMR_BANDS.find(b => b.id === selectedBandId);
  const telemetry = hardware?.activeStream?.telemetry ?? null;
  const manualChannel = scannerState === "idle"
    ? (channels.find(ch => ch.id === playingChannelId) ?? null)
    : null;

  useEffect(() => {
    if (scannerState !== "idle" || !manualChannel) {
      setManualActivityRms(null);
      return;
    }

    let lastActivityAt = 0;
    let peakRms = 0;
    let burstOpen = false;

    const interval = window.setInterval(() => {
      const now = Date.now();
      const currentTelemetry = hardwareRef.current?.activeStream?.telemetry ?? null;

      if (hasRmsActivity(currentTelemetry, squelchRef.current, now)) {
        const currentRms = currentTelemetry?.rms ?? 0;
        lastActivityAt = now;
        peakRms = Math.max(peakRms, currentRms);
        burstOpen = true;
        setManualActivityRms(peakRms);
        return;
      }

      if (!burstOpen || now - lastActivityAt < SCANNER_HOLD_GRACE_MS) {
        return;
      }

      burstOpen = false;
      setManualActivityRms(null);
      queueActivityLog(manualChannel, "manual", peakRms);
      peakRms = 0;
    }, TELEMETRY_REFRESH_MS);

    return () => {
      clearInterval(interval);
      setManualActivityRms(null);
    };
  }, [manualChannel, scannerState]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Hidden audio element for PMR playback */}
      <audio preload="none" ref={audioRef} />

      {/* ── Band selector sidebar ────────────────────────────── */}
      <aside className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-white/8 bg-black/10">
        {/* Title */}
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--foreground)]">PMR</span>
            <span className="font-mono text-[10px] text-[var(--muted)]">Scanner</span>
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">{channels.length} ch</span>
        </div>

        {/* Band list */}
        <div className="flex-1 overflow-y-auto">
          {PMR_BANDS.map(b => (
            <button
              key={b.id}
              className={cx(
                "w-full border-b border-white/[0.05] px-4 py-3 text-left transition",
                selectedBandId === b.id
                  ? "bg-[var(--accent)]/8 text-[var(--foreground)] border-l-accent"
                  : "text-[var(--muted-strong)] hover:bg-white/[0.03] hover:text-[var(--foreground)] border-l-clear",
              )}
              onClick={() => {
                setSelectedBandId(b.id);
                setScanIndex(0);
                if (scannerState !== "idle") stopScan();
              }}
              type="button"
            >
              <p className="font-mono text-xs font-bold uppercase tracking-[0.08em]">{b.name}</p>
              <p className="mt-0.5 font-mono text-[9px] text-[var(--muted)] leading-tight">{b.region}</p>
              <p className="mt-0.5 text-[10px] text-[var(--muted)] leading-tight">{b.description}</p>
            </button>
          ))}
        </div>

        <RfControlsPanel controls={controls} onControlsChange={onControlsChange} />
      </aside>

      {/* ── Channel list ─────────────────────────────────────── */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
            {band?.name ?? "Channels"}
          </span>
          <span className="font-mono text-[10px] text-[var(--muted)]">{channels.length} ch</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {channels.map(ch => {
            const isSel  = selectedChannelId === ch.id;
            const isPlay = playingChannelId === ch.id;
            const isScan = currentScanChannel?.id === ch.id;

            return (
              <div
                key={ch.id}
                className={cx(
                  "group flex cursor-pointer items-center gap-3 border-b border-white/[0.04] px-4 py-3 transition-colors",
                  isSel ? "bg-[var(--accent)]/7 border-l-accent" : "hover:bg-white/[0.025] border-l-clear",
                )}
                data-channel-id={ch.id}
                onClick={() => setSelectedChannelId(ch.id)}
              >
                {/* Channel number */}
                <span className="w-8 shrink-0 font-mono text-xs font-semibold tabular-nums text-[var(--muted)]">
                  {ch.label}
                </span>

                {/* Frequency */}
                <span className={cx(
                  "w-[4.5rem] shrink-0 font-mono text-sm font-bold tabular-nums",
                  isPlay ? "text-[var(--accent)]" : isSel ? "text-[var(--foreground)]" : "text-[var(--muted-strong)]",
                )}>
                  {formatAdaptiveFrequency(ch.freqMhz)}
                </span>

                {/* Notes */}
                <div className="min-w-0 flex-1">
                  {ch.notes ? (
                    <p className="truncate text-xs text-[var(--muted)]">{ch.notes}</p>
                  ) : null}
                </div>

                {/* Scanner cursor */}
                {isScan && scannerState === "scanning" ? (
                  <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--muted)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted)] animate-pulse" />
                    scanning
                  </span>
                ) : null}

                {/* On air */}
                {isPlay && scannerState !== "scanning" ? (
                  <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--accent)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                    on air
                  </span>
                ) : null}

                {/* Locked */}
                {isPlay && scannerState === "locked" ? (
                  <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--highlight)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--highlight)] animate-pulse" />
                    locked
                  </span>
                ) : null}

                {/* Quick listen / stop / spinner */}
                <button
                  className={cx(
                    "shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold transition",
                    isPlay || startingChannelId === ch.id
                      ? "border-[var(--accent)]/35 bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "border-white/10 bg-white/[0.03] text-[var(--muted)] opacity-0 group-hover:opacity-100",
                  )}
                  onClick={e => {
                    e.stopPropagation();
                    if (isPlay) { stopChannel(); } else { void startChannel(ch, "manual"); }
                  }}
                  type="button"
                >
                  {startingChannelId === ch.id ? <Spinner /> : isPlay ? "■" : "▶"}
                </button>
              </div>
            );
          })}
        </div>
      </main>

      {/* ── Scanner panel ────────────────────────────────────── */}
      <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-white/8 bg-black/15">

        {/* State display */}
        <div className="border-b border-white/8 p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Scanner</p>

          <div className="mt-3">
            {scannerState === "idle" ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cx(
                      "h-2 w-2 rounded-full",
                      manualActivityRms !== null
                        ? "bg-[var(--highlight)] animate-pulse"
                        : manualChannel
                          ? "bg-[var(--accent)]/80"
                          : "border border-white/20 bg-transparent",
                    )}
                  />
                  <span
                    className={cx(
                      "font-mono text-sm font-semibold",
                      manualActivityRms !== null
                        ? "text-[var(--highlight)]"
                        : manualChannel
                          ? "text-[var(--accent)]"
                          : "text-[var(--muted-strong)]",
                    )}
                  >
                    {manualActivityRms !== null ? "ACTIVITY" : manualChannel ? "MONITORING" : "IDLE"}
                  </span>
                </div>
                {manualChannel ? (
                  <>
                    <p className="font-mono text-2xl font-bold tabular-nums text-[var(--foreground)] leading-none">
                      {formatAdaptiveFrequency(manualChannel.freqMhz)}
                      <span className="ml-1 text-sm font-normal text-[var(--muted)]">MHz</span>
                    </p>
                    <p className="font-mono text-xs text-[var(--muted)]">
                      {manualChannel.label} · {manualActivityRms !== null ? "live activity detected" : "listening on fixed channel"}
                    </p>
                    {manualActivityRms !== null ? (
                      <p className="font-mono text-xs text-[var(--highlight)]">
                        RMS {manualActivityRms.toFixed(4)} · live monitor
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-xs text-[var(--muted)]">
                    Select a channel to listen, or start scan to sweep automatically.
                  </p>
                )}
              </div>
            ) : scannerState === "scanning" ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[var(--accent)] animate-pulse" />
                  <span className="font-mono text-sm font-semibold text-[var(--accent)]">SCANNING</span>
                </div>
                {currentScanChannel ? (
                  <>
                    <p className="font-mono text-2xl font-bold tabular-nums text-[var(--foreground)] leading-none">
                      {formatAdaptiveFrequency(currentScanChannel.freqMhz)}
                      <span className="ml-1 text-sm font-normal text-[var(--muted)]">MHz</span>
                    </p>
                    <p className="font-mono text-xs text-[var(--muted)]">
                      {currentScanChannel.label} · {band?.name}
                      {" · "}channel {scanIndex % channels.length + 1}/{channels.length}
                    </p>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[var(--highlight)] animate-pulse" />
                  <span className="font-mono text-sm font-semibold text-[var(--highlight)]">LOCKED</span>
                </div>
                {currentScanChannel ? (
                  <>
                    <p className="font-mono text-2xl font-bold tabular-nums text-[var(--foreground)] leading-none">
                      {formatAdaptiveFrequency(currentScanChannel.freqMhz)}
                      <span className="ml-1 text-sm font-normal text-[var(--muted)]">MHz</span>
                    </p>
                    <p className="font-mono text-xs text-[var(--muted)]">
                      {currentScanChannel.label} · activity detected
                    </p>
                    {telemetry ? (
                      <p className="font-mono text-xs text-[var(--highlight)]">
                        RMS {telemetry.rms.toFixed(4)} · peak {telemetry.peak.toFixed(4)} · RF {telemetry.rf.toFixed(4)}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {/* Scanner config */}
        <div className="border-b border-white/8 p-5 space-y-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Config</p>

          {/* Scan mode */}
          <div>
            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">Mode</p>
            <div className="flex gap-2">
              <button
                className={cx(
                  "flex-1 flex items-center justify-center rounded border py-1.5 transition",
                  scanMode === "sequential"
                    ? "border-[var(--accent)]/40 bg-[var(--accent)]/12 text-[var(--foreground)]"
                    : "border-white/10 bg-white/[0.03] text-[var(--muted)] hover:bg-white/[0.05]",
                )}
                onClick={() => setScanMode("sequential")}
                title="Sequential"
                type="button"
              >
                {/* Double chevron right — ordered/sequential scan */}
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                  <polyline points="4,5 9,10 4,15"/>
                  <polyline points="10,5 15,10 10,15"/>
                </svg>
              </button>
              <button
                className={cx(
                  "flex-1 flex items-center justify-center rounded border py-1.5 transition",
                  scanMode === "random"
                    ? "border-[var(--accent)]/40 bg-[var(--accent)]/12 text-[var(--foreground)]"
                    : "border-white/10 bg-white/[0.03] text-[var(--muted)] hover:bg-white/[0.05]",
                )}
                onClick={() => setScanMode("random")}
                title="Random"
                type="button"
              >
                {/* 5-dot dice face — random scan */}
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
                  <rect x="1.5" y="1.5" width="17" height="17" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                  <circle cx="6" cy="6" r="1.3"/>
                  <circle cx="14" cy="6" r="1.3"/>
                  <circle cx="10" cy="10" r="1.3"/>
                  <circle cx="6" cy="14" r="1.3"/>
                  <circle cx="14" cy="14" r="1.3"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Squelch */}
          <label className="block space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">Squelch</span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{squelch.toFixed(4)}</span>
            </div>
            <input className="rf-slider w-full" max={0.05} min={0.0005} step={0.0005} type="range" value={squelch}
              onChange={e => setSquelch(Number.parseFloat(e.target.value))} />
            <p className="font-mono text-[9px] text-[var(--muted)]">
              RMS activity threshold · hold for {(SCANNER_HOLD_GRACE_MS / 1000).toFixed(1)}s after last activity
            </p>
          </label>

          {/* Dwell time */}
          <label className="block space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">Dwell</span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{dwellTime}s</span>
            </div>
            <input className="rf-slider w-full" max={10} min={1} step={1} type="range" value={dwellTime}
              onChange={e => setDwellTime(Number.parseInt(e.target.value, 10))} />
            <p className="font-mono text-[9px] text-[var(--muted)]">
              Max listen time per channel · ~{(SCANNER_STARTUP_MS / 1000 + dwellTime).toFixed(1)}s total
            </p>
          </label>
        </div>

        {/* Auto scan controls */}
        <div className="border-b border-white/8 px-5 py-4">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Auto scan</p>
          <div className="flex gap-2">
            {scannerState === "idle" ? (
              <>
                <button
                  className={cx("flex-1 justify-center", CLS_BTN_PRIMARY)}
                  disabled={isStarting}
                  onClick={startScan}
                  type="button"
                >
                  ▶ Start scan
                </button>
              </>
            ) : (
              <button
                className={cx(
                  "flex-1 inline-flex items-center justify-center gap-1.5 rounded border px-4 py-2 text-sm font-semibold transition",
                  "border-rose-400/25 bg-rose-400/[0.08] text-rose-300 hover:border-rose-400/45",
                )}
                onClick={stopScan}
                type="button"
              >
                {scannerState === "scanning" && (
                  <svg className="h-3 w-3 animate-spin opacity-70" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" />
                  </svg>
                )}
                Stop Scanning
              </button>
            )}
          </div>
        </div>

        {/* Manual listen */}
        <div className="border-b border-white/8 px-5 py-4">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Manual</p>
          {scannerState === "idle" && selectedChannelId ? (
            <button
              className={cx(
                "w-full inline-flex items-center justify-center gap-1.5 rounded border px-4 py-2 text-sm font-semibold transition",
                playingChannelId === selectedChannelId || startingChannelId === selectedChannelId
                  ? "border-rose-400/25 bg-rose-400/[0.08] text-rose-300 hover:border-rose-400/45"
                  : "border-[var(--accent)]/40 bg-[var(--accent)]/12 text-[var(--foreground)] hover:border-[var(--accent)]/70 hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-40",
              )}
              disabled={isStarting && startingChannelId !== selectedChannelId}
              onClick={() => {
                if (playingChannelId === selectedChannelId) {
                  stopChannel();
                  return;
                }
                const ch = channels.find(c => c.id === selectedChannelId);
                if (ch) void startChannel(ch, "manual");
              }}
              type="button"
            >
              {startingChannelId === selectedChannelId
                ? <><Spinner />Starting…</>
                : playingChannelId === selectedChannelId
                  ? "Stop"
                  : "▶ Listen"}
            </button>
          ) : (
            <p className="text-xs text-[var(--muted)]">
              {scannerState !== "idle"
                ? "Stop the scanner to listen manually."
                : "Select a channel from the list."}
            </p>
          )}
          {streamError ? (
            <p className="mt-3 rounded border border-rose-400/20 bg-rose-400/8 p-3 text-xs leading-5 text-rose-200">
              {streamError}
            </p>
          ) : null}
        </div>

        {/* Contacts */}
        <div className="flex-1 p-5">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
              Contacts
            </p>
            {scanLog.length > 0 ? (
              <button
                className="font-mono text-[9px] uppercase tracking-[0.15em] text-[var(--muted)] transition hover:text-[var(--foreground)]"
                onClick={() => setClearDialogOpen(true)}
                type="button"
              >
                Clear
              </button>
            ) : null}
          </div>

          {scanLog.length === 0 ? (
            <p className="mt-3 text-xs text-[var(--muted)]">No contacts yet.</p>
          ) : (
            <div className="mt-3">
              {scanLog.map((entry) => (
                <div key={entry.id} className="border-b border-white/[0.05] py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-semibold text-[var(--highlight)]">
                      {entry.label}
                    </span>
                    <span className="font-mono text-[9px] text-[var(--muted)]">{entry.time}</span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="font-mono text-[11px] text-[var(--foreground)]">
                      {formatAdaptiveFrequency(entry.freqMhz)} MHz
                    </span>
                    <span className="font-mono text-[10px] text-[var(--accent)]">
                      RMS {entry.rms.toFixed(4)}
                    </span>
                  </div>
                  <ActivityCaptureActions entry={entry} />
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      <ConfirmDialog
        busy={clearingActivity}
        cancelLabel="Keep Log"
        confirmLabel="Delete Activity"
        description="This clears the PMR contacts from the current view, removes the stored entries from the local SQLite database, and deletes any linked WAV/IQ capture files."
        onCancel={() => {
          if (!clearingActivity) {
            setClearDialogOpen(false);
          }
        }}
        onConfirm={() => void handleClearActivity()}
        open={clearDialogOpen}
        title="Delete PMR activity log?"
      />
    </div>
  );
}
