"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useRadioSession } from "@/components/use-radio-session";
import { CLS_BTN_GHOST, CLS_BTN_PRIMARY, CLS_INPUT, cx } from "@/components/module-ui";
import { INITIAL_MORSE_CATALOG } from "@/data/morse/initial-catalog";
import {
  buildMorseScanPlan,
  filterMorseCatalog,
  rankMorseCatalog,
  toMorseRadioSessionChannels,
  type MorseCatalogEntry,
  type MorseSourceClass,
} from "@/lib/morse-catalog";
import type { AudioControls } from "@/lib/radio";
import type { ResolvedAppLocation, SignalLevelTelemetry, SpectrumFrame } from "@/lib/types";

type MorseSourceFilter = "nearby" | "amateur" | "beacons" | "manual";
type MorseCatalogMode = "recommended" | "selected" | "all";
type MorseFrontEnd = "cw_carrier" | "am_tone";
type MorseMode = "manual" | "scan";

type MorseCatalogManifest = {
  countries: Array<{ code: string; name: string; entryCount: number; shardUrl: string }>;
  stats: { countryCount: number; entryCount: number };
  caution: string;
};

type MorseCountryShard = { entries: MorseCatalogEntry[] };

type MorseSessionContract = {
  id: string;
  state: string;
  mode: MorseMode;
  frontEnd: MorseFrontEnd;
  activeChannel: { id: string; label: string; freqMhz: number } | null;
  pendingChannel: { id: string; label: string; freqMhz: number } | null;
  scanner: { currentIndex?: number; channelCount: number; holdState?: string | null };
  telemetry: SignalLevelTelemetry | null;
  spectrum: SpectrumFrame | null;
  audioAvailable: boolean;
  message: string;
  lastError: string | null;
  decode: {
    text: string;
    rawMorse: string;
    confidence: number;
    dotMs: number;
    wordsPerMinute: number;
    toneHz: number;
    holdState: string;
    expectedIdentifier: string | null;
    identifierMatch: boolean | null;
  };
};

type MorseCreateContract = {
  kind: "morse";
  module: "morse";
  mode: MorseMode;
  frontEnd: MorseFrontEnd;
  controls: AudioControls;
  bandId: string;
  channels: ReturnType<typeof toMorseRadioSessionChannels>;
  scanMode: "sequential" | "random";
  manualChannelId: string | null;
  squelch: number;
  dwellTime: number;
  holdTime: number;
  location: ResolvedAppLocation | null;
};

const SOURCE_FILTERS: Array<{ id: MorseSourceFilter; label: string; sourceClasses?: MorseSourceClass[] }> = [
  { id: "nearby", label: "Nearby navigation", sourceClasses: ["aeronautical-information"] },
  { id: "amateur", label: "Amateur CW", sourceClasses: ["amateur-band-plan"] },
  { id: "beacons", label: "International beacons", sourceClasses: ["beacon"] },
  { id: "manual", label: "Manual" },
];

function formatFrequency(freqMhz: number): string {
  return `${freqMhz < 30 ? freqMhz.toFixed(3) : freqMhz.toFixed(2)} MHz`;
}

function formatConfidence(value: number | undefined): string {
  return `${Math.round(Math.max(0, Math.min(1, value ?? 0)) * 100)}%`;
}

export function MorseModule({ location }: { location: ResolvedAppLocation | null }) {
  const [sourceFilter, setSourceFilter] = useState<MorseSourceFilter>("nearby");
  const [catalogMode, setCatalogMode] = useState<MorseCatalogMode>("recommended");
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [frontEnd, setFrontEnd] = useState<MorseFrontEnd>("am_tone");
  const [scanMode, setScanMode] = useState<"sequential" | "random">("sequential");
  const [squelch, setSquelch] = useState(0.004);
  const [dwellTime, setDwellTime] = useState(5);
  const [holdTime, setHoldTime] = useState(8);
  const [localError, setLocalError] = useState("");
  const [pendingAction, setPendingAction] = useState<"manual" | "scan" | "stop" | null>(null);
  const [manifest, setManifest] = useState<MorseCatalogManifest | null>(null);
  const [countryEntries, setCountryEntries] = useState<MorseCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const currentChannelRowRef = useRef<HTMLButtonElement | null>(null);

  // The runtime MORSE union lands independently. Keep this UI compiling against the
  // current client hook while making its expected snapshot/request contract explicit.
  const radio = useRadioSession("morse") as unknown as {
    session: MorseSessionContract | null;
    error: string;
    createSession: (payload: unknown) => Promise<MorseSessionContract>;
    stopSession: () => Promise<void>;
  };
  const session = radio.session;
  const selectedCountryCode = location?.catalogScope.countryCode ?? null;

  useEffect(() => {
    let dead = false;
    void fetch("/morse/manifest.json", { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`MORSE catalog manifest failed (${response.status}).`);
        return response.json() as Promise<MorseCatalogManifest>;
      })
      .then((next) => { if (!dead) setManifest(next); })
      .catch((error) => { if (!dead) setCatalogError(error instanceof Error ? error.message : "Could not load MORSE catalog manifest."); });
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    let dead = false;
    const country = manifest?.countries.find((item) => item.code === selectedCountryCode);
    if (!country) {
      setCountryEntries([]);
      return () => { dead = true; };
    }
    setCatalogLoading(true);
    setCatalogError("");
    void fetch(country.shardUrl, { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`MORSE ${country.code} catalog failed (${response.status}).`);
        return response.json() as Promise<MorseCountryShard>;
      })
      .then((next) => { if (!dead) setCountryEntries(next.entries); })
      .catch((error) => { if (!dead) { setCountryEntries([]); setCatalogError(error instanceof Error ? error.message : "Could not load country MORSE catalog."); } })
      .finally(() => { if (!dead) setCatalogLoading(false); });
    return () => { dead = true; };
  }, [manifest, selectedCountryCode]);

  const rankedEntries = useMemo(() => {
    const filter = SOURCE_FILTERS.find((item) => item.id === sourceFilter);
    const entries = sourceFilter === "nearby" ? countryEntries : INITIAL_MORSE_CATALOG;
    return rankMorseCatalog(
      filterMorseCatalog(entries, { sourceClasses: filter?.sourceClasses, countryCode: sourceFilter === "nearby" ? selectedCountryCode ?? undefined : undefined }),
      location,
    );
  }, [countryEntries, location, selectedCountryCode, sourceFilter]);
  const selectedEntry = rankedEntries.find((item) => `morse:${item.entry.id}` === selectedChannelId) ?? null;
  const compatibleEntries = useMemo(
    () => rankedEntries.filter((item) => item.compatible),
    [rankedEntries],
  );
  const visibleEntries = useMemo(() => (
    catalogMode === "recommended"
      ? compatibleEntries.slice(0, 8)
      : catalogMode === "selected"
        ? rankedEntries.filter((item) => `morse:${item.entry.id}` === selectedChannelId)
        : rankedEntries
  ), [catalogMode, compatibleEntries, rankedEntries, selectedChannelId]);
  const scanEntries = useMemo(() => {
    if (catalogMode === "recommended") return compatibleEntries.slice(0, 8);
    if (catalogMode === "selected") {
      return compatibleEntries.filter((item) => `morse:${item.entry.id}` === selectedChannelId);
    }
    return compatibleEntries;
  }, [catalogMode, compatibleEntries, selectedChannelId]);
  const scanChannels = useMemo(() => {
    if (sourceFilter === "nearby") {
      return buildMorseScanPlan(
        scanEntries.map((item) => item.entry),
        catalogMode === "all" ? 100 : scanEntries.length,
      ).channels;
    }
    return toMorseRadioSessionChannels(scanEntries);
  }, [catalogMode, scanEntries, sourceFilter]);
  const currentChannel = session?.pendingChannel ?? session?.activeChannel ?? null;
  const activeChannelId = currentChannel?.id ?? null;
  const channelPositionLabel = session?.mode === "scan"
    ? `${Math.min((session.scanner.currentIndex ?? 0) + 1, Math.max(session.scanner.channelCount, 1))}/${session.scanner.channelCount}`
    : null;
  const running = session !== null;
  const decode = session?.decode;

  useEffect(() => {
    setFrontEnd(sourceFilter === "nearby" ? "am_tone" : "cw_carrier");
    setSelectedChannelId(null);
  }, [sourceFilter]);

  useEffect(() => {
    if (session?.mode !== "scan" || !activeChannelId) return;
    currentChannelRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeChannelId, session?.mode]);

  function buildRequest(mode: MorseMode, manualChannelId: string | null): MorseCreateContract {
    const controls: AudioControls = { lna: 24, vga: 20, audioGain: 1 };
    const manualChannels = selectedEntry
      ? toMorseRadioSessionChannels([selectedEntry])
      : [];
    return {
      kind: "morse",
      module: "morse",
      mode,
      frontEnd: frontEnd,
      controls,
      bandId: sourceFilter,
      channels: mode === "manual" ? manualChannels : scanChannels,
      scanMode,
      manualChannelId,
      squelch,
      dwellTime,
      holdTime,
      location,
    };
  }

  async function start(mode: MorseMode): Promise<void> {
    if (mode === "manual" && (!selectedEntry || !selectedEntry.compatible)) {
      setLocalError(selectedEntry?.incompatibilityReason ?? "Select a compatible tunable entry before listening.");
      return;
    }
    if (mode === "scan" && scanChannels.length === 0) {
      setLocalError("No compatible MORSE catalog entries are available in the current catalog view.");
      return;
    }
    setPendingAction(mode);
    setLocalError("");
    try {
      await radio.createSession(buildRequest(mode, mode === "manual" ? selectedChannelId : null));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not start MORSE listening.");
    } finally {
      setPendingAction(null);
    }
  }

  async function stop(): Promise<void> {
    setPendingAction("stop");
    setLocalError("");
    try {
      await radio.stopSession();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not stop MORSE listening.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-1 overflow-hidden max-[899px]:flex-col">
      <aside className="flex w-72 shrink-0 flex-col border-r border-white/8 bg-black/10 max-[899px]:w-full max-[899px]:border-b max-[899px]:border-r-0">
        <div className="border-b border-white/[0.07] px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-cyan-200">MORSE</p>
          <p className="mt-1 text-xs text-[var(--muted)]">Local CW identification and beacon monitor</p>
        </div>
        <div className="space-y-4 overflow-y-auto p-4 max-[899px]:max-h-72">
          <fieldset>
            <legend className="mb-2 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">Source</legend>
            <div className="grid gap-1.5">
              {SOURCE_FILTERS.map((item) => (
                <button aria-pressed={sourceFilter === item.id} className={cx("rounded border px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.08em] disabled:cursor-not-allowed disabled:opacity-55", sourceFilter === item.id ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100" : "border-white/10 text-[var(--muted-strong)] hover:bg-white/[0.04]")} disabled={running} key={item.id} onClick={() => setSourceFilter(item.id)} type="button">{item.label}</button>
              ))}
            </div>
          </fieldset>
          <label className="block font-mono text-[10px] text-[var(--muted)]">Front end
            <select aria-label="MORSE front end" className={cx(CLS_INPUT, "mt-1.5")} value={frontEnd} onChange={(event) => setFrontEnd(event.target.value as MorseFrontEnd)}>
              <option value="cw_carrier">CW carrier</option><option value="am_tone">AM tone</option>
            </select>
          </label>
          <label className="block font-mono text-[10px] text-[var(--muted)]">Scan order
            <select aria-label="MORSE scan order" className={cx(CLS_INPUT, "mt-1.5")} value={scanMode} onChange={(event) => setScanMode(event.target.value as "sequential" | "random")}><option value="sequential">Sequential</option><option value="random">Random</option></select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[["Squelch", squelch, setSquelch, 0.001], ["Dwell", dwellTime, setDwellTime, 1], ["Hold", holdTime, setHoldTime, 1]].map(([label, value, setter, step]) => <label className="font-mono text-[9px] text-[var(--muted)]" key={String(label)}>{String(label)}<input aria-label={`MORSE ${String(label).toLowerCase()}`} className={cx(CLS_INPUT, "mt-1 px-2 py-1.5")} min={0} step={Number(step)} type="number" value={Number(value)} onChange={(event) => (setter as (next: number) => void)(Number(event.target.value))} /></label>)}
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
          <div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Catalog monitor</p><p className="mt-1 text-xs text-[var(--muted-strong)]">{session?.message || "Idle — opening this page never starts or reclaims HackRF."}</p></div>
          <div className="flex gap-2">
            {running ? <button aria-label="Stop MORSE session" className={CLS_BTN_GHOST} disabled={pendingAction !== null} onClick={() => void stop()} type="button">■ STOP</button> : <><button aria-label="Start scanning MORSE catalog" className={CLS_BTN_PRIMARY} disabled={pendingAction !== null} onClick={() => void start("scan")} type="button">START SCANNING</button><button aria-label="Listen to selected MORSE entry" className={CLS_BTN_GHOST} disabled={pendingAction !== null} onClick={() => void start("manual")} type="button">LISTEN/START MANUAL</button></>}
          </div>
        </div>
        {(localError || radio.error || session?.lastError || catalogError) ? <p aria-live="polite" className="border-b border-rose-300/20 bg-rose-300/10 px-4 py-2 text-xs text-rose-100">{localError || session?.lastError || radio.error || catalogError}</p> : null}
        {sourceFilter === "nearby" ? <p className="border-b border-cyan-300/15 bg-cyan-300/[0.05] px-4 py-2 text-xs text-[var(--muted-strong)]">{catalogLoading ? "Loading country radio aids…" : selectedCountryCode ? `${countryEntries.length.toLocaleString()} VOR/VOR-DME/VORTAC records loaded for ${selectedCountryCode}; scans are capped at 100 deduplicated frequencies.` : "Choose a country in global location to load nearby navigation aids."} {manifest ? `Worldwide discovery: ${manifest.stats.entryCount.toLocaleString()} records across ${manifest.stats.countryCount} countries.` : ""}</p> : null}
        <div className="flex flex-wrap gap-1.5 border-b border-white/[0.07] px-4 py-2.5" role="group" aria-label="MORSE catalog view">
          {(["recommended", "selected", "all"] as MorseCatalogMode[]).map((mode) => <button aria-pressed={catalogMode === mode} className={cx("rounded border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] disabled:cursor-not-allowed disabled:opacity-55", catalogMode === mode ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100" : "border-white/10 text-[var(--muted)]")} disabled={running} key={mode} onClick={() => setCatalogMode(mode)} type="button">{mode}</button>)}
          <span className="ml-auto self-center font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--muted)]">
            {running && session.mode === "scan"
              ? `Scanning ${session.scanner.channelCount} ${catalogMode}`
              : `Scan uses ${scanChannels.length} visible compatible ${scanChannels.length === 1 ? "entry" : "entries"}`}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {visibleEntries.map((item) => {
            const channelId = `morse:${item.entry.id}`;
            const selected = selectedChannelId === channelId;
            const isScanCursor = session?.mode === "scan" && activeChannelId === channelId;
            return <button aria-current={isScanCursor ? "true" : undefined} aria-label={`Select ${item.entry.name}`} className={cx("flex w-full items-center gap-3 border-b border-white/[0.05] px-4 py-3 text-left transition-colors", isScanCursor ? "border-l-accent bg-cyan-300/[0.18] shadow-[inset_0_0_0_1px_rgba(103,232,249,0.42)]" : selected ? "border-l-accent bg-cyan-300/[0.07]" : "border-l-clear hover:bg-white/[0.03]", !item.compatible && "opacity-65")} data-scan-current={isScanCursor ? "true" : undefined} disabled={!item.compatible} key={item.entry.id} onClick={() => { setSelectedChannelId(channelId); setLocalError(""); }} ref={isScanCursor ? currentChannelRowRef : null} type="button"><span className={cx("h-2.5 w-2.5 shrink-0 rounded-full", isScanCursor ? "animate-pulse bg-cyan-100 shadow-[0_0_14px_rgba(165,243,252,1)]" : item.compatible ? "bg-emerald-300" : "bg-amber-300")} /><span className="min-w-0 flex-1"><span className={cx("block truncate text-sm", isScanCursor ? "font-bold text-cyan-50" : "text-[var(--foreground)]")}>{item.entry.name}</span><span className={cx("mt-1 block font-mono text-[10px]", isScanCursor ? "font-semibold text-cyan-50" : "text-[var(--muted)]")}>{item.entry.frequencyHz ? formatFrequency(item.entry.frequencyHz / 1_000_000) : "Segment — not tunable"}{item.distanceKm !== null ? ` · ${item.distanceKm.toFixed(0)} km` : ""}</span></span>{isScanCursor ? <span className="flex shrink-0 items-center gap-1.5 rounded border border-cyan-100/55 bg-cyan-200/20 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-cyan-50 shadow-[0_0_12px_rgba(103,232,249,0.25)]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-100" />{decode?.holdState === "SCANNING" ? "SCANNING" : decode?.holdState ?? "ACTIVE"}{channelPositionLabel ? ` ${channelPositionLabel}` : ""}</span> : <span className="max-w-52 text-right font-mono text-[9px] text-amber-200">{item.incompatibilityReason ?? (item.entry.schedule || "Compatible")}</span>}</button>;
          })}
          {visibleEntries.length === 0 ? <p className="p-5 text-sm text-[var(--muted)]">No catalog entries match this view.</p> : null}
        </div>
      </main>

      <aside className="w-80 shrink-0 border-l border-white/8 bg-[rgba(4,8,16,0.72)] max-[899px]:w-full max-[899px]:border-l-0 max-[899px]:border-t">
        <div className="border-b border-white/[0.07] px-4 py-3"><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-200">Decode evidence</p></div>
        <div className="space-y-4 p-4">
          <section><p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">Raw Morse</p><pre className="mt-1 whitespace-pre-wrap rounded border border-white/8 bg-black/20 p-3 font-mono text-sm text-cyan-100">{decode?.rawMorse || "—"}</pre></section>
          <section><p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">Decoded text</p><p className="mt-1 min-h-12 rounded border border-white/8 bg-white/[0.025] p-3 text-sm text-[var(--foreground)]">{decode?.text || "Waiting for an explicit listening session."}</p></section>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-white/8 bg-white/8">{[["Confidence", formatConfidence(decode?.confidence)], ["WPM", decode?.wordsPerMinute != null ? String(decode.wordsPerMinute) : "—"], ["Tone", decode?.toneHz != null ? `${decode.toneHz} Hz` : "—"], ["HOLD", decode?.holdState ?? session?.scanner.holdState ?? "idle"]].map(([label, value]) => <div className="bg-[rgba(4,8,16,0.92)] p-2.5" key={label}><p className="font-mono text-[8px] uppercase tracking-[0.14em] text-[var(--muted)]">{label}</p><p className="mt-1 font-mono text-xs text-[var(--foreground)]">{value}</p></div>)}</div>
          {decode?.expectedIdentifier ? <p className={cx("rounded border p-2 text-xs", decode.identifierMatch ? "border-emerald-300/25 text-emerald-100" : "border-amber-300/25 text-amber-100")}>Expected {decode.expectedIdentifier} · {decode.identifierMatch ? "match" : "no match"}</p> : null}
        </div>
      </aside>
    </div>
  );
}
