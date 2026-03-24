"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { buildCustomStation, compareText, sortStations } from "@/lib/catalog";
import { PmrModule } from "@/components/pmr";
import type {
  CatalogData,
  CustomStationDraft,
  FmStation,
  HardwareStatus,
} from "@/lib/types";

const STORAGE_KEY = "hackrf-webui.custom-stations.v1";
const LOCATION_KEY = "hackrf-webui.location.v1";

type SavedLocation = {
  cityId: string;
  cityName: string;
  countryId: string;
  countryName: string;
  regionId: string;
};

const DEFAULT_DRAFT: CustomStationDraft = {
  name: "",
  freqMhz: "",
  country: "",
  city: "",
  description: "",
};

type LocationOption = { id: string; label: string; count: number };

const MODULES = [
  { id: "fm",      label: "FM",      band: "87.5–108", live: true  },
  { id: "pmr",     label: "PMR",     band: "446 MHz",  live: true  },
  { id: "ads-b",   label: "ADS-B",   band: "1090 MHz", live: false },
  { id: "ais",     label: "AIS",     band: "162 MHz",  live: false },
  { id: "airband", label: "Airband", band: "118–137",  live: false },
];

function cx(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(" ");
}

function buildStreamUrl(
  station: FmStation,
  controls: { lna: number; vga: number; audioGain: number },
): string {
  const params = new URLSearchParams({
    label: station.name,
    freqMHz: String(station.freqMhz),
    lna: String(controls.lna),
    vga: String(controls.vga),
    audioGain: String(controls.audioGain),
    t: String(Date.now()),
  });
  return `/api/stream?${params.toString()}`;
}

function downloadCustomStations(stations: FmStation[]): void {
  const blob = new Blob([JSON.stringify(stations, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "hackrf-webui-custom-stations.json";
  a.click();
  URL.revokeObjectURL(url);
}

function hwTone(state: HardwareStatus["state"] | "unknown") {
  if (state === "connected")
    return { badge: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300", dot: "bg-emerald-400", pulse: true };
  if (state === "disconnected")
    return { badge: "border-amber-400/30 bg-amber-400/10 text-amber-300", dot: "bg-amber-400", pulse: false };
  if (state !== "unknown")
    return { badge: "border-rose-400/30 bg-rose-400/10 text-rose-300", dot: "bg-rose-400", pulse: false };
  return { badge: "border-white/10 bg-white/[0.04] text-[var(--muted-strong)]", dot: "bg-slate-500", pulse: false };
}

function buildLocationOptions(
  stations: FmStation[],
  keyOf: (s: FmStation) => string,
  labelOf: (s: FmStation) => string,
): LocationOption[] {
  const map = new Map<string, LocationOption>();
  for (const s of stations) {
    const id = keyOf(s);
    const cur = map.get(id);
    if (cur) { cur.count++; continue; }
    map.set(id, { id, label: labelOf(s), count: 1 });
  }
  return [...map.values()].sort((a, b) => compareText(a.label, b.label));
}

async function fetchHardwareStatus(): Promise<HardwareStatus> {
  const res = await fetch("/api/hardware", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as HardwareStatus;
}

function readSavedLocation(): SavedLocation | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LOCATION_KEY);
  if (!raw || raw === "skipped") return null;
  try { return JSON.parse(raw) as SavedLocation; } catch { return null; }
}

function SpeakerIcon({ volume }: { volume: number }) {
  if (volume === 0) {
    return (
      <svg fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <line x1="23" x2="17" y1="9" y2="15" />
        <line x1="17" x2="23" y1="9" y2="15" />
      </svg>
    );
  }
  if (volume < 0.5) {
    return (
      <svg fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      </svg>
    );
  }
  return (
    <svg fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

function VolumeControl({
  volume,
  onChange,
}: {
  volume: number;
  onChange: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="flex items-center gap-2"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/8 text-[var(--muted)] transition hover:border-white/16 hover:text-[var(--foreground)]"
        onClick={() => onChange(volume === 0 ? 1 : 0)}
        type="button"
        title={volume === 0 ? "Unmute" : "Mute"}
      >
        <SpeakerIcon volume={volume} />
      </button>

      {/* Slide-out bar — 20px tall so overflow:hidden doesn't clip the 14px thumb */}
      <div
        style={{
          width: open ? "5rem" : 0,
          height: "20px",
          overflow: "hidden",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          opacity: open ? 1 : 0,
          transition: "width 0.2s ease-out, opacity 0.15s ease-out",
          pointerEvents: open ? "auto" : "none",
        }}
      >
        <input
          className="rf-slider"
          style={{ width: "5rem", flexShrink: 0 }}
          max={1}
          min={0}
          step={0.02}
          type="range"
          value={volume}
          onChange={e => onChange(Number.parseFloat(e.target.value))}
        />
      </div>
    </div>
  );
}

function WelcomeModal({
  stations,
  onSelect,
  onSkip,
}: {
  stations: FmStation[];
  onSelect: (loc: SavedLocation) => void;
  onSkip: () => void;
}) {
  const [search, setSearch] = useState("");

  const cityList = useMemo(() => {
    const map = new Map<string, SavedLocation & { count: number }>();
    for (const s of stations) {
      const key = s.location.cityId;
      if (!map.has(key)) {
        map.set(key, {
          cityId: s.location.cityId,
          cityName: s.location.cityName,
          countryId: s.location.countryId,
          countryName: s.location.countryName,
          regionId: s.location.regionId,
          count: 1,
        });
      } else {
        map.get(key)!.count++;
      }
    }
    return [...map.values()].sort((a, b) => compareText(a.cityName, b.cityName));
  }, [stations]);

  const q = search.trim().toLowerCase();
  const results = q
    ? cityList.filter(
        c =>
          c.cityName.toLowerCase().includes(q) ||
          c.countryName.toLowerCase().includes(q),
      )
    : cityList;

  const INPUT_MODAL =
    "w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)]/50 focus:bg-white/[0.07]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div
        className="w-[22rem] rounded-2xl border border-white/10 bg-[#080f1c] p-6 shadow-[0_32px_80px_rgba(0,0,0,0.6)]"
        style={{ boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(87,215,255,0.06)" }}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--accent)]">
          HackRF WebUI
        </p>
        <h2 className="mt-2 text-xl font-semibold text-[var(--foreground)]">
          Where are you tuning from?
        </h2>
        <p className="mt-1.5 text-sm leading-5 text-[var(--muted)]">
          Pick your city and we&apos;ll filter local stations automatically.
        </p>

        <input
          autoFocus
          className={INPUT_MODAL + " mt-4"}
          placeholder="City or country…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <div className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-white/8 bg-white/[0.02]">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[var(--muted)]">No results.</p>
          ) : (
            results.map(city => (
              <button
                key={city.cityId}
                className="flex w-full items-center justify-between border-b border-white/[0.04] px-4 py-2.5 text-left last:border-0 transition hover:bg-white/[0.04]"
                onClick={() => onSelect(city)}
                type="button"
              >
                <span className="text-sm font-medium text-[var(--foreground)]">{city.cityName}</span>
                <span className="font-mono text-[10px] text-[var(--muted)]">
                  {city.countryName} · {city.count}
                </span>
              </button>
            ))
          )}
        </div>

        <button
          className="mt-4 w-full rounded-full border border-white/8 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted)] transition hover:border-white/14 hover:text-[var(--muted-strong)]"
          onClick={onSkip}
          type="button"
        >
          Skip — show everything
        </button>
      </div>
    </div>
  );
}

const CLS_INPUT =
  "w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)]/50 focus:bg-white/[0.06]";
const CLS_BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/12 px-4 py-2 text-sm font-semibold transition hover:border-[var(--accent)]/70 hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-40";
const CLS_BTN_GHOST =
  "inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-[var(--muted-strong)] transition hover:border-white/18 hover:bg-white/[0.07]";

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z" />
    </svg>
  );
}

export function Dashboard({ catalog }: { catalog: CatalogData }) {
  const audioRef = useRef<HTMLAudioElement>(null);

  const [customStations, setCustomStations] = useState<FmStation[]>(() => {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as FmStation[];
      return Array.isArray(parsed) ? sortStations(parsed) : [];
    } catch { return []; }
  });
  const [activeModule, setActiveModule] = useState<"fm" | "pmr">("fm");

  const [showWelcome, setShowWelcome] = useState(false);
  const [savedLocation, setSavedLocation] = useState<SavedLocation | null>(null);

  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim().toLowerCase());
  const [regionFilter, setRegionFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string>(catalog.stations[0]?.id || "");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [hardware, setHardware] = useState<HardwareStatus | null>(null);
  const [hardwareError, setHardwareError] = useState("");
  const [streamError, setStreamError] = useState("");
  const [draft, setDraft] = useState<CustomStationDraft>(DEFAULT_DRAFT);
  const [showAdd, setShowAdd] = useState(false);
  const [controls, setControls] = useState({ lna: 24, vga: 20, audioGain: 1.0 });
  const [volume, setVolume] = useState(1);
  const [streamStarting, setStreamStarting] = useState(false);

  // Restore location filter from localStorage after mount (avoids SSR/client hydration mismatch)
  useEffect(() => {
    const raw = window.localStorage.getItem(LOCATION_KEY);
    if (!raw) { setShowWelcome(true); return; }
    if (raw === "skipped") return;
    try {
      const loc = JSON.parse(raw) as SavedLocation;
      setSavedLocation(loc);
      setRegionFilter(loc.regionId);
      setCountryFilter(loc.countryId);
      setCityFilter(loc.cityId);
    } catch { /* corrupt data — ignore */ }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(customStations));
  }, [customStations]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  async function refreshHardware(): Promise<void> {
    try {
      setHardware(await fetchHardwareStatus());
      setHardwareError("");
    } catch (err) {
      setHardwareError(err instanceof Error ? err.message : "Could not read HackRF status.");
    }
  }

  function stopListening(): void {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setPlayingId(null);
    setStreamStarting(false);
  }

  function resetFilters(): void {
    startTransition(() => {
      setQuery("");
      setRegionFilter("all");
      setCountryFilter("all");
      setCityFilter("all");
    });
  }

  function focusPlayingStation(): void {
    if (!playingId) return;
    const alreadyVisible = visible.some(s => s.id === playingId);
    startTransition(() => {
      // Only clear filters if the playing station is hidden by them
      if (!alreadyVisible) {
        setQuery("");
        setRegionFilter("all");
        setCountryFilter("all");
        setCityFilter("all");
      }
      setSelectedId(playingId);
    });
    // Double RAF: first frame commits state, second frame the DOM row exists
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.querySelector(`[data-station-id="${playingId}"]`)?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
    });
  }

  function handleLocationSelect(loc: SavedLocation): void {
    window.localStorage.setItem(LOCATION_KEY, JSON.stringify(loc));
    setSavedLocation(loc);
    startTransition(() => {
      setRegionFilter(loc.regionId);
      setCountryFilter(loc.countryId);
      setCityFilter(loc.cityId);
    });
    setShowWelcome(false);
  }

  function handleLocationSkip(): void {
    window.localStorage.setItem(LOCATION_KEY, "skipped");
    setShowWelcome(false);
  }

  useEffect(() => {
    let dead = false;
    const audio = audioRef.current;
    const poll = async () => {
      try {
        const data = await fetchHardwareStatus();
        if (!dead) { setHardware(data); setHardwareError(""); }
      } catch (err) {
        if (!dead) setHardwareError(err instanceof Error ? err.message : "Could not read HackRF status.");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 4_000);
    return () => {
      dead = true;
      clearInterval(timer);
      if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    };
  }, []);

  const allStations = sortStations([...customStations, ...catalog.stations]);

  const regionOpts = buildLocationOptions(allStations, s => s.location.regionId, s => s.location.regionName);
  const activeRegion = regionFilter === "all" || regionOpts.some(r => r.id === regionFilter) ? regionFilter : "all";
  const inRegion = activeRegion === "all" ? allStations : allStations.filter(s => s.location.regionId === activeRegion);

  const countryOpts = buildLocationOptions(inRegion, s => s.location.countryId, s => s.location.countryName);
  const activeCountry = countryFilter === "all" || countryOpts.some(c => c.id === countryFilter) ? countryFilter : "all";
  const inCountry = activeCountry === "all" ? inRegion : inRegion.filter(s => s.location.countryId === activeCountry);

  const cityOpts = buildLocationOptions(inCountry, s => s.location.cityId, s => s.location.cityName);
  const activeCity = cityFilter === "all" || cityOpts.some(c => c.id === cityFilter) ? cityFilter : "all";

  const visible = allStations.filter(s => {
    if (activeRegion !== "all" && s.location.regionId !== activeRegion) return false;
    if (activeCountry !== "all" && s.location.countryId !== activeCountry) return false;
    if (activeCity !== "all" && s.location.cityId !== activeCity) return false;
    if (!deferred) return true;
    return [s.name, s.location.cityName, s.location.countryName, s.location.regionName, s.description, ...s.tags]
      .join(" ").toLowerCase().includes(deferred);
  });

  const selected =
    visible.find(s => s.id === selectedId) ||
    visible[0] ||
    allStations.find(s => s.id === selectedId) ||
    allStations[0] || null;

  async function startListening(station: FmStation | null): Promise<void> {
    if (!station || !audioRef.current) return;
    setStreamError("");
    setStreamStarting(true);
    const audio = audioRef.current;
    audio.pause();
    audio.src = buildStreamUrl(station, controls);
    try {
      await audio.play();
      setPlayingId(station.id);
      void refreshHardware();
    } catch (err) {
      // AbortError = play() interrupted by a rapid pause()/src-change — safe to ignore
      if (err instanceof DOMException && err.name === "AbortError") return;
      audio.removeAttribute("src");
      audio.load();
      setPlayingId(null);
      setStreamError(err instanceof Error ? err.message : "Browser could not start audio playback.");
    } finally {
      setStreamStarting(false);
    }
  }

  function handleAddPreset(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const freq = Number.parseFloat(draft.freqMhz);
    if (!Number.isFinite(freq) || freq < 64 || freq > 108) {
      setStreamError("Frequency must be between 64 and 108 MHz.");
      return;
    }
    const station = buildCustomStation(draft, catalog);
    setCustomStations(cur => sortStations([...cur, station]));
    setDraft(DEFAULT_DRAFT);
    setSelectedId(station.id);
    setStreamError("");
    setShowAdd(false);
  }

  async function tuneDraft(): Promise<void> {
    const freq = Number.parseFloat(draft.freqMhz);
    if (!Number.isFinite(freq) || freq < 64 || freq > 108) {
      setStreamError("Frequency must be between 64 and 108 MHz.");
      return;
    }
    await startListening(buildCustomStation(draft, catalog));
  }

  function removeCustom(id: string): void {
    if (playingId === id) stopListening();
    setCustomStations(cur => cur.filter(s => s.id !== id));
  }

  const hasFilters = query.trim().length > 0 || activeRegion !== "all" || activeCountry !== "all" || activeCity !== "all";
  const telemetry = hardware?.activeStream?.telemetry ?? null;
  const hwMeta = hwTone(hardware?.state ?? "unknown");

  return (
    <div className="flex h-screen flex-col overflow-hidden">

      {/* ── Welcome modal ────────────────────────────────────────── */}
      {showWelcome ? (
        <WelcomeModal
          stations={allStations}
          onSelect={handleLocationSelect}
          onSkip={handleLocationSkip}
        />
      ) : null}

      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/8 bg-black/40 px-4 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold uppercase tracking-[0.3em] text-[var(--accent)]">HackRF</span>
          <span className="font-mono text-[10px] text-[var(--muted)] opacity-50">webui</span>
        </div>

        <div className="mx-1 h-4 w-px bg-white/10" />

        {/* Hardware status */}
        <div className={cx("flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold", hwMeta.badge)}>
          <span className={cx("h-1.5 w-1.5 rounded-full", hwMeta.dot, hwMeta.pulse && "animate-pulse")} />
          {hardware?.product || "HackRF One"}
        </div>

        {hardware?.state === "connected" && hardware.firmware ? (
          <span className="font-mono text-[10px] text-[var(--muted)]">fw&nbsp;{hardware.firmware}</span>
        ) : null}

        <div className="flex-1" />

        {/* Active stream — click to focus in list */}
        {hardware?.activeStream ? (
          <button
            className="flex items-center gap-2 rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/6 px-3 py-1 transition hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/10"
            onClick={focusPlayingStation}
            type="button"
            title="Show in station list"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
            <span className="font-mono text-sm font-bold tabular-nums text-[var(--foreground)]">
              {(hardware.activeStream.freqHz / 1_000_000).toFixed(1)}&nbsp;MHz
            </span>
            <span className="text-xs text-[var(--muted)]">{hardware.activeStream.label}</span>
          </button>
        ) : null}

        {playingId ? (
          <>
            <VolumeControl volume={volume} onChange={setVolume} />
            <button className={CLS_BTN_GHOST} onClick={stopListening} type="button">
              ■&nbsp;Stop
            </button>
          </>
        ) : null}

        <button
          className="rounded-full border border-white/8 px-3 py-1.5 font-mono text-[11px] text-[var(--muted)] transition hover:border-white/16 hover:text-[var(--foreground)]"
          onClick={() => void refreshHardware()}
          type="button"
          title="Refresh hardware status"
        >
          ↺
        </button>
      </header>

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Module sidebar ──────────────────────────────────── */}
        <nav className="flex w-[70px] shrink-0 flex-col border-r border-white/8 bg-black/20 py-2">
          {MODULES.map(mod => {
            const isActive = mod.live && activeModule === mod.id;
            return (
              <button
                key={mod.id}
                className={cx(
                  "flex flex-col items-center gap-1 px-2 py-3 text-center transition-colors",
                  isActive
                    ? "bg-[var(--accent)]/6 text-[var(--accent)] border-r-accent"
                    : mod.live
                      ? "text-[var(--muted-strong)] hover:bg-white/[0.03] hover:text-[var(--foreground)]"
                      : "cursor-not-allowed text-[var(--muted)] opacity-30",
                )}
                disabled={!mod.live}
                type="button"
                title={mod.live ? `${mod.label} · ${mod.band}` : `${mod.label} · coming soon`}
                onClick={() => {
                  if (!mod.live) return;
                  if (activeModule !== mod.id) {
                    stopListening();
                    setActiveModule(mod.id as "fm" | "pmr");
                  }
                }}
              >
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.1em]">{mod.label}</span>
                <span className="font-mono text-[8px] leading-none text-current opacity-70">{mod.band}</span>
                {!mod.live ? <span className="font-mono text-[7px] uppercase tracking-wide opacity-60">soon</span> : null}
              </button>
            );
          })}
        </nav>

        {/* ── PMR module ──────────────────────────────────────── */}
        {activeModule === "pmr" ? (
          <PmrModule
            audioRef={audioRef}
            hardware={hardware}
            onRefreshHardware={refreshHardware}
            controls={controls}
            onControlsChange={setControls}
          />
        ) : null}

        {/* ── FM content ──────────────────────────────────────── */}
        <div className={cx("flex flex-1 overflow-hidden", activeModule !== "fm" && "hidden")}>

          {/* ── Filters ─────────────────────────────────────── */}
          <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-white/8 bg-black/10">
            <div className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--muted)]">Filters</span>
                {hasFilters ? (
                  <button
                    className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--accent)] transition hover:opacity-70"
                    onClick={resetFilters}
                    type="button"
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              {/* Location pill */}
              <button
                className="flex w-full items-center gap-1.5 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 transition hover:bg-white/[0.05]"
                onClick={() => setShowWelcome(true)}
                type="button"
                title="Change location filter"
              >
                <span className="text-[11px]">📍</span>
                <span className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-[var(--muted-strong)]">
                  {savedLocation ? savedLocation.cityName : "All locations"}
                </span>
                <span className="shrink-0 font-mono text-[9px] text-[var(--muted)] opacity-60">edit</span>
              </button>

              <input
                className={CLS_INPUT}
                placeholder="Search…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />

              <select
                className={CLS_INPUT}
                value={activeRegion}
                onChange={e => {
                  const v = e.target.value;
                  startTransition(() => { setRegionFilter(v); setCountryFilter("all"); setCityFilter("all"); });
                }}
              >
                <option value="all">All regions</option>
                {regionOpts.map(r => (
                  <option key={r.id} value={r.id}>{r.label} ({r.count})</option>
                ))}
              </select>

              <select
                className={CLS_INPUT}
                value={activeCountry}
                onChange={e => {
                  const v = e.target.value;
                  startTransition(() => { setCountryFilter(v); setCityFilter("all"); });
                }}
              >
                <option value="all">All countries</option>
                {countryOpts.map(c => (
                  <option key={c.id} value={c.id}>{c.label} ({c.count})</option>
                ))}
              </select>

              <select
                className={CLS_INPUT}
                value={activeCity}
                onChange={e => setCityFilter(e.target.value)}
              >
                <option value="all">All cities</option>
                {cityOpts.map(c => (
                  <option key={c.id} value={c.id}>{c.label} ({c.count})</option>
                ))}
              </select>

              <p className="font-mono text-[10px] text-[var(--muted)]">
                {visible.length} / {allStations.length} stations
              </p>
            </div>

            {/* Add preset */}
            <div className="mt-auto border-t border-white/8">
              <button
                className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-white/[0.025]"
                onClick={() => setShowAdd(v => !v)}
                type="button"
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted-strong)]">
                  {showAdd ? "— Cancel" : "+ Add preset"}
                </span>
              </button>

              {showAdd ? (
                <form className="space-y-2 px-4 pb-4" onSubmit={handleAddPreset}>
                  <input
                    className={CLS_INPUT}
                    placeholder="Name"
                    value={draft.name}
                    onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                  />
                  <input
                    className={CLS_INPUT}
                    placeholder="Freq MHz (e.g. 99.5)"
                    value={draft.freqMhz}
                    onChange={e => setDraft(d => ({ ...d, freqMhz: e.target.value }))}
                  />
                  <input
                    className={CLS_INPUT}
                    placeholder="Country"
                    value={draft.country}
                    onChange={e => setDraft(d => ({ ...d, country: e.target.value }))}
                  />
                  <input
                    className={CLS_INPUT}
                    placeholder="City"
                    value={draft.city}
                    onChange={e => setDraft(d => ({ ...d, city: e.target.value }))}
                  />
                  <textarea
                    className={cx(CLS_INPUT, "min-h-14 resize-none")}
                    placeholder="Notes…"
                    value={draft.description}
                    onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <button className={cx("flex-1", CLS_BTN_PRIMARY)} type="submit">Save</button>
                    <button className={CLS_BTN_GHOST} onClick={() => void tuneDraft()} type="button">▶</button>
                  </div>
                </form>
              ) : null}

              {customStations.length > 0 && !showAdd ? (
                <div className="px-4 pb-4">
                  <button
                    className={cx("w-full justify-center", CLS_BTN_GHOST)}
                    onClick={() => downloadCustomStations(customStations)}
                    type="button"
                  >
                    ↓ Export JSON
                  </button>
                </div>
              ) : null}
            </div>
          </aside>

          {/* ── Station list ────────────────────────────────── */}
          <main className="flex flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-2.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">FM Broadcast</span>
              <span className="font-mono text-[10px] text-[var(--muted)]">{visible.length}</span>
            </div>

            {visible.length === 0 ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                <p className="text-sm text-[var(--muted)]">No stations match — try adjusting filters.</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                {visible.map(station => {
                  const isSel = selected?.id === station.id;
                  const isPlay = playingId === station.id;

                  return (
                    <div
                      key={station.id}
                      className={cx(
                        "group flex cursor-pointer items-center gap-3 border-b border-white/[0.045] px-4 py-3 transition-colors",
                        isSel
                          ? "bg-[var(--accent)]/7 border-l-accent"
                          : "hover:bg-white/[0.025] border-l-clear",
                      )}
                      data-station-id={station.id}
                      onClick={() => setSelectedId(station.id)}
                    >
                      {/* Frequency */}
                      <span className={cx(
                        "w-14 shrink-0 font-mono text-base font-bold tabular-nums",
                        isPlay ? "text-[var(--accent)]" : isSel ? "text-[var(--foreground)]" : "text-[var(--muted-strong)]",
                      )}>
                        {station.freqMhz.toFixed(1)}
                      </span>

                      {/* Name + location */}
                      <div className="min-w-0 flex-1">
                        <p className={cx(
                          "truncate text-sm",
                          isSel ? "font-semibold text-[var(--foreground)]" : "font-medium text-[var(--muted-strong)]",
                        )}>
                          {station.name}
                        </p>
                        <p className="truncate font-mono text-[10px] text-[var(--muted)]">
                          {station.location.cityName} · {station.location.countryCode}
                        </p>
                      </div>

                      {/* On air */}
                      {isPlay ? (
                        <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--accent)]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                          on air
                        </span>
                      ) : null}

                      {/* Play */}
                      <button
                        className={cx(
                          "shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold transition",
                          isPlay
                            ? "border-[var(--accent)]/35 bg-[var(--accent)]/10 text-[var(--accent)]"
                            : "border-white/10 bg-white/[0.03] text-[var(--muted)] opacity-0 group-hover:opacity-100",
                        )}
                        onClick={e => { e.stopPropagation(); void startListening(station); }}
                        type="button"
                      >
                        ▶
                      </button>

                      {/* Delete custom */}
                      {!station.curated ? (
                        <button
                          className="shrink-0 rounded-full border border-rose-400/20 px-2 py-1 font-mono text-[9px] text-rose-300 opacity-0 transition hover:bg-rose-400/10 group-hover:opacity-100"
                          onClick={e => { e.stopPropagation(); removeCustom(station.id); }}
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

          {/* ── Tuner panel ─────────────────────────────────── */}
          <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-white/8 bg-black/15">
            {selected ? (
              <>
                {/* Station info */}
                <div className="border-b border-white/8 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                        {selected.location.countryName}
                      </p>
                      <h2 className="mt-1 text-xl font-semibold leading-tight text-[var(--foreground)]">
                        {selected.name}
                      </h2>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">{selected.location.cityName}</p>
                    </div>
                    <div className="shrink-0 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-right">
                      <p className="font-mono text-2xl font-bold tabular-nums leading-none text-[var(--foreground)]">
                        {selected.freqMhz.toFixed(1)}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-[var(--muted)]">MHz</p>
                    </div>
                  </div>

                  {selected.description ? (
                    <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{selected.description}</p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className={cx(
                      "rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]",
                      selected.curated
                        ? "border-[var(--accent)]/25 bg-[var(--accent)]/8 text-[var(--foreground)]"
                        : "border-[var(--highlight)]/25 bg-[var(--highlight)]/8 text-[var(--foreground)]",
                    )}>
                      {selected.curated ? "curated" : "custom"}
                    </span>
                    {selected.tags.map(tag => (
                      <span key={tag} className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-[var(--muted)]">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                {/* RF controls */}
                <div className="border-b border-white/8 p-5 space-y-5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">RF Controls</p>

                  <label className="block space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">LNA</span>
                      <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{controls.lna} dB</span>
                    </div>
                    <input
                      className="rf-slider w-full"
                      max={40} min={0} step={8}
                      type="range"
                      value={controls.lna}
                      onChange={e => setControls(c => ({ ...c, lna: Number.parseInt(e.target.value, 10) }))}
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">VGA</span>
                      <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{controls.vga} dB</span>
                    </div>
                    <input
                      className="rf-slider w-full"
                      max={62} min={0} step={2}
                      type="range"
                      value={controls.vga}
                      onChange={e => setControls(c => ({ ...c, vga: Number.parseInt(e.target.value, 10) }))}
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">Volume</span>
                      <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{controls.audioGain.toFixed(1)}×</span>
                    </div>
                    <input
                      className="rf-slider w-full"
                      max={8} min={0.2} step={0.1}
                      type="range"
                      value={controls.audioGain}
                      onChange={e => setControls(c => ({ ...c, audioGain: Number.parseFloat(e.target.value) }))}
                    />
                  </label>
                </div>

                {/* Playback */}
                <div className="p-5 space-y-3">
                  <div className="flex gap-2">
                    <button
                      className={cx("flex-1 justify-center", CLS_BTN_PRIMARY)}
                      disabled={streamStarting}
                      onClick={() => void startListening(selected)}
                      type="button"
                    >
                      {streamStarting ? (
                        <><Spinner />Starting…</>
                      ) : playingId === selected.id ? "▶ Retune" : "▶ Listen"}
                    </button>
                    <button className={CLS_BTN_GHOST} onClick={stopListening} type="button">■</button>
                  </div>

                  <audio
                    className="w-full rounded-lg opacity-90"
                    controls
                    onEnded={() => setPlayingId(null)}
                    onError={() => {
                      setPlayingId(null);
                      setStreamError("Could not open stream. Check HackRF status, ffmpeg, and the native binary.");
                      void refreshHardware();
                    }}
                    preload="none"
                    ref={audioRef}
                  />

                  {streamError ? (
                    <p className="rounded-lg border border-rose-400/20 bg-rose-400/8 p-3 text-xs leading-5 text-rose-200">
                      {streamError}
                    </p>
                  ) : null}

                  {hardwareError ? (
                    <p className="rounded-lg border border-amber-400/20 bg-amber-400/8 p-3 text-xs leading-5 text-amber-200">
                      {hardwareError}
                    </p>
                  ) : null}

                  {telemetry ? (
                    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
                      <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--muted)]">Telemetry</p>
                      <div className="grid grid-cols-3 gap-1 text-center">
                        {([["RMS", telemetry.rms], ["Peak", telemetry.peak], ["RF", telemetry.rf]] as [string, number][]).map(([l, v]) => (
                          <div key={l}>
                            <p className="font-mono text-[8px] text-[var(--muted)]">{l}</p>
                            <p className="font-mono text-[11px] text-[var(--accent)]">{v.toFixed(3)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                <p className="text-sm text-[var(--muted)]">Select a station to tune</p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
