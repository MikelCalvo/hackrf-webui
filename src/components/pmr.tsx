"use client";

import { useEffect, useRef, useState } from "react";
import type { HardwareStatus } from "@/lib/types";
import { PMR_BANDS, getChannelsForBand, type PmrChannel } from "@/data/pmr-channels";

type ScannerState = "idle" | "scanning" | "locked";
type ScanMode = "sequential" | "random";

type ScanLogEntry = {
  label: string;
  freqMhz: number;
  rms: number;
  time: string;
};

type Controls = { lna: number; vga: number; audioGain: number };

// Time before checking RMS after a channel starts (HackRF init + buffer fill)
const STARTUP_MS = 2800;

const STORAGE_KEY = "hackrf-webui.pmr-config.v1";

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

function cx(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(" ");
}

function buildPmrUrl(ch: PmrChannel, controls: Controls): string {
  const p = new URLSearchParams({
    label: `${ch.bandId.toUpperCase()} ${ch.label}`,
    freqMHz: String(ch.freqMhz),
    lna: String(controls.lna),
    vga: String(controls.vga),
    audioGain: String(controls.audioGain),
    t: String(Date.now()),
  });
  return `/api/pmr-stream?${p}`;
}

/** PATCH url to retune an existing stream — no reconnect, no buffering delay */
function buildRetuneUrl(ch: PmrChannel): string {
  return `/api/pmr-stream?${new URLSearchParams({
    label: `${ch.bandId.toUpperCase()} ${ch.label}`,
    freqMHz: String(ch.freqMhz),
  })}`;
}

const CLS_INPUT =
  "w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)]/50 focus:bg-white/[0.06]";
const CLS_BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/12 px-4 py-2 text-sm font-semibold transition hover:border-[var(--accent)]/70 hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-40";
const CLS_BTN_GHOST =
  "inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-[var(--muted-strong)] transition hover:border-white/18 hover:bg-white/[0.07]";

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z" />
    </svg>
  );
}

export function PmrModule({
  audioRef,
  hardware,
  onRefreshHardware,
  controls,
  onControlsChange,
}: {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  hardware: HardwareStatus | null;
  onRefreshHardware: () => Promise<void>;
  controls: Controls;
  onControlsChange: (c: Controls) => void;
}) {
  // PmrModule only renders after user interaction — never during SSR — so localStorage is safe here
  const [selectedBandId, setSelectedBandId] = useState(() => loadConfig()?.selectedBandId ?? "pmr446");
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [playingChannelId, setPlayingChannelId] = useState<string | null>(null);

  const [scannerState, setScannerState] = useState<ScannerState>("idle");
  const [scanMode, setScanMode] = useState<ScanMode>(() => loadConfig()?.scanMode ?? "sequential");
  const [scanIndex, setScanIndex] = useState(0);
  const [squelch, setSquelch] = useState(() => loadConfig()?.squelch ?? 0.020);
  const [dwellTime, setDwellTime] = useState(() => loadConfig()?.dwellTime ?? 3);

  const [startingChannelId, setStartingChannelId] = useState<string | null>(null);
  const isStarting = startingChannelId !== null;
  const [streamError, setStreamError] = useState("");
  const [scanLog, setScanLog] = useState<ScanLogEntry[]>([]);

  // Refs to avoid stale closures in timer callbacks — initialised from state (which already has restored values)
  const scannerStateRef  = useRef<ScannerState>("idle");
  const scanModeRef      = useRef(scanMode);
  const squelchRef       = useRef(squelch);
  const dwellTimeRef     = useRef(dwellTime);
  const hardwareRef      = useRef<HardwareStatus | null>(null);
  const playingIdRef     = useRef<string | null>(null);
  const selectedBandRef  = useRef(selectedBandId);

  useEffect(() => { scannerStateRef.current = scannerState; }, [scannerState]);
  useEffect(() => { scanModeRef.current = scanMode; }, [scanMode]);
  useEffect(() => { squelchRef.current = squelch; }, [squelch]);
  useEffect(() => { dwellTimeRef.current = dwellTime; }, [dwellTime]);
  useEffect(() => { hardwareRef.current = hardware; }, [hardware]);
  useEffect(() => { playingIdRef.current = playingChannelId; }, [playingChannelId]);
  useEffect(() => { selectedBandRef.current = selectedBandId; }, [selectedBandId]);

  // Persist config on every change (initial values already come from localStorage via useState initializers)
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scanMode, squelch, dwellTime, selectedBandId }));
  }, [scanMode, squelch, dwellTime, selectedBandId]);

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

  async function startChannel(ch: PmrChannel): Promise<void> {
    if (!audioRef.current) return;
    setStreamError("");
    setStartingChannelId(ch.id);

    const audio = audioRef.current;

    // Fast path: if a PMR stream is already live, retune in-place.
    // The hackrf process receives a FREQ command via stdin and calls hackrf_set_freq()
    // without restarting — no process teardown, no reconnect, no re-buffering.
    if (playingChannelId !== null) {
      try {
        const resp = await fetch(buildRetuneUrl(ch), { method: "PATCH" });
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
    audio.src = buildPmrUrl(ch, controls);
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

  // ── Scanner: cycle through channels while state === "scanning" ────────────

  useEffect(() => {
    if (scannerState !== "scanning") return;

    const chs = getChannelsForBand(selectedBandRef.current);
    const ch = chs[scanIndex % chs.length];
    if (!ch) return;

    void startChannel(ch);

    const timer = setTimeout(() => {
      if (scannerStateRef.current !== "scanning") return;

      const rms = hardwareRef.current?.activeStream?.telemetry?.rms ?? 0;

      if (rms > squelchRef.current) {
        // Voice detected — lock on this channel
        setScannerState("locked");
        setScanLog(log => [
          {
            label: ch.label,
            freqMhz: ch.freqMhz,
            rms,
            time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          },
          ...log.slice(0, 9),
        ]);
      } else {
        // Quiet — advance to next channel
        const count = chs.length;
        const next =
          scanModeRef.current === "random"
            ? Math.floor(Math.random() * count)
            : (scanIndex + 1) % count;
        setScanIndex(next);
      }
    }, STARTUP_MS + dwellTimeRef.current * 1000);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerState, scanIndex, selectedBandId]);

  // ── Scanner: monitor silence while locked ────────────────────────────────

  useEffect(() => {
    if (scannerState !== "locked") return;

    const interval = setInterval(() => {
      const rms = hardwareRef.current?.activeStream?.telemetry?.rms ?? 0;
      if (rms < squelchRef.current * 0.5) {
        // Silence resumed — continue scanning from next channel
        const chs = getChannelsForBand(selectedBandRef.current);
        const lockedIdx = chs.findIndex(c => c.id === playingIdRef.current);
        const base = lockedIdx >= 0 ? lockedIdx : 0;
        const next =
          scanModeRef.current === "random"
            ? Math.floor(Math.random() * chs.length)
            : (base + 1) % chs.length;
        setScanIndex(next);
        setScannerState("scanning");
      }
    }, 2000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 overflow-hidden">

      {/* ── Band selector sidebar ────────────────────────────── */}
      <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-white/8 bg-black/10">
        <div className="p-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--muted)]">
            Band / Standard
          </span>

          <div className="mt-3 space-y-1">
            {PMR_BANDS.map(b => (
              <button
                key={b.id}
                className={cx(
                  "w-full rounded-lg px-3 py-2.5 text-left transition",
                  selectedBandId === b.id
                    ? "bg-[var(--accent)]/10 text-[var(--foreground)] border-l-accent"
                    : "text-[var(--muted-strong)] hover:bg-white/[0.03] hover:text-[var(--foreground)] border-l-clear",
                )}
                onClick={() => {
                  setSelectedBandId(b.id);
                  setScanIndex(0);
                  if (scannerState !== "idle") stopScan();
                }}
                type="button"
              >
                <p className="font-mono text-sm font-bold">{b.name}</p>
                <p className="mt-0.5 font-mono text-[9px] text-[var(--muted)] leading-tight">{b.region}</p>
                <p className="mt-0.5 text-[10px] text-[var(--muted)] leading-tight">{b.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* RF Controls */}
        <div className="mt-auto border-t border-white/8 p-4 space-y-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">RF Controls</p>

          <label className="block space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">LNA</span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{controls.lna} dB</span>
            </div>
            <input className="rf-slider w-full" max={40} min={0} step={8} type="range" value={controls.lna}
              onChange={e => onControlsChange({ ...controls, lna: Number.parseInt(e.target.value, 10) })} />
          </label>

          <label className="block space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">VGA</span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{controls.vga} dB</span>
            </div>
            <input className="rf-slider w-full" max={62} min={0} step={2} type="range" value={controls.vga}
              onChange={e => onControlsChange({ ...controls, vga: Number.parseInt(e.target.value, 10) })} />
          </label>

          <label className="block space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">Volume</span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{controls.audioGain.toFixed(1)}×</span>
            </div>
            <input className="rf-slider w-full" max={8} min={0.2} step={0.1} type="range" value={controls.audioGain}
              onChange={e => onControlsChange({ ...controls, audioGain: Number.parseFloat(e.target.value) })} />
          </label>
        </div>
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
                  {ch.freqMhz.toFixed(ch.freqMhz < 200 ? 3 : 5)}
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
                    if (isPlay) { stopChannel(); } else { void startChannel(ch); }
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
                  <span className="h-2 w-2 rounded-full border border-white/20 bg-transparent" />
                  <span className="font-mono text-sm font-semibold text-[var(--muted-strong)]">IDLE</span>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  Select a channel to listen, or start scan to sweep automatically.
                </p>
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
                      {currentScanChannel.freqMhz.toFixed(currentScanChannel.freqMhz < 200 ? 3 : 5)}
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
                      {currentScanChannel.freqMhz.toFixed(currentScanChannel.freqMhz < 200 ? 3 : 5)}
                      <span className="ml-1 text-sm font-normal text-[var(--muted)]">MHz</span>
                    </p>
                    <p className="font-mono text-xs text-[var(--muted)]">
                      {currentScanChannel.label} · voice detected
                    </p>
                    {telemetry ? (
                      <p className="font-mono text-xs text-[var(--highlight)]">
                        RMS {telemetry.rms.toFixed(4)} · peak {telemetry.peak.toFixed(4)}
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
                  "flex-1 flex items-center justify-center rounded-full border py-1.5 transition",
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
                  "flex-1 flex items-center justify-center rounded-full border py-1.5 transition",
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
              <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{squelch.toFixed(3)}</span>
            </div>
            <input className="rf-slider w-full" max={0.1} min={0.001} step={0.001} type="range" value={squelch}
              onChange={e => setSquelch(Number.parseFloat(e.target.value))} />
            <p className="font-mono text-[9px] text-[var(--muted)]">
              Min RMS to lock · resume at {(squelch * 0.5).toFixed(3)}
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
              Listen time per channel · ~{(STARTUP_MS / 1000 + dwellTime).toFixed(1)}s total
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
                  {isStarting ? <><Spinner />Starting…</> : "▶ Start scan"}
                </button>
                <button
                  className={CLS_BTN_GHOST}
                  disabled={isStarting}
                  title="Pick a random channel"
                  onClick={() => {
                    const ch = channels[Math.floor(Math.random() * channels.length)];
                    if (ch) void startChannel(ch);
                  }}
                  type="button"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
                    <rect x="1.5" y="1.5" width="17" height="17" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                    <circle cx="6" cy="6" r="1.3"/>
                    <circle cx="14" cy="6" r="1.3"/>
                    <circle cx="10" cy="10" r="1.3"/>
                    <circle cx="6" cy="14" r="1.3"/>
                    <circle cx="14" cy="14" r="1.3"/>
                  </svg>
                </button>
              </>
            ) : (
              <>
                {scannerState === "locked" ? (
                  <button
                    className={cx("flex-1 justify-center", CLS_BTN_PRIMARY)}
                    disabled={isStarting}
                    onClick={() => {
                      const chs = getChannelsForBand(selectedBandId);
                      const idx = chs.findIndex(c => c.id === playingChannelId);
                      const next = (idx >= 0 ? idx + 1 : 0) % chs.length;
                      setScanIndex(next);
                      setScannerState("scanning");
                    }}
                    type="button"
                  >
                    {isStarting ? <><Spinner />Starting…</> : "▶▶ Skip"}
                  </button>
                ) : (
                  <button
                    className={cx("flex-1 justify-center", CLS_BTN_GHOST)}
                    disabled
                    type="button"
                  >
                    <Spinner />Scanning…
                  </button>
                )}
                <button className={CLS_BTN_GHOST} onClick={stopScan} type="button">■ Stop</button>
              </>
            )}
          </div>
        </div>

        {/* Manual listen */}
        <div className="border-b border-white/8 px-5 py-4">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Manual</p>
          {scannerState === "idle" && selectedChannelId ? (
            <div className="flex gap-2">
              <button
                className={cx("flex-1 justify-center", CLS_BTN_PRIMARY)}
                disabled={isStarting}
                onClick={() => {
                  const ch = channels.find(c => c.id === selectedChannelId);
                  if (ch) void startChannel(ch);
                }}
                type="button"
              >
                {isStarting ? <><Spinner />Starting…</> : playingChannelId === selectedChannelId ? "▶ Retune" : "▶ Listen"}
              </button>
              <button className={CLS_BTN_GHOST} onClick={stopChannel} type="button">■</button>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)]">
              {scannerState !== "idle"
                ? "Stop the scanner to listen manually."
                : "Select a channel from the list."}
            </p>
          )}
          {streamError ? (
            <p className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/8 p-3 text-xs leading-5 text-rose-200">
              {streamError}
            </p>
          ) : null}
        </div>

        {/* Activity log */}
        <div className="flex-1 p-5">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
              Activity log
            </p>
            {scanLog.length > 0 ? (
              <button
                className="font-mono text-[9px] uppercase tracking-[0.15em] text-[var(--muted)] transition hover:text-[var(--foreground)]"
                onClick={() => setScanLog([])}
                type="button"
              >
                Clear
              </button>
            ) : null}
          </div>

          {scanLog.length === 0 ? (
            <p className="mt-3 text-xs text-[var(--muted)]">No activity yet.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {scanLog.map((entry, i) => (
                <div key={i} className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-semibold text-[var(--highlight)]">
                      {entry.label}
                    </span>
                    <span className="font-mono text-[9px] text-[var(--muted)]">{entry.time}</span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="font-mono text-[11px] text-[var(--foreground)]">
                      {entry.freqMhz.toFixed(entry.freqMhz < 200 ? 3 : 5)} MHz
                    </span>
                    <span className="font-mono text-[10px] text-[var(--accent)]">
                      RMS {entry.rms.toFixed(4)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
