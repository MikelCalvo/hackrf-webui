"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ActivityCaptureActions, ConfirmDialog } from "@/components/module-ui";
import { CLS_INPUT } from "@/components/module-ui";
import { SpectrumDock } from "@/components/spectrum-dock";
import { useRadioSession } from "@/components/use-radio-session";
import {
  CLS_BTN_GHOST,
  CLS_BTN_PRIMARY,
  formatFixedFrequency,
  RfControlsPanel,
  Spinner,
  cx,
} from "@/components/radio-shared";
import {
  MARITIME_BANDS,
  MARITIME_EXPANDED_SCAN_CHANNELS,
  getMaritimeChannelsForBand,
  type MaritimeChannel,
} from "@/data/maritime-channels";
import {
  ACTIVITY_EVENTS_DEFAULT_LIMIT,
  clearActivityEvents as clearPersistedActivityEvents,
  fetchActivityEvents,
  type ActivityLogEntry,
} from "@/lib/activity-events";
import type {
  CreateRadioSessionRequest,
  NarrowbandScanMode,
  RadioSessionChannel,
  UpdateNarrowbandSessionRequest,
} from "@/lib/radio-session";
import { radioSessionChannelDeckSignature } from "@/lib/radio-session";
import type { AudioControls } from "@/lib/radio";
import type { ResolvedAppLocation } from "@/lib/types";
import {
  SCANNER_HOLD_GRACE_MS,
  SCANNER_POST_HIT_HOLD_DEFAULT_SECONDS,
  SCANNER_POST_HIT_HOLD_MAX_SECONDS,
  SCANNER_STARTUP_MS,
  normalizeScannerPostHitHoldSeconds,
} from "@/lib/signal-activity";
import { buildChannelSpectrumRange } from "@/lib/spectrum";

const MARITIME_STORAGE_KEY = "hackrf-webui.maritime-presets.v1";
const MARITIME_CONFIG_KEY = "hackrf-webui.maritime-config.v1";
const MARITIME_MIN_MHZ = 156.0;
const MARITIME_MAX_MHZ = 162.55;
const CONTACT_REFRESH_MS = 10_000;
type ScannerState = "idle" | "scanning" | "locked";
type ScanMode = NarrowbandScanMode;
type AllScanScope = "smart" | "full";

type PersistedConfig = {
  selectedBandId: string;
  manualFreqMhz: string;
  manualLabel: string;
  manualNotes: string;
  scanMode: ScanMode;
  allScanScope: AllScanScope;
  squelch: number;
  dwellTime: number;
  holdTime: number;
  freeScan: boolean;
};

type SavedMaritimePreset = {
  id: string;
  freqMhz: number;
  label: string;
  notes?: string;
  createdAt: string;
};

type SavedScanLocation = {
  cityId: string | null;
  cityName: string | null;
  countryId: string | null;
  countryName: string | null;
};

const DEFAULT_CONFIG: PersistedConfig = {
  selectedBandId: "common",
  manualFreqMhz: "156.800",
  manualLabel: "Channel 16",
  manualNotes: "",
  scanMode: "sequential",
  allScanScope: "smart",
  squelch: 0.006,
  dwellTime: 4,
  holdTime: SCANNER_POST_HIT_HOLD_DEFAULT_SECONDS,
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
  const raw = loadJson<Partial<PersistedConfig>>(MARITIME_CONFIG_KEY, DEFAULT_CONFIG);

  return {
    selectedBandId: typeof raw.selectedBandId === "string" ? raw.selectedBandId : DEFAULT_CONFIG.selectedBandId,
    manualFreqMhz: typeof raw.manualFreqMhz === "string" ? raw.manualFreqMhz : DEFAULT_CONFIG.manualFreqMhz,
    manualLabel: typeof raw.manualLabel === "string" ? raw.manualLabel : DEFAULT_CONFIG.manualLabel,
    manualNotes: typeof raw.manualNotes === "string" ? raw.manualNotes : DEFAULT_CONFIG.manualNotes,
    scanMode: raw.scanMode === "random" ? "random" : DEFAULT_CONFIG.scanMode,
    allScanScope: raw.allScanScope === "full" ? "full" : DEFAULT_CONFIG.allScanScope,
    squelch: Number.isFinite(raw.squelch) ? raw.squelch! : DEFAULT_CONFIG.squelch,
    dwellTime: Number.isFinite(raw.dwellTime) ? raw.dwellTime! : DEFAULT_CONFIG.dwellTime,
    holdTime: normalizeScannerPostHitHoldSeconds(raw.holdTime ?? DEFAULT_CONFIG.holdTime),
    freeScan: raw.freeScan === true,
  };
}

function formatMaritimeFrequency(freqMhz: number): string {
  return formatFixedFrequency(freqMhz, 3);
}

function inMaritimeRange(freqMhz: number): boolean {
  return Number.isFinite(freqMhz) && freqMhz >= MARITIME_MIN_MHZ && freqMhz <= MARITIME_MAX_MHZ;
}

function normalizeMaritimeFrequency(freqMhz: number): number {
  const clamped = Math.max(MARITIME_MIN_MHZ, Math.min(MARITIME_MAX_MHZ, freqMhz));
  return Number(clamped.toFixed(5));
}

function savedPresetToChannel(preset: SavedMaritimePreset, index: number): MaritimeChannel {
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
): MaritimeChannel {
  const safeFreq = normalizeMaritimeFrequency(freqMhz);
  const safeLabel = label.trim() || `MARINE ${formatMaritimeFrequency(safeFreq)}`;
  return {
    id: `manual-${safeFreq}-${safeLabel.toLowerCase().replace(/\s+/g, "-")}`,
    bandId: selectedBandId,
    number: 0,
    freqMhz: safeFreq,
    label: safeLabel,
    notes: notes.trim() || "Manual marine VHF tune",
  };
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

function uniqueChannels(channels: MaritimeChannel[]): MaritimeChannel[] {
  const byKey = new Map<string, MaritimeChannel>();

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

function uniqueScanChannels(channels: MaritimeChannel[]): MaritimeChannel[] {
  const byFrequency = new Map<string, MaritimeChannel>();

  for (const channel of channels) {
    const key = channel.freqMhz.toFixed(5);
    if (!byFrequency.has(key)) {
      byFrequency.set(key, channel);
    }
  }

  return [...byFrequency.values()].sort((left, right) => left.freqMhz - right.freqMhz);
}

function buildExpandedScanChannels(): MaritimeChannel[] {
  return MARITIME_EXPANDED_SCAN_CHANNELS
    .slice()
    .sort((left, right) => left.freqMhz - right.freqMhz || left.label.localeCompare(right.label))
    .map((channel, index) => ({
      ...channel,
      number: index + 1,
    }));
}

const FREE_SCAN_CHANNELS = buildExpandedScanChannels();

function shortenMaritimeMarkerLabel(channel: MaritimeChannel): string {
  const base = channel.label.trim();
  if (base.length <= 14) {
    return base;
  }
  return `${base.slice(0, 13)}…`;
}

function buildMaritimeSpectrumMarkers(
  channels: MaritimeChannel[],
  selectedChannelId: string | null,
  playingChannelId: string | null,
  scanChannelId: string | null,
): Array<{ freqHz: number; label: string; tone?: "accent" | "muted" | "danger" | "ops" | "weather" | "saved" }> {
  const unique = new Map<number, { freqHz: number; label: string; tone?: "accent" | "muted" | "danger" | "ops" | "weather" | "saved" }>();

  for (const channel of channels) {
    const freqHz = Math.round(channel.freqMhz * 1_000_000);
    if (unique.has(freqHz)) {
      continue;
    }
    const baseTone =
      channel.bandId === "distress"
        ? "danger"
        : channel.bandId === "portops" || channel.bandId === "usvts" || channel.bandId === "spainports"
          ? "ops"
          : channel.bandId === "weather" || channel.label.startsWith("WX")
            ? "weather"
            : channel.bandId === "saved" || channel.id.startsWith("manual-")
              ? "saved"
              : "accent";
    unique.set(freqHz, {
      freqHz,
      label: shortenMaritimeMarkerLabel(channel),
      tone:
        channel.id === playingChannelId
          ? "accent"
          : channel.id === scanChannelId
            ? "accent"
          : channel.id === selectedChannelId
            ? "accent"
            : baseTone,
    });
  }

  return Array.from(unique.values()).sort((left, right) => left.freqHz - right.freqHz);
}

function isGlobalMaritimeChannel(channel: MaritimeChannel): boolean {
  return !channel.countryIds?.length && !channel.cityIds?.length;
}

function prioritizeScopedScanChannels(
  channels: MaritimeChannel[],
  location: SavedScanLocation | null,
): MaritimeChannel[] {
  if (!location?.countryId) {
    return channels.filter(isGlobalMaritimeChannel);
  }

  const cityMatches: MaritimeChannel[] = [];
  const countryMatches: MaritimeChannel[] = [];
  const globalMatches: MaritimeChannel[] = [];
  const preferCityOnly = Boolean(location.cityId);

  for (const channel of channels) {
    if (location.cityId && channel.cityIds?.includes(location.cityId)) {
      cityMatches.push(channel);
      continue;
    }

    if (!preferCityOnly && channel.countryIds?.includes(location.countryId)) {
      countryMatches.push(channel);
      continue;
    }

    if (isGlobalMaritimeChannel(channel)) {
      globalMatches.push(channel);
    }
  }

  return [...cityMatches, ...countryMatches, ...globalMatches];
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

function formatSessionAudioUrl(sessionId: string): string {
  return `/api/radio/sessions/${encodeURIComponent(sessionId)}/audio`;
}

function toSessionChannels(channels: MaritimeChannel[]): RadioSessionChannel[] {
  return channels.map((channel) => ({
    id: channel.id,
    bandId: channel.bandId,
    number: channel.number,
    freqMhz: channel.freqMhz,
    label: channel.label,
    notes: channel.notes,
  }));
}

export function MaritimeModule({
  location,
  controls,
  onControlsChange,
}: {
  location: ResolvedAppLocation | null;
  controls: AudioControls;
  onControlsChange: (controls: AudioControls) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioSessionIdRef = useRef<string | null>(null);
  const lastSessionIdRef = useRef<string | null>(null);

  const [savedPresets, setSavedPresets] = useState<SavedMaritimePreset[]>(
    () => loadJson<SavedMaritimePreset[]>(MARITIME_STORAGE_KEY, []),
  );
  const [config, setConfig] = useState<PersistedConfig>(
    () => loadConfig(),
  );
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [streamError, setStreamError] = useState("");
  const [scanLog, setScanLog] = useState<ActivityLogEntry[]>([]);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearingActivity, setClearingActivity] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | { type: "scan" | "manual" | "stop"; channelId?: string }>(null);

  useEffect(() => {
    localStorage.setItem(MARITIME_STORAGE_KEY, JSON.stringify(savedPresets));
  }, [savedPresets]);

  useEffect(() => {
    localStorage.setItem(MARITIME_CONFIG_KEY, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    let cancelled = false;
    const refreshLog = async () => {
      try {
        const events = await fetchActivityEvents("maritime", ACTIVITY_EVENTS_DEFAULT_LIMIT);
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

  const savedScanLocation = useMemo<SavedScanLocation | null>(() => {
    const scope = location?.catalogScope;
    if (!scope?.countryId) {
      return null;
    }

    return {
      cityId: scope.cityId,
      cityName: scope.cityName,
      countryId: scope.countryId,
      countryName: scope.countryName,
    };
  }, [location]);

  const savedChannels = useMemo(
    () => uniqueChannels(savedPresets.map(savedPresetToChannel)),
    [savedPresets],
  );
  const selectedBand = useMemo(
    () => MARITIME_BANDS.find((band) => band.id === config.selectedBandId) ?? MARITIME_BANDS[0],
    [config.selectedBandId],
  );
  const allChannels = useMemo(
    () => uniqueChannels([
      ...savedChannels,
      ...MARITIME_BANDS.filter((band) => band.id !== "all" && band.id !== "saved")
        .flatMap((band) => getMaritimeChannelsForBand(band.id)),
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
    return getMaritimeChannelsForBand(selectedBand.id);
  }, [allChannels, savedChannels, selectedBand.id]);

  const smartAllScanChannels = useMemo(
    () => uniqueScanChannels(prioritizeScopedScanChannels(channels, savedScanLocation)),
    [channels, savedScanLocation],
  );

  const smartExpandedScanChannels = useMemo(
    () => uniqueScanChannels(prioritizeScopedScanChannels(FREE_SCAN_CHANNELS, savedScanLocation)),
    [savedScanLocation],
  );

  const scanChannels = useMemo(
    () => {
      if (selectedBand.id === "all" && config.allScanScope === "smart") {
        return config.freeScan
          ? uniqueScanChannels([...smartAllScanChannels, ...smartExpandedScanChannels])
          : smartAllScanChannels;
      }

      return config.freeScan ? uniqueScanChannels([...channels, ...FREE_SCAN_CHANNELS]) : channels;
    },
    [
      channels,
      config.allScanScope,
      config.freeScan,
      selectedBand.id,
      smartAllScanChannels,
      smartExpandedScanChannels,
    ],
  );
  const smartLocalMatchCount = useMemo(() => {
    if (!savedScanLocation?.countryId) {
      return 0;
    }

    if (savedScanLocation.cityId) {
      return FREE_SCAN_CHANNELS.filter((channel) =>
        Boolean(channel.cityIds?.includes(savedScanLocation.cityId!)),
      ).length;
    }

    return FREE_SCAN_CHANNELS.filter((channel) => {
      return Boolean(channel.countryIds?.includes(savedScanLocation.countryId!));
    }).length;
  }, [savedScanLocation]);

  const smartScanScopeLabel = useMemo(() => {
    if (selectedBand.id !== "all" || config.allScanScope !== "smart") {
      return null;
    }

    if (!savedScanLocation?.countryId) {
      return "Global-only scan. No shared catalog location is configured yet.";
    }

    const placeLabel = savedScanLocation.cityName ?? savedScanLocation.countryName ?? "configured location";
    if (smartLocalMatchCount > 0) {
      return savedScanLocation.cityId
        ? `Global channels plus the ${placeLabel} local maritime deck.`
        : `Global channels plus the ${placeLabel} country deck.`;
    }

    return `Global-only scan. ${placeLabel} does not have a local maritime pack yet.`;
  }, [config.allScanScope, savedScanLocation, selectedBand.id, smartLocalMatchCount]);

  const { session, error: sessionError, createSession, stopSession, updateSession } = useRadioSession("maritime", {
    onActivity(event) {
      setScanLog((entries) => [event.entry, ...entries.filter((entry) => entry.id !== event.entry.id)].slice(0, ACTIVITY_EVENTS_DEFAULT_LIMIT));
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
  const monitoringChannel = manualChannel;
  const playingChannelId = session?.mode === "manual"
    ? (session.activeChannel?.id ?? session.pendingChannel?.id ?? null)
    : scannerState === "locked"
      ? (session?.activeChannel?.id ?? null)
      : null;
  const currentScanChannelId = currentScanChannel?.id ?? null;
  const spectrumViewRange = useMemo(
    () => buildChannelSpectrumRange(scannerState !== "idle" ? scanChannels : channels),
    [channels, scanChannels, scannerState],
  );
  const spectrumMarkers = useMemo(
    () => buildMaritimeSpectrumMarkers(channels, selectedChannelId, playingChannelId, currentScanChannelId),
    [channels, currentScanChannelId, playingChannelId, selectedChannelId],
  );
  const scanDeckSignature = useMemo(
    () => radioSessionChannelDeckSignature(toSessionChannels(scanChannels)),
    [scanChannels],
  );
  const selectedChannel =
    channels.find((channel) => channel.id === selectedChannelId) ??
    (manualChannel?.id === selectedChannelId ? manualChannel : null) ??
    null;
  const selectedChannelIsManual = Boolean(selectedChannel?.id.startsWith("manual-"));
  const isBusy = pendingAction !== null;
  const startingChannelId = pendingAction?.type === "manual" ? pendingAction.channelId ?? null : null;

  useEffect(() => {
    if (!selectedChannelId) {
      return;
    }

    if (!selectedChannel) {
      setSelectedChannelId(null);
    }
  }, [selectedChannel, selectedChannelId]);

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
      setStreamError("Could not open MARITIME session audio.");
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

  async function handleClearActivity(): Promise<void> {
    setClearingActivity(true);
    try {
      await clearPersistedActivityEvents("maritime");
      setScanLog([]);
      setClearDialogOpen(false);
    } finally {
      setClearingActivity(false);
    }
  }

  useEffect(() => {
    if (session?.bandId && session.bandId !== config.selectedBandId) {
      setConfig((current) => ({ ...current, selectedBandId: session.bandId }));
    }
  }, [config.selectedBandId, session?.bandId]);

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
    if (session.squelch !== config.squelch) {
      patch.squelch = config.squelch;
      hasChanges = true;
    }
    if (session.dwellTime !== config.dwellTime) {
      patch.dwellTime = config.dwellTime;
      hasChanges = true;
    }
    if (session.holdTime !== config.holdTime) {
      patch.holdTime = config.holdTime;
      hasChanges = true;
    }
    if (session.scanMode !== config.scanMode) {
      patch.scanMode = config.scanMode;
      hasChanges = true;
    }
    if (session.mode === "scan" && session.bandId !== config.selectedBandId) {
      patch.bandId = config.selectedBandId;
      hasChanges = true;
    }
    if (session.mode === "scan" && session.channelDeckSignature !== scanDeckSignature) {
      patch.channels = toSessionChannels(scanChannels);
      hasChanges = true;
    }

    if (!hasChanges) {
      return;
    }

    void updateSession(patch).catch((error) => {
      setStreamError(error instanceof Error ? error.message : "Could not update MARITIME session.");
    });
  }, [config.dwellTime, config.holdTime, config.scanMode, config.selectedBandId, config.squelch, controls, scanChannels, scanDeckSignature, session, updateSession]);

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
      setStreamError(error instanceof Error ? error.message : "Could not start MARITIME session audio.");
    });
  }, [session, shouldPlaySessionAudio]);

  useEffect(() => {
    if (pendingAction && session && session.state !== "starting" && session.state !== "tuning") {
      setPendingAction(null);
    }
  }, [pendingAction, session]);

  function buildSessionChannels(mode: "manual" | "scan", manual: MaritimeChannel | null): MaritimeChannel[] {
    if (mode === "scan") {
      return scanChannels;
    }
    return manual ? [...channels, manual] : channels;
  }

  function buildSessionRequest(
    mode: "manual" | "scan",
    manual: MaritimeChannel | null = null,
  ): CreateRadioSessionRequest {
    const sessionChannels = buildSessionChannels(mode, manual);
    return {
      kind: "narrowband",
      module: "maritime",
      mode,
      controls,
      bandId: config.selectedBandId,
      channels: toSessionChannels(sessionChannels),
      scanMode: config.scanMode,
      manualChannelId: manual?.id ?? null,
      squelch: config.squelch,
      dwellTime: config.dwellTime,
      holdTime: config.holdTime,
      location,
    };
  }

  async function startManualChannel(channel: MaritimeChannel): Promise<void> {
    setPendingAction({ type: "manual", channelId: channel.id });
    setStreamError("");
    setSelectedChannelId(channel.id);
    try {
      await createSession(buildSessionRequest("manual", channel.id.startsWith("manual-") ? channel : null));
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "Could not start MARITIME manual session.");
      setPendingAction(null);
    }
  }

  async function startScan(): Promise<void> {
    if (scanChannels.length === 0) {
      return;
    }
    setPendingAction({ type: "scan" });
    setStreamError("");
    try {
      await createSession(buildSessionRequest("scan"));
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "Could not start MARITIME scan session.");
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
      setStreamError(error instanceof Error ? error.message : "Could not stop MARITIME session.");
    } finally {
      setPendingAction(null);
    }
  }

  function saveManualPreset(): void {
    const parsedFreq = Number.parseFloat(config.manualFreqMhz);
    if (!inMaritimeRange(parsedFreq)) {
      setStreamError("Use a frequency between 156.000 and 162.550 MHz.");
      return;
    }

    const nextPreset: SavedMaritimePreset = {
      id: `maritime-${Date.now()}`,
      freqMhz: normalizeMaritimeFrequency(parsedFreq),
      label: config.manualLabel.trim() || `MARINE ${formatMaritimeFrequency(parsedFreq)}`,
      notes: config.manualNotes.trim() || "Saved locally",
      createdAt: new Date().toISOString(),
    };

    setSavedPresets((current) => [nextPreset, ...current]);
    setConfig((current) => ({ ...current, selectedBandId: "saved" }));
    setSelectedChannelId(nextPreset.id);
  }

  function deleteSavedPreset(channel: MaritimeChannel): void {
    if (!channel.removable) {
      return;
    }

    if (session && (scannerState !== "idle" || playingChannelId === channel.id)) {
      void stopManagedSession();
    }
    setSavedPresets((current) => current.filter((preset) => preset.id !== channel.id));
    if (selectedChannelId === channel.id) {
      setSelectedChannelId(null);
    }
  }

  async function tuneManual(): Promise<void> {
    const parsedFreq = Number.parseFloat(config.manualFreqMhz);
    if (!inMaritimeRange(parsedFreq)) {
      setStreamError("Use a frequency between 156.000 and 162.550 MHz.");
      return;
    }

    const nextManualChannel = createManualChannel(
      parsedFreq,
      config.manualLabel,
      config.manualNotes,
      config.selectedBandId,
    );
    setSelectedChannelId(nextManualChannel.id);
    setPendingAction({ type: "manual", channelId: nextManualChannel.id });
    setStreamError("");
    try {
      await createSession(buildSessionRequest("manual", nextManualChannel));
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "Could not start MARITIME manual session.");
      setPendingAction(null);
    }
  }

  async function stepTune(deltaMhz: number): Promise<void> {
    const baseFreq = selectedChannel?.freqMhz ?? Number.parseFloat(config.manualFreqMhz);
    if (!Number.isFinite(baseFreq)) {
      return;
    }

    const nextFreq = normalizeMaritimeFrequency(baseFreq + deltaMhz);
    setConfig((current) => ({
      ...current,
      manualFreqMhz: formatMaritimeFrequency(nextFreq),
      manualLabel: selectedChannel?.label ?? current.manualLabel,
      manualNotes: selectedChannel?.notes ?? current.manualNotes,
    }));

    const nextManualChannel = createManualChannel(
      nextFreq,
      selectedChannel?.label ?? config.manualLabel,
      selectedChannel?.notes ?? config.manualNotes,
      config.selectedBandId,
    );
    setSelectedChannelId(nextManualChannel.id);
    setPendingAction({ type: "manual", channelId: nextManualChannel.id });
    setStreamError("");
    try {
      await createSession(buildSessionRequest("manual", nextManualChannel));
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "Could not start MARITIME manual session.");
      setPendingAction(null);
    }
  }

  function saveSelectedPreset(): void {
    if (!selectedChannel) {
      return;
    }

    const existing = savedPresets.find(
      (preset) => preset.freqMhz === selectedChannel.freqMhz && preset.label === selectedChannel.label,
    );
    if (existing) {
      setConfig((current) => ({ ...current, selectedBandId: "saved" }));
      setSelectedChannelId(existing.id);
      return;
    }

    const nextPreset: SavedMaritimePreset = {
      id: `maritime-${Date.now()}`,
      freqMhz: selectedChannel.freqMhz,
      label: selectedChannel.label,
      notes: selectedChannel.notes || "Saved locally",
      createdAt: new Date().toISOString(),
    };

    setSavedPresets((current) => [nextPreset, ...current]);
    setConfig((current) => ({ ...current, selectedBandId: "saved" }));
    setSelectedChannelId(nextPreset.id);
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <audio preload="none" ref={audioRef} />

      <aside className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-white/8 bg-black/10">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--foreground)]">MARITIME</span>
            <span className="font-mono text-[10px] text-[var(--muted)]">NFM</span>
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">
            {channels.length} ch
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {MARITIME_BANDS.map((band) => {
            const bandCount =
              band.id === "saved"
                ? savedChannels.length
                : band.id === "all"
                  ? allChannels.length
                  : getMaritimeChannelsForBand(band.id).length;

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
                  if (session) {
                    void stopManagedSession();
                  } else {
                    stopAudioElement();
                  }
                  setSelectedChannelId(null);
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
              placeholder="156.800"
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
                This band is empty. Tune a frequency manually and save it to build your local marine VHF deck.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {channels.map((channel) => {
              const isSelected = selectedChannel?.id === channel.id;
              const isPlaying = playingChannelId === channel.id;
              const isStartingChannel = startingChannelId === channel.id;
              const isScanningChannel = currentScanChannelId === channel.id;

              return (
                <div
                  key={channel.id}
                  className={cx(
                    "group flex cursor-pointer items-center gap-3 border-b border-white/[0.04] px-4 py-3 transition-colors",
                    isSelected ? "border-l-accent bg-[var(--accent)]/7" : "border-l-clear hover:bg-white/[0.025]",
                  )}
                  onClick={() => {
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
                    {formatMaritimeFrequency(channel.freqMhz)}
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
                      {channel.notes || "Marine VHF voice channel"}
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
                      if (session?.mode === "manual" && isPlaying) {
                        void stopManagedSession();
                        return;
                      }
                      void startManualChannel(channel);
                    }}
                    type="button"
                  >
                    {isStartingChannel ? <Spinner /> : isPlaying && session?.mode === "manual" ? "■" : "▶"}
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

        <SpectrumDock
          expectedDemodMode="nfm"
          expectedOwner="audio"
          lockViewToRange={scannerState !== "idle"}
          maxZoom={24}
          markers={spectrumMarkers}
          moduleId="maritime"
          viewRangeHz={spectrumViewRange}
        />
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
                  <span
                    className={cx(
                      "h-2 w-2 rounded-full",
                      manualActivityRms !== null
                        ? "bg-[var(--highlight)] animate-pulse"
                        : monitoringChannel
                          ? "bg-[var(--accent)]/80"
                          : "border border-white/20 bg-transparent",
                    )}
                  />
                  <span
                    className={cx(
                      "font-mono text-sm font-semibold",
                      manualActivityRms !== null
                        ? "text-[var(--highlight)]"
                        : monitoringChannel
                          ? "text-[var(--accent)]"
                          : "text-[var(--muted-strong)]",
                    )}
                  >
                    {manualActivityRms !== null ? "ACTIVITY" : monitoringChannel ? "MONITORING" : "IDLE"}
                  </span>
                </div>
                {monitoringChannel ? (
                  <>
                    <p className="font-mono text-2xl font-bold leading-none tabular-nums text-[var(--foreground)]">
                      {formatMaritimeFrequency(monitoringChannel.freqMhz)}
                      <span className="ml-1 text-sm font-normal text-[var(--muted)]">MHz</span>
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {monitoringChannel.label} · {manualActivityRms !== null ? "live activity detected" : "monitoring fixed maritime channel"}
                    </p>
                    {manualActivityRms !== null ? (
                      <p className="font-mono text-xs text-[var(--highlight)]">
                        RMS {manualActivityRms.toFixed(4)} · live monitor
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-xs text-[var(--muted)]">
                    Pick a starter channel or tune one manually to begin monitoring marine VHF voice traffic.
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
                      {formatMaritimeFrequency(currentScanChannel.freqMhz)}
                      <span className="ml-1 text-sm font-normal text-[var(--muted)]">MHz</span>
                    </p>
                    <p className="font-mono text-xs text-[var(--muted)]">
                      {currentScanChannel.label} · {
                        config.freeScan
                          ? selectedBand.id === "all" && config.allScanScope === "smart"
                            ? "expanded deck · smart local"
                            : "expanded deck"
                          : selectedBand.id === "all" && config.allScanScope === "smart"
                            ? "all · smart local"
                            : selectedBand.name
                      }
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
                      {formatMaritimeFrequency(currentScanChannel.freqMhz)}
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

        <div className="border-b border-white/[0.07]">
          <div className="border-b border-white/[0.05] px-4 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Selected Channel</p>
          </div>

          {selectedChannel ? (
            <div className="space-y-3 px-4 py-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">{selectedChannel.label}</p>
                <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-[var(--foreground)]">
                  {formatMaritimeFrequency(selectedChannel.freqMhz)}
                  <span className="ml-1 text-sm font-normal text-[var(--muted)]">MHz</span>
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-sm border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">
                  {selectedBand.name}
                </span>
                <span className="rounded-sm border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--accent)]">
                  NFM
                </span>
              </div>

              <p className="text-sm leading-6 text-[var(--muted)]">
                {selectedChannel.notes || "Marine VHF voice channel."}
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
                      void stopManagedSession();
                      return;
                    }
                    if (session?.mode === "manual" && playingChannelId === selectedChannel.id) {
                      void stopManagedSession();
                      return;
                    }
                    void startManualChannel(selectedChannel);
                  }}
                  type="button"
                >
                  {scannerState !== "idle"
                    ? "Stop Scanning"
                    : startingChannelId === selectedChannel.id
                      ? <><Spinner />Starting…</>
                      : session?.mode === "manual" && playingChannelId === selectedChannel.id
                        ? "Stop"
                        : "▶ Listen"}
                </button>

                {channels.find((channel) => channel.id === selectedChannel.id)?.removable ? (
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
              Pick a starter channel or tune one manually to begin monitoring marine VHF voice traffic.
            </p>
          )}
        </div>

        <div className="border-b border-white/[0.07]">
          <div className="border-b border-white/[0.05] px-4 py-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Quick Retune</span>
          </div>
          <div className="grid grid-cols-2 gap-2 px-4 py-3">
            <StepButton disabled={!selectedChannel || scannerState !== "idle"} onClick={() => stepTune(-0.050)}>-50 kHz</StepButton>
            <StepButton disabled={!selectedChannel || scannerState !== "idle"} onClick={() => stepTune(-0.025)}>-25 kHz</StepButton>
            <StepButton disabled={!selectedChannel || scannerState !== "idle"} onClick={() => stepTune(0.025)}>+25 kHz</StepButton>
            <StepButton disabled={!selectedChannel || scannerState !== "idle"} onClick={() => stepTune(0.050)}>+50 kHz</StepButton>
          </div>
          <p className="px-4 pb-3 font-mono text-[9px] leading-5 text-[var(--muted)]">
            Fast hops around the current frequency. Useful when nearby port, bridge or working channels sit on adjacent steps.
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

          {selectedBand.id === "all" ? (
            <div>
              <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">All Scan Scope</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={cx(
                    "rounded border px-3 py-2 text-left transition",
                    config.allScanScope === "smart"
                      ? "border-[var(--accent)]/40 bg-[var(--accent)]/12 text-[var(--foreground)]"
                      : "border-white/10 bg-white/[0.03] text-[var(--muted)] hover:bg-white/[0.05]",
                  )}
                  onClick={() => setConfig((current) => ({ ...current, allScanScope: "smart" }))}
                  type="button"
                >
                  <span className="block font-mono text-[10px] uppercase tracking-[0.16em]">Smart Local</span>
                  <span className="mt-1 block text-[11px] leading-5 opacity-80">
                    Global watch channels plus the shared city deck, or the shared country deck if no city is set.
                  </span>
                </button>
                <button
                  className={cx(
                    "rounded border px-3 py-2 text-left transition",
                    config.allScanScope === "full"
                      ? "border-[var(--accent)]/40 bg-[var(--accent)]/12 text-[var(--foreground)]"
                      : "border-white/10 bg-white/[0.03] text-[var(--muted)] hover:bg-white/[0.05]",
                  )}
                  onClick={() => setConfig((current) => ({ ...current, allScanScope: "full" }))}
                  type="button"
                >
                  <span className="block font-mono text-[10px] uppercase tracking-[0.16em]">Full Deck</span>
                  <span className="mt-1 block text-[11px] leading-5 opacity-80">
                    Scan every built-in regional pack, including unrelated foreign decks.
                  </span>
                </button>
              </div>
              {smartScanScopeLabel ? (
                <p className="mt-2 font-mono text-[9px] leading-5 text-[var(--muted)]">
                  {smartScanScopeLabel}
                </p>
              ) : null}
            </div>
          ) : null}

          <label className="flex items-start gap-3 rounded border border-white/[0.07] bg-white/[0.03] px-3 py-3">
            <input
              checked={config.freeScan}
              className="mt-0.5 h-4 w-4 rounded border-white/20 bg-transparent text-[var(--accent)] focus:ring-[var(--accent)]/40"
              type="checkbox"
              onChange={(event) => {
                const checked = event.target.checked;
                setConfig((current) => ({ ...current, freeScan: checked }));
              }}
            />
            <span className="min-w-0">
              <span className="block font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground)]">
                Expanded Deck
              </span>
              <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                Expand autoscan beyond the visible band and include the wider built-in marine voice decks for the selected scope.
              </span>
            </span>
          </label>

          <label className="block space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">Squelch</span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{config.squelch.toFixed(4)}</span>
            </div>
            <input
              className="rf-slider w-full"
              max={0.08}
              min={0.0005}
              step={0.0005}
              type="range"
              value={config.squelch}
              onChange={(event) => setConfig((current) => ({ ...current, squelch: Number.parseFloat(event.target.value) }))}
            />
            <p className="font-mono text-[9px] text-[var(--muted)]">
              RMS activity threshold · hold for {(SCANNER_HOLD_GRACE_MS / 1000).toFixed(1)}s after last activity
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
              Max listen time per channel · ~{(SCANNER_STARTUP_MS / 1000 + config.dwellTime).toFixed(1)}s total
            </p>
          </label>

          <label className="block space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">Hold</span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{config.holdTime}s</span>
            </div>
            <input
              className="rf-slider w-full"
              max={SCANNER_POST_HIT_HOLD_MAX_SECONDS}
              min={0}
              step={1}
              type="range"
              value={config.holdTime}
              onChange={(event) => setConfig((current) => ({
                ...current,
                holdTime: normalizeScannerPostHitHoldSeconds(Number.parseInt(event.target.value, 10)),
              }))}
            />
            <p className="font-mono text-[9px] text-[var(--muted)]">
              Minimum extra lock after a hit · release still waits for {(SCANNER_HOLD_GRACE_MS / 1000).toFixed(1)}s silence
            </p>
          </label>

          <p className="font-mono text-[9px] text-[var(--muted)]">
            Scan deck: {scanChannels.length} channels
            {selectedBand.id === "all" && config.allScanScope === "smart" ? " · smart local" : ""}
            {config.freeScan ? " · expanded deck active" : ""}
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
                disabled={isBusy || scanChannels.length === 0}
                onClick={() => void startScan()}
                type="button"
              >
                ▶ Start Scanning
              </button>
            ) : (
              <button
                className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-rose-400/25 bg-rose-400/[0.08] px-4 py-2 text-sm font-semibold text-rose-300 transition hover:border-rose-400/45"
                disabled={isBusy}
                onClick={() => void stopManagedSession()}
                type="button"
              >
                {(pendingAction?.type === "stop" || scannerState === "scanning") && <Spinner />}
                Stop Scanning
              </button>
            )}
          </div>
        </div>

        <div className="border-b border-white/[0.07] px-4 py-3">
          <p className="font-mono text-[9px] leading-5 text-[var(--muted)]">
            MARITIME reuses the shared HackRF audio pipeline in narrow FM mode. AIS and DSC digital channels are intentionally excluded here; use AIS for vessel data and keep this module focused on voice traffic.
          </p>
        </div>

        <div className="flex-1">
          <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Contacts</p>
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
            <p className="px-4 py-3 text-xs text-[var(--muted)]">No contacts yet.</p>
          ) : (
            <div>
              {scanLog.map((entry) => (
                <div key={entry.id} className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-white/[0.05] px-4 py-2.5">
                  <span className="font-mono text-[11px] font-semibold text-[var(--highlight)]">{entry.label}</span>
                  <span className="font-mono text-[9px] text-[var(--muted)]">{entry.time}</span>
                  <span className="font-mono text-[11px] text-[var(--foreground)]">
                    {formatMaritimeFrequency(entry.freqMhz)} MHz
                  </span>
                  <span className="font-mono text-[10px] text-[var(--accent)]">
                    RMS {entry.rms.toFixed(4)}
                  </span>
                  <div className="col-span-2">
                    <ActivityCaptureActions entry={entry} />
                  </div>
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

      <ConfirmDialog
        busy={clearingActivity}
        cancelLabel="Keep Log"
        confirmLabel="Delete Activity"
        description="This clears the MARITIME contacts from the current view, removes the stored entries from the local SQLite database, and deletes any linked WAV/IQ capture files."
        onCancel={() => {
          if (!clearingActivity) {
            setClearDialogOpen(false);
          }
        }}
        onConfirm={() => void handleClearActivity()}
        open={clearDialogOpen}
        title="Delete MARITIME activity log?"
      />
    </div>
  );
}
