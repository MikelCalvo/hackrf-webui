"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { CLS_INPUT } from "@/components/module-ui";
import {
  buildRadioRetuneUrl,
  buildRadioStreamUrl,
  CLS_BTN_GHOST,
  CLS_BTN_PRIMARY,
  formatFixedFrequency,
  RfControlsPanel,
  Spinner,
  cx,
} from "@/components/radio-shared";
import {
  AIRBAND_BANDS,
  getAirbandChannelsForBand,
  type AirbandChannel,
} from "@/data/airband-channels";
import type { AudioControls } from "@/lib/radio";
import type { HardwareStatus } from "@/lib/types";

const AIRBAND_STORAGE_KEY = "hackrf-webui.airband-presets.v1";
const AIRBAND_CONFIG_KEY = "hackrf-webui.airband-config.v1";
const AIRBAND_MIN_MHZ = 118.0;
const AIRBAND_MAX_MHZ = 137.0;
const AIRBAND_SWEEP_MAX_MHZ = 136.975;
const AIRBAND_SWEEP_STEP_MHZ = 0.025;
const STARTUP_MS = 2800;

type ScannerState = "idle" | "scanning" | "locked";
type ScanMode = "sequential" | "random";

type PersistedConfig = {
  selectedBandId: string;
  manualFreqMhz: string;
  manualLabel: string;
  manualNotes: string;
  scanMode: ScanMode;
  squelch: number;
  dwellTime: number;
  freeScan: boolean;
};

type SavedAirbandPreset = {
  id: string;
  freqMhz: number;
  label: string;
  notes?: string;
  createdAt: string;
};

type ScanLogEntry = {
  label: string;
  freqMhz: number;
  rms: number;
  time: string;
};

const DEFAULT_CONFIG: PersistedConfig = {
  selectedBandId: "common",
  manualFreqMhz: "121.500",
  manualLabel: "Guard",
  manualNotes: "",
  scanMode: "sequential",
  squelch: 0.012,
  dwellTime: 4,
  freeScan: false,
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function loadConfig(): PersistedConfig {
  const raw = loadJson<Partial<PersistedConfig>>(AIRBAND_CONFIG_KEY, DEFAULT_CONFIG);

  return {
    selectedBandId: typeof raw.selectedBandId === "string" ? raw.selectedBandId : DEFAULT_CONFIG.selectedBandId,
    manualFreqMhz: typeof raw.manualFreqMhz === "string" ? raw.manualFreqMhz : DEFAULT_CONFIG.manualFreqMhz,
    manualLabel: typeof raw.manualLabel === "string" ? raw.manualLabel : DEFAULT_CONFIG.manualLabel,
    manualNotes: typeof raw.manualNotes === "string" ? raw.manualNotes : DEFAULT_CONFIG.manualNotes,
    scanMode: raw.scanMode === "random" ? "random" : DEFAULT_CONFIG.scanMode,
    squelch: Number.isFinite(raw.squelch) ? raw.squelch! : DEFAULT_CONFIG.squelch,
    dwellTime: Number.isFinite(raw.dwellTime) ? raw.dwellTime! : DEFAULT_CONFIG.dwellTime,
    freeScan: raw.freeScan === true,
  };
}

function formatAirbandFrequency(freqMhz: number): string {
  return formatFixedFrequency(freqMhz, 3);
}

function inAirbandRange(freqMhz: number): boolean {
  return Number.isFinite(freqMhz) && freqMhz >= AIRBAND_MIN_MHZ && freqMhz <= AIRBAND_MAX_MHZ;
}

function normalizeAirbandFrequency(freqMhz: number): number {
  const clamped = Math.max(AIRBAND_MIN_MHZ, Math.min(AIRBAND_MAX_MHZ, freqMhz));
  return Number(clamped.toFixed(5));
}

function savedPresetToChannel(preset: SavedAirbandPreset, index: number): AirbandChannel {
  return {
    id: preset.id,
    bandId: "saved",
    number: index + 1,
    freqMhz: preset.freqMhz,
    label: preset.label,
    notes: preset.notes,
    removable: true,
  };
}

function createManualChannel(
  freqMhz: number,
  label: string,
  notes: string,
  selectedBandId: string,
): AirbandChannel {
  const safeFreq = normalizeAirbandFrequency(freqMhz);
  const safeLabel = label.trim() || `AIRBAND ${formatAirbandFrequency(safeFreq)}`;
  return {
    id: `manual-${safeFreq}-${safeLabel.toLowerCase().replace(/\s+/g, "-")}`,
    bandId: selectedBandId,
    number: 0,
    freqMhz: safeFreq,
    label: safeLabel,
    notes: notes.trim() || "Manual airband tune",
  };
}

function buildAirbandUrl(channel: AirbandChannel, controls: AudioControls): string {
  return buildRadioStreamUrl("/api/airband-stream", channel, controls);
}

function buildAirbandRetuneUrl(channel: AirbandChannel): string {
  return buildRadioRetuneUrl("/api/airband-stream", channel);
}

function StepButton({
  children,
  disabled,
  onClick,
}: {
  children: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="rounded border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-[11px] text-[var(--muted-strong)] transition hover:border-white/18 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function uniqueChannels(channels: AirbandChannel[]): AirbandChannel[] {
  const byKey = new Map<string, AirbandChannel>();

  for (const channel of channels) {
    const key = `${channel.freqMhz.toFixed(3)}:${channel.label}`;
    if (!byKey.has(key)) {
      byKey.set(key, channel);
    }
  }

  return [...byKey.values()]
    .sort((left, right) => left.freqMhz - right.freqMhz || left.label.localeCompare(right.label))
    .map((channel, index) => ({
      ...channel,
      number: index + 1,
    }));
}

function uniqueScanChannels(channels: AirbandChannel[]): AirbandChannel[] {
  const byFrequency = new Map<string, AirbandChannel>();

  for (const channel of channels) {
    const key = channel.freqMhz.toFixed(5);
    if (!byFrequency.has(key)) {
      byFrequency.set(key, channel);
    }
  }

  return [...byFrequency.values()].sort((left, right) => left.freqMhz - right.freqMhz);
}

function buildSweepChannels(): AirbandChannel[] {
  const channels: AirbandChannel[] = [];
  let index = 0;

  for (
    let freqMhz = AIRBAND_MIN_MHZ;
    freqMhz <= AIRBAND_SWEEP_MAX_MHZ + 0.000001;
    freqMhz += AIRBAND_SWEEP_STEP_MHZ
  ) {
    const normalized = normalizeAirbandFrequency(freqMhz);
    channels.push({
      id: `sweep-${normalized.toFixed(5)}`,
      bandId: "sweep",
      number: index + 1,
      freqMhz: normalized,
      label: `Sweep ${formatAirbandFrequency(normalized)}`,
      notes: "Free scan raster",
    });
    index += 1;
  }

  return channels;
}

const FREE_SCAN_CHANNELS = buildSweepChannels();

export function AirbandModule({
  hardware,
  onRefreshHardware,
  controls,
  onControlsChange,
}: {
  hardware: HardwareStatus | null;
  onRefreshHardware: () => Promise<void>;
  controls: AudioControls;
  onControlsChange: (controls: AudioControls) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);

  const [savedPresets, setSavedPresets] = useState<SavedAirbandPreset[]>(
    () => loadJson<SavedAirbandPreset[]>(AIRBAND_STORAGE_KEY, []),
  );
  const [config, setConfig] = useState<PersistedConfig>(
    () => loadConfig(),
  );
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [manualChannel, setManualChannel] = useState<AirbandChannel | null>(null);
  const [playingChannelId, setPlayingChannelId] = useState<string | null>(null);
  const [startingChannelId, setStartingChannelId] = useState<string | null>(null);
  const [streamError, setStreamError] = useState("");
  const [scannerState, setScannerState] = useState<ScannerState>("idle");
  const [scanIndex, setScanIndex] = useState(0);
  const [scanLog, setScanLog] = useState<ScanLogEntry[]>([]);

  const scannerStateRef = useRef<ScannerState>("idle");
  const scanModeRef = useRef<ScanMode>(config.scanMode);
  const squelchRef = useRef(config.squelch);
  const dwellTimeRef = useRef(config.dwellTime);
  const playingIdRef = useRef<string | null>(null);
  const hardwareRef = useRef<HardwareStatus | null>(null);

  useEffect(() => {
    scannerStateRef.current = scannerState;
  }, [scannerState]);

  useEffect(() => {
    scanModeRef.current = config.scanMode;
    squelchRef.current = config.squelch;
    dwellTimeRef.current = config.dwellTime;
  }, [config]);

  useEffect(() => {
    playingIdRef.current = playingChannelId;
  }, [playingChannelId]);

  useEffect(() => {
    hardwareRef.current = hardware;
  }, [hardware]);

  useEffect(() => {
    localStorage.setItem(AIRBAND_STORAGE_KEY, JSON.stringify(savedPresets));
  }, [savedPresets]);

  useEffect(() => {
    localStorage.setItem(AIRBAND_CONFIG_KEY, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    function handleEnded() {
      setPlayingChannelId(null);
      setStartingChannelId(null);
    }

    function handleError() {
      setPlayingChannelId(null);
      setStartingChannelId(null);
      setStreamError(
        scannerStateRef.current === "scanning" || scannerStateRef.current === "locked"
          ? "Audio error. The AIRBAND scanner will continue."
          : "Could not open AIRBAND audio. Check HackRF status and the native binary.",
      );
      void onRefreshHardware();
    }

    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, [onRefreshHardware]);

  const savedChannels = useMemo(
    () => uniqueChannels(savedPresets.map(savedPresetToChannel)),
    [savedPresets],
  );
  const selectedBand = useMemo(
    () => AIRBAND_BANDS.find((band) => band.id === config.selectedBandId) ?? AIRBAND_BANDS[0],
    [config.selectedBandId],
  );
  const allChannels = useMemo(
    () => uniqueChannels([
      ...savedChannels,
      ...AIRBAND_BANDS.filter((band) => band.id !== "all" && band.id !== "saved")
        .flatMap((band) => getAirbandChannelsForBand(band.id)),
    ]),
    [savedChannels],
  );

  const channels = useMemo(() => {
    if (selectedBand.id === "saved") {
      return savedChannels;
    }
    if (selectedBand.id === "all") {
      return allChannels;
    }
    return getAirbandChannelsForBand(selectedBand.id);
  }, [allChannels, savedChannels, selectedBand.id]);

  const scanChannels = useMemo(
    () => (config.freeScan ? uniqueScanChannels([...channels, ...FREE_SCAN_CHANNELS]) : channels),
    [channels, config.freeScan],
  );

  const selectedChannel =
    channels.find((channel) => channel.id === selectedChannelId) ??
    (manualChannel?.id === selectedChannelId ? manualChannel : null) ??
    channels[0] ??
    manualChannel ??
    null;

  const currentScanChannel =
    scannerState !== "idle" ? (scanChannels[scanIndex % Math.max(scanChannels.length, 1)] ?? null) : null;

  const isStarting = startingChannelId !== null;
  const selectedChannelIsManual = Boolean(selectedChannel?.id.startsWith("manual-"));

  useEffect(() => {
    if (!selectedChannel) {
      setSelectedChannelId(null);
      return;
    }

    if (selectedChannelId !== selectedChannel.id) {
      setSelectedChannelId(selectedChannel.id);
    }
  }, [selectedChannel, selectedChannelId]);

  function stopChannel(): void {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setPlayingChannelId(null);
    setStartingChannelId(null);
  }

  async function startChannel(channel: AirbandChannel, allowRetune = true): Promise<void> {
    if (!audioRef.current) {
      return;
    }

    setStreamError("");
    setSelectedChannelId(channel.id);
    setManualChannel(channel.id.startsWith("manual-") ? channel : null);
    setStartingChannelId(channel.id);
    setPlayingChannelId(null);

    const audio = audioRef.current;

    if (allowRetune && playingChannelId !== null) {
      try {
        const response = await fetch(buildAirbandRetuneUrl(channel), { method: "PATCH" });
        if (response.ok) {
          setPlayingChannelId(channel.id);
          setStartingChannelId(null);
          void onRefreshHardware();
          return;
        }
      } catch {
        // Fall back to a full restart if in-place retune fails.
      }
    }

    audio.pause();
    audio.src = buildAirbandUrl(channel, controls);

    try {
      await audio.play();
      setPlayingChannelId(channel.id);
      void onRefreshHardware();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      audio.removeAttribute("src");
      audio.load();
      setPlayingChannelId(null);
      setStreamError(error instanceof Error ? error.message : "Could not start AIRBAND stream.");
    } finally {
      setStartingChannelId(null);
    }
  }

  useEffect(() => {
    if (scannerState !== "scanning") {
      return;
    }

    const channel = scanChannels[scanIndex % scanChannels.length];
    if (!channel) {
      return;
    }

    void startChannel(channel, true);

    const timer = setTimeout(() => {
      if (scannerStateRef.current !== "scanning") {
        return;
      }

      const rms = hardwareRef.current?.activeStream?.telemetry?.rms ?? 0;
      if (rms > squelchRef.current) {
        setScannerState("locked");
        setScanLog((entries) => [
          {
            label: channel.label,
            freqMhz: channel.freqMhz,
            rms,
            time: new Date().toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
          },
          ...entries.slice(0, 9),
        ]);
      } else {
        const next =
          scanModeRef.current === "random"
            ? Math.floor(Math.random() * scanChannels.length)
            : (scanIndex + 1) % scanChannels.length;
        setScanIndex(next);
      }
    }, STARTUP_MS + dwellTimeRef.current * 1000);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanChannels, scanIndex, scannerState, config.selectedBandId, config.freeScan]);

  useEffect(() => {
    if (scannerState !== "locked") {
      return;
    }

    const interval = setInterval(() => {
      const rms = hardwareRef.current?.activeStream?.telemetry?.rms ?? 0;
      if (rms < squelchRef.current * 0.5) {
        const lockedIndex = scanChannels.findIndex((channel) => channel.id === playingIdRef.current);
        const base = lockedIndex >= 0 ? lockedIndex : 0;
        const next =
          scanModeRef.current === "random"
            ? Math.floor(Math.random() * scanChannels.length)
            : (base + 1) % scanChannels.length;
        setScanIndex(next);
        setScannerState("scanning");
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [scanChannels, scannerState]);

  function startScan(): void {
    if (scanChannels.length === 0) {
      return;
    }

    setManualChannel(null);
    setScanIndex(0);
    setScannerState("scanning");
  }

  function stopScan(): void {
    setScannerState("idle");
    stopChannel();
  }

  function saveManualPreset(): void {
    const parsedFreq = Number.parseFloat(config.manualFreqMhz);
    if (!inAirbandRange(parsedFreq)) {
      setStreamError("Use a frequency between 118.000 and 137.000 MHz.");
      return;
    }

    const nextPreset: SavedAirbandPreset = {
      id: `airband-${Date.now()}`,
      freqMhz: normalizeAirbandFrequency(parsedFreq),
      label: config.manualLabel.trim() || `AIRBAND ${formatAirbandFrequency(parsedFreq)}`,
      notes: config.manualNotes.trim() || "Saved locally",
      createdAt: new Date().toISOString(),
    };

    setSavedPresets((current) => [nextPreset, ...current]);
    setManualChannel(null);
    setConfig((current) => ({ ...current, selectedBandId: "saved" }));
    setSelectedChannelId(nextPreset.id);
  }

  function deleteSavedPreset(channel: AirbandChannel): void {
    if (!channel.removable) {
      return;
    }

    setSavedPresets((current) => current.filter((preset) => preset.id !== channel.id));
    if (selectedChannelId === channel.id) {
      setSelectedChannelId(null);
    }
    if (playingChannelId === channel.id) {
      stopChannel();
    }
  }

  function tuneManual(): void {
    const parsedFreq = Number.parseFloat(config.manualFreqMhz);
    if (!inAirbandRange(parsedFreq)) {
      setStreamError("Use a frequency between 118.000 and 137.000 MHz.");
      return;
    }

    if (scannerState !== "idle") {
      stopScan();
    }

    const nextManualChannel = createManualChannel(
      parsedFreq,
      config.manualLabel,
      config.manualNotes,
      config.selectedBandId,
    );
    setManualChannel(nextManualChannel);
    void startChannel(nextManualChannel, false);
  }

  function stepTune(deltaMhz: number): void {
    const baseFreq = selectedChannel?.freqMhz ?? Number.parseFloat(config.manualFreqMhz);
    if (!Number.isFinite(baseFreq)) {
      return;
    }

    if (scannerState !== "idle") {
      stopScan();
    }

    const nextFreq = normalizeAirbandFrequency(baseFreq + deltaMhz);
    setConfig((current) => ({
      ...current,
      manualFreqMhz: formatAirbandFrequency(nextFreq),
      manualLabel: selectedChannel?.label ?? current.manualLabel,
      manualNotes: selectedChannel?.notes ?? current.manualNotes,
    }));

    const nextManualChannel = createManualChannel(
      nextFreq,
      selectedChannel?.label ?? config.manualLabel,
      selectedChannel?.notes ?? config.manualNotes,
      config.selectedBandId,
    );
    setManualChannel(nextManualChannel);
    void startChannel(nextManualChannel, true);
  }

  function saveSelectedPreset(): void {
    if (!selectedChannel) {
      return;
    }

    const existing = savedPresets.find(
      (preset) => preset.freqMhz === selectedChannel.freqMhz && preset.label === selectedChannel.label,
    );
    if (existing) {
      setManualChannel(null);
      setConfig((current) => ({ ...current, selectedBandId: "saved" }));
      setSelectedChannelId(existing.id);
      return;
    }

    const nextPreset: SavedAirbandPreset = {
      id: `airband-${Date.now()}`,
      freqMhz: selectedChannel.freqMhz,
      label: selectedChannel.label,
      notes: selectedChannel.notes || "Saved locally",
      createdAt: new Date().toISOString(),
    };

    setSavedPresets((current) => [nextPreset, ...current]);
    setManualChannel(null);
    setConfig((current) => ({ ...current, selectedBandId: "saved" }));
    setSelectedChannelId(nextPreset.id);
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <audio preload="none" ref={audioRef} />

      <aside className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-white/8 bg-black/10">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--foreground)]">AIRBAND</span>
            <span className="font-mono text-[10px] text-[var(--muted)]">AM</span>
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">
            {channels.length} ch
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {AIRBAND_BANDS.map((band) => {
            const bandCount =
              band.id === "saved"
                ? savedChannels.length
                : band.id === "all"
                  ? allChannels.length
                  : getAirbandChannelsForBand(band.id).length;

            return (
              <button
                key={band.id}
                className={cx(
                  "w-full border-b border-white/[0.05] px-4 py-3 text-left transition",
                  selectedBand.id === band.id
                    ? "border-l-accent bg-[var(--accent)]/8 text-[var(--foreground)]"
                    : "border-l-clear text-[var(--muted-strong)] hover:bg-white/[0.03] hover:text-[var(--foreground)]",
                )}
                onClick={() => {
                  if (scannerState !== "idle") {
                    stopScan();
                  }
                  setManualChannel(null);
                  setSelectedChannelId(null);
                  setScanIndex(0);
                  setConfig((current) => ({ ...current, selectedBandId: band.id }));
                }}
                type="button"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-xs font-bold uppercase tracking-[0.08em]">{band.name}</p>
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">{bandCount} ch</span>
                </div>
                <p className="mt-0.5 font-mono text-[9px] leading-tight text-[var(--muted)]">{band.region}</p>
                <p className="mt-0.5 text-[10px] leading-tight text-[var(--muted)]">{band.description}</p>
              </button>
            );
          })}
        </div>

        <div className="border-t border-white/[0.07]">
          <div className="border-b border-white/[0.07] px-4 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Manual Tune</p>
          </div>
          <div className="space-y-2 px-4 py-3">
            <input
              className={CLS_INPUT}
              inputMode="decimal"
              onChange={(event) => setConfig((current) => ({ ...current, manualFreqMhz: event.target.value }))}
              placeholder="121.500"
              value={config.manualFreqMhz}
            />
            <input
              className={CLS_INPUT}
              onChange={(event) => setConfig((current) => ({ ...current, manualLabel: event.target.value }))}
              placeholder="Label"
              value={config.manualLabel}
            />
            <textarea
              className={cx(CLS_INPUT, "min-h-16 resize-none")}
              onChange={(event) => setConfig((current) => ({ ...current, manualNotes: event.target.value }))}
              placeholder="Notes..."
              value={config.manualNotes}
            />
            <div className="flex gap-2">
              <button className={cx("flex-1", CLS_BTN_PRIMARY)} onClick={tuneManual} type="button">
                ▶ Tune
              </button>
              <button className={CLS_BTN_GHOST} onClick={saveManualPreset} type="button">
                Save
              </button>
            </div>
          </div>
        </div>

        <RfControlsPanel controls={controls} onControlsChange={onControlsChange} />
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
            {selectedBand.name}
          </span>
          <span className="font-mono text-[10px] text-[var(--muted)]">{channels.length} ch</span>
        </div>

        {channels.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <div className="max-w-sm space-y-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--accent)]">Saved Presets</p>
              <p className="text-sm leading-6 text-[var(--muted)]">
                This band is empty. Tune a frequency manually and save it to keep your local airband deck ready.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {channels.map((channel) => {
              const isSelected = selectedChannel?.id === channel.id;
              const isPlaying = playingChannelId === channel.id;
              const isStartingChannel = startingChannelId === channel.id;
              const isScanningChannel = currentScanChannel?.id === channel.id;

              return (
                <div
                  key={channel.id}
                  className={cx(
                    "group flex cursor-pointer items-center gap-3 border-b border-white/[0.04] px-4 py-3 transition-colors",
                    isSelected ? "border-l-accent bg-[var(--accent)]/7" : "border-l-clear hover:bg-white/[0.025]",
                  )}
                  onClick={() => {
                    setManualChannel(null);
                    setSelectedChannelId(channel.id);
                  }}
                >
                  <span
                    className={cx(
                      "w-[5.2rem] shrink-0 font-mono text-sm font-bold tabular-nums",
                      isPlaying
                        ? "text-[var(--accent)]"
                        : isSelected
                          ? "text-[var(--foreground)]"
                          : "text-[var(--muted-strong)]",
                    )}
                  >
                    {formatAirbandFrequency(channel.freqMhz)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p
                      className={cx(
                        "truncate text-sm",
                        isSelected ? "font-semibold text-[var(--foreground)]" : "font-medium text-[var(--muted-strong)]",
                      )}
                    >
                      {channel.label}
                    </p>
                    <p className="truncate font-mono text-[10px] text-[var(--muted)]">
                      {channel.notes || "AM voice channel"}
                    </p>
                  </div>

                  {isScanningChannel && scannerState === "scanning" ? (
                    <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--muted)]">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted)]" />
                      scanning
                    </span>
                  ) : isPlaying && scannerState === "locked" ? (
                    <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--highlight)]">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--highlight)]" />
                      locked
                    </span>
                  ) : isPlaying && scannerState === "idle" ? (
                    <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--accent)]">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
                      on air
                    </span>
                  ) : null}

                  <button
                    className={cx(
                      "shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold transition",
                      isPlaying || isStartingChannel
                        ? "border-rose-400/25 bg-rose-400/[0.08] text-rose-300"
                        : "border-white/10 bg-white/[0.03] text-[var(--muted)] opacity-0 group-hover:opacity-100",
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isPlaying || isStartingChannel) {
                        stopChannel();
                        return;
                      }
                      if (scannerState !== "idle") {
                        stopScan();
                      }
                      void startChannel(channel, false);
                    }}
                    type="button"
                  >
                    {isStartingChannel ? <Spinner /> : isPlaying ? "■" : "▶"}
                  </button>

                  {channel.removable ? (
                    <button
                      className="shrink-0 rounded-full border border-rose-400/20 px-2 py-1 font-mono text-[9px] text-rose-300 opacity-0 transition hover:bg-rose-400/10 group-hover:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteSavedPreset(channel);
                      }}
                      type="button"
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </main>

      <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-white/[0.07] bg-black/15">
        <div className="border-b border-white/[0.07]">
          <div className="border-b border-white/[0.05] px-4 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Scanner</p>
          </div>
          <div className="px-4 py-3">
            {scannerState === "idle" ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full border border-white/20 bg-transparent" />
                  <span className="font-mono text-sm font-semibold text-[var(--muted-strong)]">IDLE</span>
                </div>
                {selectedChannel ? (
                  <>
                    <p className="font-mono text-2xl font-bold leading-none tabular-nums text-[var(--foreground)]">
                      {formatAirbandFrequency(selectedChannel.freqMhz)}
                      <span className="ml-1 text-sm font-normal text-[var(--muted)]">MHz</span>
                    </p>
                    <p className="text-xs text-[var(--muted)]">{selectedChannel.label}</p>
                  </>
                ) : (
                  <p className="text-xs text-[var(--muted)]">
                    Pick a starter channel or tune one manually to begin monitoring the airband.
                  </p>
                )}
              </div>
            ) : scannerState === "scanning" ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
                  <span className="font-mono text-sm font-semibold text-[var(--accent)]">SCANNING</span>
                </div>
                {currentScanChannel ? (
                  <>
                    <p className="font-mono text-2xl font-bold leading-none tabular-nums text-[var(--foreground)]">
                      {formatAirbandFrequency(currentScanChannel.freqMhz)}
                      <span className="ml-1 text-sm font-normal text-[var(--muted)]">MHz</span>
                    </p>
                    <p className="font-mono text-xs text-[var(--muted)]">
                      {currentScanChannel.label} · {config.freeScan ? "free scan" : selectedBand.name}
                    </p>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--highlight)]" />
                  <span className="font-mono text-sm font-semibold text-[var(--highlight)]">LOCKED</span>
                </div>
                {currentScanChannel ? (
                  <>
                    <p className="font-mono text-2xl font-bold leading-none tabular-nums text-[var(--foreground)]">
                      {formatAirbandFrequency(currentScanChannel.freqMhz)}
                      <span className="ml-1 text-sm font-normal text-[var(--muted)]">MHz</span>
                    </p>
                    <p className="font-mono text-xs text-[var(--muted)]">
                      {currentScanChannel.label} · voice detected
                    </p>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="border-b border-white/[0.07]">
          <div className="border-b border-white/[0.05] px-4 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Selected Channel</p>
          </div>

          {selectedChannel ? (
            <div className="space-y-3 px-4 py-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">{selectedChannel.label}</p>
                <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-[var(--foreground)]">
                  {formatAirbandFrequency(selectedChannel.freqMhz)}
                  <span className="ml-1 text-sm font-normal text-[var(--muted)]">MHz</span>
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-sm border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">
                  {selectedBand.name}
                </span>
                <span className="rounded-sm border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--accent)]">
                  AM
                </span>
              </div>

              <p className="text-sm leading-6 text-[var(--muted)]">
                {selectedChannel.notes || "Civil VHF airband voice channel."}
              </p>

              <div className="flex gap-2">
                <button
                  className={cx(
                    "flex-1 inline-flex items-center justify-center gap-2 rounded border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40",
                    scannerState !== "idle" || playingChannelId === selectedChannel.id || startingChannelId === selectedChannel.id
                      ? "border-rose-400/25 bg-rose-400/[0.08] text-rose-300 hover:border-rose-400/45"
                      : "border-[var(--accent)]/40 bg-[var(--accent)]/12 text-[var(--foreground)] hover:border-[var(--accent)]/70 hover:bg-[var(--accent)]/20",
                  )}
                  disabled={startingChannelId !== null && startingChannelId !== selectedChannel.id}
                  onClick={() => {
                    if (scannerState !== "idle") {
                      stopScan();
                      return;
                    }
                    if (playingChannelId === selectedChannel.id) {
                      stopChannel();
                      return;
                    }
                    void startChannel(selectedChannel, false);
                  }}
                  type="button"
                >
                  {scannerState !== "idle"
                    ? "Stop Scanning"
                    : startingChannelId === selectedChannel.id
                      ? <><Spinner />Starting…</>
                      : playingChannelId === selectedChannel.id
                        ? "Stop"
                        : "▶ Listen"}
                </button>

                {selectedChannel.removable ? (
                  <button className={CLS_BTN_GHOST} onClick={() => deleteSavedPreset(selectedChannel)} type="button">
                    Delete
                  </button>
                ) : selectedChannelIsManual ? (
                  <button className={CLS_BTN_GHOST} onClick={saveSelectedPreset} type="button">
                    Save
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="px-4 py-3 text-sm text-[var(--muted)]">
              Pick a starter channel or tune one manually to begin monitoring the airband.
            </p>
          )}
        </div>

        <div className="border-b border-white/[0.07]">
          <div className="border-b border-white/[0.05] px-4 py-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Quick Retune</span>
          </div>
          <div className="grid grid-cols-2 gap-2 px-4 py-3">
            <StepButton disabled={!selectedChannel || scannerState !== "idle"} onClick={() => stepTune(-0.025)}>-25 kHz</StepButton>
            <StepButton disabled={!selectedChannel || scannerState !== "idle"} onClick={() => stepTune(0.025)}>+25 kHz</StepButton>
            <StepButton disabled={!selectedChannel || scannerState !== "idle"} onClick={() => stepTune(-0.005)}>-8.33 ch</StepButton>
            <StepButton disabled={!selectedChannel || scannerState !== "idle"} onClick={() => stepTune(0.005)}>+8.33 ch</StepButton>
          </div>
          <p className="px-4 pb-3 font-mono text-[9px] leading-5 text-[var(--muted)]">
            Fast hops around the current frequency. Useful when tower, ground or advisory channels are adjacent.
          </p>
        </div>

        <div className="border-b border-white/[0.07]">
          <div className="border-b border-white/[0.05] px-4 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Scan Config</p>
          </div>
          <div className="space-y-4 px-4 py-3">
          <div>
            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">Mode</p>
            <div className="flex gap-2">
              <button
                className={cx(
                  "flex flex-1 items-center justify-center rounded border py-1.5 transition",
                  config.scanMode === "sequential"
                    ? "border-[var(--accent)]/40 bg-[var(--accent)]/12 text-[var(--foreground)]"
                    : "border-white/10 bg-white/[0.03] text-[var(--muted)] hover:bg-white/[0.05]",
                )}
                onClick={() => setConfig((current) => ({ ...current, scanMode: "sequential" }))}
                type="button"
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                  <polyline points="4,5 9,10 4,15"/>
                  <polyline points="10,5 15,10 10,15"/>
                </svg>
              </button>
              <button
                className={cx(
                  "flex flex-1 items-center justify-center rounded border py-1.5 transition",
                  config.scanMode === "random"
                    ? "border-[var(--accent)]/40 bg-[var(--accent)]/12 text-[var(--foreground)]"
                    : "border-white/10 bg-white/[0.03] text-[var(--muted)] hover:bg-white/[0.05]",
                )}
                onClick={() => setConfig((current) => ({ ...current, scanMode: "random" }))}
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
            </div>
          </div>

          <label className="flex items-start gap-3 rounded border border-white/[0.07] bg-white/[0.03] px-3 py-3">
            <input
              checked={config.freeScan}
              className="mt-0.5 h-4 w-4 rounded border-white/20 bg-transparent text-[var(--accent)] focus:ring-[var(--accent)]/40"
              type="checkbox"
              onChange={(event) => {
                const checked = event.target.checked;
                if (scannerState !== "idle") {
                  stopScan();
                }
                setScanIndex(0);
                setConfig((current) => ({ ...current, freeScan: checked }));
              }}
            />
            <span className="min-w-0">
              <span className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground)]">
                Free Scan
              </span>
              <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                Sweep the full global civil airband on a 25 kHz raster instead of only the visible channels.
              </span>
            </span>
          </label>

          <label className="block space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">Squelch</span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{config.squelch.toFixed(3)}</span>
            </div>
            <input
              className="rf-slider w-full"
              max={0.08}
              min={0.001}
              step={0.001}
              type="range"
              value={config.squelch}
              onChange={(event) => setConfig((current) => ({ ...current, squelch: Number.parseFloat(event.target.value) }))}
            />
            <p className="font-mono text-[9px] text-[var(--muted)]">
              Min RMS to lock · resume at {(config.squelch * 0.5).toFixed(3)}
            </p>
          </label>

          <label className="block space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">Dwell</span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{config.dwellTime}s</span>
            </div>
            <input
              className="rf-slider w-full"
              max={10}
              min={1}
              step={1}
              type="range"
              value={config.dwellTime}
              onChange={(event) => setConfig((current) => ({ ...current, dwellTime: Number.parseInt(event.target.value, 10) }))}
            />
            <p className="font-mono text-[9px] text-[var(--muted)]">
              Listen time per channel · ~{(STARTUP_MS / 1000 + config.dwellTime).toFixed(1)}s total
            </p>
          </label>

          <p className="font-mono text-[9px] text-[var(--muted)]">
            Scan deck: {scanChannels.length} channels{config.freeScan ? " · full-band sweep active" : ""}
          </p>
          </div>
        </div>

        <div className="border-b border-white/[0.07]">
          <div className="border-b border-white/[0.05] px-4 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Auto Scan</p>
          </div>
          <div className="px-4 py-3">
            {scannerState === "idle" ? (
              <button
                className={cx("w-full justify-center", CLS_BTN_PRIMARY)}
                disabled={isStarting || scanChannels.length === 0}
                onClick={startScan}
                type="button"
              >
                ▶ Start Scanning
              </button>
            ) : (
              <button
                className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-rose-400/25 bg-rose-400/[0.08] px-4 py-2 text-sm font-semibold text-rose-300 transition hover:border-rose-400/45"
                onClick={stopScan}
                type="button"
              >
                {scannerState === "scanning" && <Spinner />}
                Stop Scanning
              </button>
            )}
          </div>
        </div>

        <div className="border-b border-white/[0.07] px-4 py-3">
          <p className="font-mono text-[9px] leading-5 text-[var(--muted)]">
            AIRBAND reuses the shared HackRF audio pipeline in AM mode. Switching here will stop FM or PMR audio and claim the device for this stream.
          </p>
        </div>

        <div className="flex-1">
          <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Activity Log</p>
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
            <p className="px-4 py-3 text-xs text-[var(--muted)]">No activity yet.</p>
          ) : (
            <div>
              {scanLog.map((entry, index) => (
                <div key={`${entry.label}-${entry.time}-${index}`} className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-white/[0.05] px-4 py-2.5">
                  <span className="font-mono text-[11px] font-semibold text-[var(--highlight)]">{entry.label}</span>
                  <span className="font-mono text-[9px] text-[var(--muted)]">{entry.time}</span>
                  <span className="font-mono text-[11px] text-[var(--foreground)]">
                    {formatAirbandFrequency(entry.freqMhz)} MHz
                  </span>
                  <span className="font-mono text-[10px] text-[var(--accent)]">
                    RMS {entry.rms.toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {streamError ? (
          <div className="px-4 pb-3">
            <div className="rounded border border-rose-400/20 bg-rose-400/[0.08] px-4 py-3 text-sm text-rose-200">
              {streamError}
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
