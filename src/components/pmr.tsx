"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ActivityCaptureActions, ConfirmDialog } from "@/components/module-ui";
import { SpectrumDock } from "@/components/spectrum-dock";
import { useRadioSession } from "@/components/use-radio-session";
import {
  CLS_BTN_PRIMARY,
  formatAdaptiveFrequency,
  RfControlsPanel,
  Spinner,
  cx,
} from "@/components/radio-shared";
import { PMR_BANDS, getChannelsForBand, type PmrChannel } from "@/data/pmr-channels";
import {
  ACTIVITY_EVENTS_DEFAULT_LIMIT,
  clearActivityEvents as clearPersistedActivityEvents,
  fetchActivityEvents,
  type ActivityLogEntry,
} from "@/lib/activity-events";
import type {
  CreateRadioSessionRequest,
  NarrowbandScanMode,
  UpdateNarrowbandSessionRequest,
} from "@/lib/radio-session";
import type { AudioControls } from "@/lib/radio";
import { normalizeScannerPostHitHoldSeconds, SCANNER_HOLD_GRACE_MS, SCANNER_POST_HIT_HOLD_DEFAULT_SECONDS, SCANNER_POST_HIT_HOLD_MAX_SECONDS, SCANNER_STARTUP_MS } from "@/lib/signal-activity";
import { buildChannelSpectrumRange } from "@/lib/spectrum";
import type { ResolvedAppLocation } from "@/lib/types";

type ScannerState = "idle" | "scanning" | "locked";
type ScanMode = NarrowbandScanMode;

const STORAGE_KEY = "hackrf-webui.pmr-config.v1";
const CONTACT_REFRESH_MS = 10_000;

type PersistedConfig = {
  scanMode: ScanMode;
  squelch: number;
  dwellTime: number;
  holdTime: number;
  selectedBandId: string;
};

function loadConfig(): PersistedConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedConfig>;
    return {
      scanMode: parsed.scanMode === "random" ? "random" : "sequential",
      squelch: Number.isFinite(parsed.squelch) ? parsed.squelch! : 0.004,
      dwellTime: Number.isFinite(parsed.dwellTime) ? parsed.dwellTime! : 3,
      holdTime: normalizeScannerPostHitHoldSeconds(parsed.holdTime ?? SCANNER_POST_HIT_HOLD_DEFAULT_SECONDS),
      selectedBandId: typeof parsed.selectedBandId === "string" ? parsed.selectedBandId : "pmr446",
    };
  } catch {
    return null;
  }
}

function buildPmrSpectrumMarkers(
  channels: PmrChannel[],
  selectedChannelId: string | null,
  playingChannelId: string | null,
  scanChannelId: string | null,
): Array<{ freqHz: number; label: string; tone?: "accent" | "muted" | "danger" }> {
  return channels.map((channel) => ({
    freqHz: Math.round(channel.freqMhz * 1_000_000),
    label: channel.label,
    tone:
      channel.id === playingChannelId || channel.id === scanChannelId || channel.id === selectedChannelId
        ? "accent"
        : "muted",
  }));
}

function deriveScannerState(
  mode: "manual" | "scan" | null,
  state: string | null,
): ScannerState {
  if (mode !== "scan" || !state || state === "error" || state === "stopped" || state === "stopping") {
    return "idle";
  }
  return state === "locked" ? "locked" : "scanning";
}

function describeBandName(bandId: string | null): string | null {
  if (!bandId) {
    return null;
  }
  return PMR_BANDS.find((entry) => entry.id === bandId)?.name ?? null;
}

function formatSessionAudioUrl(sessionId: string): string {
  return `/api/radio/sessions/${encodeURIComponent(sessionId)}/audio`;
}

export function PmrModule(props: {
  location: ResolvedAppLocation | null;
  controls: AudioControls;
  onControlsChange: (c: AudioControls) => void;
}) {
  const { location, controls, onControlsChange } = props;
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioSessionIdRef = useRef<string | null>(null);
  const lastSessionIdRef = useRef<string | null>(null);

  const [selectedBandId, setSelectedBandId] = useState(() => loadConfig()?.selectedBandId ?? "pmr446");
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode>(() => loadConfig()?.scanMode ?? "sequential");
  const [squelch, setSquelch] = useState(() => loadConfig()?.squelch ?? 0.004);
  const [dwellTime, setDwellTime] = useState(() => loadConfig()?.dwellTime ?? 3);
  const [holdTime, setHoldTime] = useState(() =>
    normalizeScannerPostHitHoldSeconds(loadConfig()?.holdTime ?? SCANNER_POST_HIT_HOLD_DEFAULT_SECONDS),
  );
  const [scanLog, setScanLog] = useState<ActivityLogEntry[]>([]);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearingActivity, setClearingActivity] = useState(false);
  const [streamError, setStreamError] = useState("");
  const [pendingAction, setPendingAction] = useState<null | { type: "scan" | "manual" | "stop"; channelId?: string }>(null);

  const channels = useMemo(() => getChannelsForBand(selectedBandId), [selectedBandId]);
  const spectrumViewRange = useMemo(() => buildChannelSpectrumRange(channels), [channels]);

  const { session, error: sessionError, createSession, stopSession, updateSession } = useRadioSession("pmr", {
    onActivity(event) {
      setScanLog((current) => [
        event.entry,
        ...current.filter((entry) => entry.id !== event.entry.id),
      ].slice(0, ACTIVITY_EVENTS_DEFAULT_LIMIT));
    },
  });

  const scannerState = deriveScannerState(session?.mode ?? null, session?.state ?? null);
  const currentScanChannel = session?.mode === "scan"
    ? (session.pendingChannel ?? session.activeChannel)
    : null;
  const manualChannel = session?.mode === "manual"
    ? (session.pendingChannel ?? session.activeChannel)
    : null;
  const manualActivityRms = session?.mode === "manual" && session.state === "active"
    ? (session.telemetry?.rms ?? null)
    : null;
  const telemetry = session?.telemetry ?? null;
  const playingChannelId = session?.mode === "manual"
    ? (session.activeChannel?.id ?? session.pendingChannel?.id ?? null)
    : scannerState === "locked"
      ? (session?.activeChannel?.id ?? null)
      : null;
  const currentScanChannelId = currentScanChannel?.id ?? null;
  const spectrumMarkers = useMemo(
    () => buildPmrSpectrumMarkers(channels, selectedChannelId, playingChannelId, currentScanChannelId),
    [channels, currentScanChannelId, playingChannelId, selectedChannelId],
  );

  const isBusy = pendingAction !== null;
  const startingChannelId = pendingAction?.type === "manual" ? pendingAction.channelId ?? null : null;
  const band = PMR_BANDS.find((entry) => entry.id === selectedBandId);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scanMode, squelch, dwellTime, holdTime, selectedBandId }));
  }, [dwellTime, holdTime, scanMode, selectedBandId, squelch]);

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

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const handleEnded = () => {
      audioSessionIdRef.current = null;
    };

    const handleError = () => {
      audioSessionIdRef.current = null;
      setStreamError("Could not open PMR session audio.");
    };

    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, []);

  function stopAudioElement(): void {
    const audio = audioRef.current;
    if (!audio) {
      audioSessionIdRef.current = null;
      return;
    }

    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audioSessionIdRef.current = null;
  }

  useEffect(() => {
    if (session?.bandId && session.bandId !== selectedBandId) {
      setSelectedBandId(session.bandId);
    }
  }, [selectedBandId, session?.bandId]);

  useEffect(() => {
    if (!session) {
      lastSessionIdRef.current = null;
      return;
    }

    if (lastSessionIdRef.current !== session.id) {
      lastSessionIdRef.current = session.id;
      setSelectedChannelId(session.activeChannel?.id ?? session.pendingChannel?.id ?? null);
    }
  }, [session]);

  useEffect(() => {
    if (!sessionError) {
      return;
    }
    setStreamError(sessionError);
  }, [sessionError]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const patch: UpdateNarrowbandSessionRequest = {};
    let hasChanges = false;

    if (
      session.controls.lna !== controls.lna
      || session.controls.vga !== controls.vga
      || Math.abs(session.controls.audioGain - controls.audioGain) > 0.001
    ) {
      patch.controls = controls;
      hasChanges = true;
    }
    if (session.squelch !== squelch) {
      patch.squelch = squelch;
      hasChanges = true;
    }
    if (session.dwellTime !== dwellTime) {
      patch.dwellTime = dwellTime;
      hasChanges = true;
    }
    if (session.holdTime !== holdTime) {
      patch.holdTime = holdTime;
      hasChanges = true;
    }
    if (session.scanMode !== scanMode) {
      patch.scanMode = scanMode;
      hasChanges = true;
    }

    if (!hasChanges) {
      return;
    }

    void updateSession(patch).catch((error) => {
      setStreamError(error instanceof Error ? error.message : "Could not update PMR session.");
    });
  }, [controls, dwellTime, holdTime, scanMode, session, squelch, updateSession]);

  const shouldPlaySessionAudio = !!session
    && session.audioAvailable
    && (session.mode === "manual" || session.state === "locked" || session.state === "active");

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (!shouldPlaySessionAudio || !session) {
      stopAudioElement();
      return;
    }

    if (audioSessionIdRef.current !== session.id) {
      audio.pause();
      audio.src = formatSessionAudioUrl(session.id);
      audio.load();
      audioSessionIdRef.current = session.id;
    }

    void audio.play().catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setStreamError(error instanceof Error ? error.message : "Could not start PMR session audio.");
    });
  }, [session, shouldPlaySessionAudio]);

  useEffect(() => {
    if (pendingAction && session && session.state !== "starting" && session.state !== "tuning") {
      setPendingAction(null);
    }
  }, [pendingAction, session]);

  const buildSessionRequest = (
    mode: "manual" | "scan",
    manualChannelId: string | null = null,
  ): CreateRadioSessionRequest => ({
    kind: "narrowband",
    module: "pmr",
    mode,
    controls,
    bandId: selectedBandId,
    channels: channels.map((channel) => ({
      id: channel.id,
      bandId: channel.bandId,
      number: channel.number,
      freqMhz: channel.freqMhz,
      label: channel.label,
      notes: channel.notes,
    })),
    scanMode,
    manualChannelId,
    squelch,
    dwellTime,
    holdTime,
    location,
  });

  async function startManualChannel(channel: PmrChannel): Promise<void> {
    setPendingAction({ type: "manual", channelId: channel.id });
    setStreamError("");
    setSelectedChannelId(channel.id);
    try {
      await createSession(buildSessionRequest("manual", channel.id));
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "Could not start PMR manual session.");
      setPendingAction(null);
    }
  }

  async function startScan(): Promise<void> {
    setPendingAction({ type: "scan" });
    setStreamError("");
    try {
      await createSession(buildSessionRequest("scan"));
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "Could not start PMR scan session.");
      setPendingAction(null);
    }
  }

  async function stopManagedSession(): Promise<void> {
    setPendingAction({ type: "stop" });
    setStreamError("");
    try {
      await stopSession();
      stopAudioElement();
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "Could not stop PMR session.");
    } finally {
      setPendingAction(null);
    }
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

  const scanPositionLabel = session?.mode === "scan"
    ? `${Math.min((session.scanner.currentIndex ?? 0) + 1, Math.max(session.scanner.channelCount, 1))}/${session.scanner.channelCount}`
    : null;

  return (
    <div className="flex flex-1 overflow-hidden">
      <audio preload="none" ref={audioRef} />

      <aside className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-white/8 bg-black/10">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--foreground)]">PMR</span>
            <span className="font-mono text-[10px] text-[var(--muted)]">Scanner</span>
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">{channels.length} ch</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {PMR_BANDS.map((entry) => (
            <button
              key={entry.id}
              className={cx(
                "w-full border-b border-white/[0.05] px-4 py-3 text-left transition",
                selectedBandId === entry.id
                  ? "bg-[var(--accent)]/8 text-[var(--foreground)] border-l-accent"
                  : "text-[var(--muted-strong)] hover:bg-white/[0.03] hover:text-[var(--foreground)] border-l-clear",
              )}
              onClick={() => {
                setSelectedBandId(entry.id);
                setSelectedChannelId(null);
                if (session) {
                  void stopManagedSession();
                } else {
                  stopAudioElement();
                }
              }}
              type="button"
            >
              <p className="font-mono text-xs font-bold uppercase tracking-[0.08em]">{entry.name}</p>
              <p className="mt-0.5 font-mono text-[9px] text-[var(--muted)] leading-tight">{entry.region}</p>
              <p className="mt-0.5 text-[10px] text-[var(--muted)] leading-tight">{entry.description}</p>
            </button>
          ))}
        </div>

        <RfControlsPanel controls={controls} onControlsChange={onControlsChange} />
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
            {band?.name ?? "Channels"}
          </span>
          <span className="font-mono text-[10px] text-[var(--muted)]">{channels.length} ch</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {channels.map((channel) => {
            const isSelected = selectedChannelId === channel.id;
            const isPlaying = playingChannelId === channel.id;
            const isScanCursor = currentScanChannelId === channel.id;

            return (
              <div
                key={channel.id}
                className={cx(
                  "group flex cursor-pointer items-center gap-3 border-b border-white/[0.04] px-4 py-3 transition-colors",
                  isSelected ? "bg-[var(--accent)]/7 border-l-accent" : "hover:bg-white/[0.025] border-l-clear",
                )}
                data-channel-id={channel.id}
                onClick={() => setSelectedChannelId(channel.id)}
              >
                <span className="w-8 shrink-0 font-mono text-xs font-semibold tabular-nums text-[var(--muted)]">
                  {channel.label}
                </span>

                <span
                  className={cx(
                    "w-[4.5rem] shrink-0 font-mono text-sm font-bold tabular-nums",
                    isPlaying ? "text-[var(--accent)]" : isSelected ? "text-[var(--foreground)]" : "text-[var(--muted-strong)]",
                  )}
                >
                  {formatAdaptiveFrequency(channel.freqMhz)}
                </span>

                <div className="min-w-0 flex-1">
                  {channel.notes ? (
                    <p className="truncate text-xs text-[var(--muted)]">{channel.notes}</p>
                  ) : null}
                </div>

                {isScanCursor && scannerState === "scanning" ? (
                  <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--muted)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted)] animate-pulse" />
                    scanning
                  </span>
                ) : null}

                {isPlaying && scannerState !== "scanning" ? (
                  <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--accent)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                    on air
                  </span>
                ) : null}

                {isPlaying && scannerState === "locked" ? (
                  <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--highlight)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--highlight)] animate-pulse" />
                    locked
                  </span>
                ) : null}

                <button
                  className={cx(
                    "shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold transition",
                    isPlaying || startingChannelId === channel.id
                      ? "border-[var(--accent)]/35 bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "border-white/10 bg-white/[0.03] text-[var(--muted)] opacity-0 group-hover:opacity-100",
                  )}
                  disabled={pendingAction?.type === "stop"}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (session?.mode === "manual" && isPlaying) {
                      void stopManagedSession();
                      return;
                    }
                    void startManualChannel(channel);
                  }}
                  type="button"
                >
                  {startingChannelId === channel.id ? <Spinner /> : isPlaying && session?.mode === "manual" ? "■" : "▶"}
                </button>
              </div>
            );
          })}
        </div>

        <SpectrumDock
          expectedDemodMode="nfm"
          expectedOwner="audio"
          lockViewToRange={scannerState !== "idle"}
          maxZoom={24}
          markers={spectrumMarkers}
          moduleId="pmr"
          viewRangeHz={spectrumViewRange}
        />
      </main>

      <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-white/8 bg-black/15">
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
                      {currentScanChannel.label} · {describeBandName(session?.bandId ?? null) ?? band?.name}
                      {scanPositionLabel ? ` · channel ${scanPositionLabel}` : ""}
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

        <div className="border-b border-white/8 p-5 space-y-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Config</p>

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
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                  <polyline points="4,5 9,10 4,15" />
                  <polyline points="10,5 15,10 10,15" />
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
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
                  <rect x="1.5" y="1.5" width="17" height="17" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="6" cy="6" r="1.3" />
                  <circle cx="14" cy="6" r="1.3" />
                  <circle cx="10" cy="10" r="1.3" />
                  <circle cx="6" cy="14" r="1.3" />
                  <circle cx="14" cy="14" r="1.3" />
                </svg>
              </button>
            </div>
          </div>

          <label className="block space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">Squelch</span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{squelch.toFixed(4)}</span>
            </div>
            <input
              className="rf-slider w-full"
              max={0.05}
              min={0.0005}
              step={0.0005}
              type="range"
              value={squelch}
              onChange={(event) => setSquelch(Number.parseFloat(event.target.value))}
            />
            <p className="font-mono text-[9px] text-[var(--muted)]">
              RMS activity threshold · hold for {(SCANNER_HOLD_GRACE_MS / 1000).toFixed(1)}s after last activity
            </p>
          </label>

          <label className="block space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">Dwell</span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{dwellTime}s</span>
            </div>
            <input
              className="rf-slider w-full"
              max={10}
              min={1}
              step={1}
              type="range"
              value={dwellTime}
              onChange={(event) => setDwellTime(Number.parseInt(event.target.value, 10))}
            />
            <p className="font-mono text-[9px] text-[var(--muted)]">
              Max listen time per channel · ~{(SCANNER_STARTUP_MS / 1000 + dwellTime).toFixed(1)}s total
            </p>
          </label>

          <label className="block space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">Hold</span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{holdTime}s</span>
            </div>
            <input
              className="rf-slider w-full"
              max={SCANNER_POST_HIT_HOLD_MAX_SECONDS}
              min={0}
              step={1}
              type="range"
              value={holdTime}
              onChange={(event) =>
                setHoldTime(normalizeScannerPostHitHoldSeconds(Number.parseInt(event.target.value, 10)))
              }
            />
            <p className="font-mono text-[9px] text-[var(--muted)]">
              Minimum extra lock after a hit · release still waits for {(SCANNER_HOLD_GRACE_MS / 1000).toFixed(1)}s silence
            </p>
          </label>
        </div>

        <div className="border-b border-white/8 px-5 py-4">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Auto scan</p>
          <div className="flex gap-2">
            {scannerState === "idle" ? (
              <button
                className={cx("flex-1 justify-center", CLS_BTN_PRIMARY)}
                disabled={isBusy}
                onClick={() => void startScan()}
                type="button"
              >
                ▶ Start scan
              </button>
            ) : (
              <button
                className={cx(
                  "flex-1 inline-flex items-center justify-center gap-1.5 rounded border px-4 py-2 text-sm font-semibold transition",
                  "border-rose-400/25 bg-rose-400/[0.08] text-rose-300 hover:border-rose-400/45",
                )}
                disabled={isBusy}
                onClick={() => void stopManagedSession()}
                type="button"
              >
                {(pendingAction?.type === "stop" || scannerState === "scanning") && (
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

        <div className="border-b border-white/8 px-5 py-4">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Manual</p>
          {scannerState === "idle" && selectedChannelId ? (
            <button
              className={cx(
                "w-full inline-flex items-center justify-center gap-1.5 rounded border px-4 py-2 text-sm font-semibold transition",
                session?.mode === "manual" && playingChannelId === selectedChannelId
                  ? "border-rose-400/25 bg-rose-400/[0.08] text-rose-300 hover:border-rose-400/45"
                  : "border-[var(--accent)]/40 bg-[var(--accent)]/12 text-[var(--foreground)] hover:border-[var(--accent)]/70 hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-40",
              )}
              disabled={isBusy && startingChannelId !== selectedChannelId}
              onClick={() => {
                if (session?.mode === "manual" && playingChannelId === selectedChannelId) {
                  void stopManagedSession();
                  return;
                }
                const channel = channels.find((entry) => entry.id === selectedChannelId);
                if (channel) {
                  void startManualChannel(channel);
                }
              }}
              type="button"
            >
              {startingChannelId === selectedChannelId
                ? <><Spinner />Starting…</>
                : session?.mode === "manual" && playingChannelId === selectedChannelId
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
                  <div className="mt-0.5 flex items-center justify-between">
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
