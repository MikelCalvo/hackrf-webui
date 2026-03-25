"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  buildCustomStation,
  compareText,
  hydrateCountryShard,
  sortStations,
} from "@/lib/catalog";
import {
  APP_MODULES,
  getCookieHeaderForModule,
  LAST_MODULE_STORAGE_KEY,
  type AppModuleId,
} from "@/lib/modules";
import type {
  CatalogCountryShard,
  CatalogCountrySummary,
  CatalogData,
  CatalogManifest,
  CustomStationDraft,
  FmStation,
  HardwareStatus,
} from "@/lib/types";

const STORAGE_KEY = "hackrf-webui.custom-stations.v1";
const LOCATION_KEY = "hackrf-webui.location.v1";
const STATION_ROW_HEIGHT = 76;
const STATION_LIST_OVERSCAN = 10;

type SavedLocation = {
  cityId: string;
  cityName: string;
  countryId: string;
  countryName: string;
  regionId: string;
};

type LocationOption = { id: string; label: string; count: number };
type CountryOption = LocationOption & { regionId: string };

type LoadedCountryCatalog = {
  catalog: CatalogData;
  shard: CatalogCountryShard;
};

const DEFAULT_DRAFT: CustomStationDraft = {
  name: "",
  freqMhz: "",
  country: "",
  city: "",
  description: "",
};

const numberFormatter = new Intl.NumberFormat("en");

function ModulePanelLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center">
      <div className="space-y-3">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.03]">
          <Spinner />
        </div>
        <p className="text-sm text-[var(--muted)]">Loading {label}...</p>
      </div>
    </div>
  );
}

const PmrModule = dynamic(
  () => import("@/components/pmr").then((mod) => mod.PmrModule),
  {
    ssr: false,
    loading: () => <ModulePanelLoading label="PMR" />,
  },
);

const AisModule = dynamic(
  () => import("@/components/ais").then((mod) => mod.AisModule),
  {
    ssr: false,
    loading: () => <ModulePanelLoading label="AIS" />,
  },
);

const AdsbModule = dynamic(
  () => import("@/components/adsb").then((mod) => mod.AdsbModule),
  {
    ssr: false,
    loading: () => <ModulePanelLoading label="ADS-B" />,
  },
);

function cx(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(" ");
}

function formatCount(value: number): string {
  return numberFormatter.format(value);
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
  const blob = new Blob([JSON.stringify(stations, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "hackrf-webui-custom-stations.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

function hwTone(state: HardwareStatus["state"] | "unknown") {
  if (state === "connected") {
    return {
      badge: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
      dot: "bg-emerald-400",
      pulse: true,
    };
  }

  if (state === "disconnected") {
    return {
      badge: "border-amber-400/30 bg-amber-400/10 text-amber-300",
      dot: "bg-amber-400",
      pulse: false,
    };
  }

  if (state !== "unknown") {
    return {
      badge: "border-rose-400/30 bg-rose-400/10 text-rose-300",
      dot: "bg-rose-400",
      pulse: false,
    };
  }

  return {
    badge: "border-white/10 bg-white/[0.04] text-[var(--muted-strong)]",
    dot: "bg-slate-500",
    pulse: false,
  };
}

function mergeLocationOption(
  map: Map<string, LocationOption>,
  option: LocationOption,
): void {
  const existing = map.get(option.id);
  if (existing) {
    existing.count += option.count;
    return;
  }

  map.set(option.id, { ...option });
}

function buildRegionOptions(
  manifest: CatalogManifest,
  customStations: FmStation[],
): LocationOption[] {
  const regionsById = new Map(manifest.regions.map((region) => [region.id, region]));
  const options = new Map<string, LocationOption>();

  for (const country of manifest.countries) {
    const region = regionsById.get(country.regionId);
    if (!region) {
      continue;
    }

    mergeLocationOption(options, {
      id: region.id,
      label: region.name,
      count: country.stationCount,
    });
  }

  for (const station of customStations) {
    mergeLocationOption(options, {
      id: station.location.regionId,
      label: station.location.regionName,
      count: 1,
    });
  }

  return [...options.values()].sort((left, right) => compareText(left.label, right.label));
}

function buildCountryOptions(
  manifest: CatalogManifest,
  activeRegion: string,
  customStations: FmStation[],
): CountryOption[] {
  const options = new Map<string, CountryOption>();

  for (const country of manifest.countries) {
    if (activeRegion !== "all" && country.regionId !== activeRegion) {
      continue;
    }

    options.set(country.id, {
      id: country.id,
      label: country.name,
      count: country.stationCount,
      regionId: country.regionId,
    });
  }

  for (const station of customStations) {
    if (activeRegion !== "all" && station.location.regionId !== activeRegion) {
      continue;
    }

    const existing = options.get(station.location.countryId);
    if (existing) {
      existing.count += 1;
      continue;
    }

    options.set(station.location.countryId, {
      id: station.location.countryId,
      label: station.location.countryName,
      count: 1,
      regionId: station.location.regionId,
    });
  }

  return [...options.values()].sort((left, right) => compareText(left.label, right.label));
}

function buildCityOptions(
  shard: CatalogCountryShard | null,
  activeCountry: string,
  customStations: FmStation[],
): LocationOption[] {
  const options = new Map<string, LocationOption>();

  if (shard) {
    for (const city of shard.cities) {
      options.set(city.id, {
        id: city.id,
        label: city.name,
        count: city.stationCount,
      });
    }
  }

  if (activeCountry === "all") {
    return [...options.values()].sort((left, right) => compareText(left.label, right.label));
  }

  for (const station of customStations) {
    if (station.location.countryId !== activeCountry) {
      continue;
    }

    mergeLocationOption(options, {
      id: station.location.cityId,
      label: station.location.cityName,
      count: 1,
    });
  }

  return [...options.values()].sort((left, right) => compareText(left.label, right.label));
}

function matchesStationSearch(station: FmStation, query: string): boolean {
  if (!query) {
    return true;
  }

  return [
    station.name,
    station.location.cityName,
    station.location.countryName,
    station.location.regionName,
    station.description,
    ...station.tags,
  ]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

async function fetchHardwareStatus(): Promise<HardwareStatus> {
  const res = await fetch("/api/hardware", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return (await res.json()) as HardwareStatus;
}

function SpeakerIcon({ volume }: { volume: number }) {
  if (volume === 0) {
    return (
      <svg
        fill="none"
        height="14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width="14"
      >
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <line x1="23" x2="17" y1="9" y2="15" />
        <line x1="17" x2="23" y1="9" y2="15" />
      </svg>
    );
  }

  if (volume < 0.5) {
    return (
      <svg
        fill="none"
        height="14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width="14"
      >
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      </svg>
    );
  }

  return (
    <svg
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="14"
    >
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
  onChange: (value: number) => void;
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
        title={volume === 0 ? "Unmute" : "Mute"}
        type="button"
      >
        <SpeakerIcon volume={volume} />
      </button>

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
          max={1}
          min={0}
          step={0.02}
          style={{ width: "5rem", flexShrink: 0 }}
          type="range"
          value={volume}
          onChange={(event) => onChange(Number.parseFloat(event.target.value))}
        />
      </div>
    </div>
  );
}

function WelcomeModal({
  manifest,
  onSelect,
  onLoadCountry,
  onSkip,
}: {
  manifest: CatalogManifest;
  onSelect: (location: SavedLocation) => void;
  onLoadCountry: (countryId: string) => Promise<CatalogCountryShard | null>;
  onSkip: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<CatalogCountrySummary | null>(null);
  const [cityOptions, setCityOptions] = useState<LocationOption[]>([]);
  const [isLoadingCities, setIsLoadingCities] = useState(false);
  const [loadError, setLoadError] = useState("");

  const regionsById = useMemo(
    () => new Map(manifest.regions.map((region) => [region.id, region.name])),
    [manifest.regions],
  );

  const countryResults = useMemo(() => {
    const query = search.trim().toLowerCase();
    const candidates = manifest.countries.map((country) => ({
      ...country,
      regionName: regionsById.get(country.regionId) ?? "Other",
    }));

    if (!query) {
      return candidates;
    }

    return candidates.filter((country) => {
      return (
        country.name.toLowerCase().includes(query) ||
        country.code.toLowerCase().includes(query) ||
        country.regionName.toLowerCase().includes(query)
      );
    });
  }, [manifest.countries, regionsById, search]);

  const cityResults = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return cityOptions;
    }

    return cityOptions.filter((city) => city.label.toLowerCase().includes(query));
  }, [cityOptions, search]);

  const inputClass =
    "w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)]/50 focus:bg-white/[0.07]";

  async function handleCountrySelect(country: CatalogCountrySummary): Promise<void> {
    setSelectedCountry(country);
    setIsLoadingCities(true);
    setLoadError("");

    try {
      const shard = await onLoadCountry(country.id);
      if (!shard) {
        throw new Error(`Could not load cities for ${country.name}.`);
      }

      const cities = shard.cities
        .map((city) => ({
          id: city.id,
          label: city.name,
          count: city.stationCount,
        }))
        .sort((left, right) => compareText(left.label, right.label));

      setCityOptions(cities);
      setSearch("");
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : `Could not load cities for ${country.name}.`,
      );
    } finally {
      setIsLoadingCities(false);
    }
  }

  function goBackToCountries(): void {
    setSelectedCountry(null);
    setCityOptions([]);
    setLoadError("");
    setSearch("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div
        className="w-[24rem] rounded-2xl border border-white/10 bg-[#080f1c] p-6 shadow-[0_32px_80px_rgba(0,0,0,0.6)]"
        style={{
          boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(87,215,255,0.06)",
        }}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--accent)]">
          HackRF WebUI
        </p>
        <h2 className="mt-2 text-xl font-semibold text-[var(--foreground)]">
          {selectedCountry ? `Choose a city in ${selectedCountry.name}` : "Choose a country to start"}
        </h2>
        <p className="mt-1.5 text-sm leading-5 text-[var(--muted)]">
          {selectedCountry
            ? "The dialog is now city-first inside the selected country so the initial filter is much tighter."
            : "The UI keeps the catalog fast by loading one country at a time. After that, you can pick a city inside that country."}
        </p>

        <input
          autoFocus
          className={cx(inputClass, "mt-4")}
          placeholder={selectedCountry ? "Search city..." : "Country, code, or region..."}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-white/8 bg-white/[0.02]">
          {loadError ? (
            <div className="space-y-3 px-4 py-4">
              <p className="text-sm text-rose-200">{loadError}</p>
              <button
                className={cx(CLS_BTN_GHOST, "w-full justify-center")}
                onClick={goBackToCountries}
                type="button"
              >
                Back
              </button>
            </div>
          ) : isLoadingCities ? (
            <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
              <Spinner />
              <p className="text-sm text-[var(--muted)]">
                Loading cities for {selectedCountry?.name}...
              </p>
            </div>
          ) : selectedCountry ? (
            cityResults.length === 0 ? (
              <p className="px-4 py-3 text-sm text-[var(--muted)]">No cities match your search.</p>
            ) : (
              <>
                <button
                  className="flex w-full items-center justify-between border-b border-white/[0.04] px-4 py-3 text-left transition hover:bg-white/[0.04]"
                  onClick={() =>
                    onSelect({
                      regionId: selectedCountry.regionId,
                      countryId: selectedCountry.id,
                      countryName: selectedCountry.name,
                      cityId: "all",
                      cityName: "All cities",
                    })
                  }
                  type="button"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--foreground)]">
                      All cities
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                      {selectedCountry.name}
                    </p>
                  </div>
                  <p className="font-mono text-[10px] text-[var(--muted)]">
                    {formatCount(selectedCountry.stationCount)} presets
                  </p>
                </button>
                {cityResults.map((city) => (
                  <button
                    key={city.id}
                    className="flex w-full items-center justify-between border-b border-white/[0.04] px-4 py-3 text-left transition hover:bg-white/[0.04] last:border-0"
                    onClick={() =>
                      onSelect({
                        regionId: selectedCountry.regionId,
                        countryId: selectedCountry.id,
                        countryName: selectedCountry.name,
                        cityId: city.id,
                        cityName: city.label,
                      })
                    }
                    type="button"
                  >
                    <span className="truncate text-sm font-medium text-[var(--foreground)]">
                      {city.label}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--muted)]">
                      {formatCount(city.count)}
                    </span>
                  </button>
                ))}
              </>
            )
          ) : (
            countryResults.length === 0 ? (
              <p className="px-4 py-3 text-sm text-[var(--muted)]">No countries match your search.</p>
            ) : (
              countryResults.map((country) => (
              <button
                key={country.id}
                className="flex w-full items-center justify-between border-b border-white/[0.04] px-4 py-3 text-left transition hover:bg-white/[0.04] last:border-0"
                onClick={() => void handleCountrySelect(country)}
                type="button"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--foreground)]">
                    {country.name}
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                    {country.code} · {country.regionName}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[10px] text-[var(--foreground)]">
                    {formatCount(country.stationCount)} presets
                  </p>
                  <p className="font-mono text-[10px] text-[var(--muted)]">
                    {formatCount(country.cityCount)} cities
                  </p>
                </div>
              </button>
              ))
            )
          )}
        </div>

        <div className="mt-5 border-t border-white/[0.06] pt-4">
          <div
            className={cx(
              "grid gap-3",
              selectedCountry ? "grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]" : "grid-cols-1",
            )}
          >
          {selectedCountry ? (
            <button
              className={cx(CLS_BTN_TILE, "border-white/10 bg-white/[0.04] text-[var(--muted-strong)] hover:border-white/18 hover:bg-white/[0.07]")}
              onClick={goBackToCountries}
              type="button"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                Step Back
              </span>
              <span className="mt-1 text-sm font-semibold text-[var(--foreground)]">
                Back to countries
              </span>
            </button>
          ) : null}
          <button
            className={cx(
              CLS_BTN_TILE,
              "border-[var(--accent)]/18 bg-[linear-gradient(135deg,rgba(87,215,255,0.1),rgba(87,215,255,0.03))] text-[var(--muted-strong)] hover:border-[var(--accent)]/38 hover:bg-[linear-gradient(135deg,rgba(87,215,255,0.16),rgba(87,215,255,0.05))]",
              selectedCountry ? "" : "w-full",
            )}
            onClick={onSkip}
            type="button"
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
              Skip Catalog
            </span>
            <span className="mt-1 text-sm font-semibold text-[var(--foreground)]">
              Use only custom presets
            </span>
            <span className="mt-1 text-xs text-[var(--muted)]">
              You can load a country later from the dashboard filters.
            </span>
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

const CLS_INPUT =
  "w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)]/50 focus:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50";
const CLS_BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded border border-[var(--accent)]/40 bg-[var(--accent)]/12 px-4 py-2 text-sm font-semibold transition hover:border-[var(--accent)]/70 hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-40";
const CLS_BTN_GHOST =
  "inline-flex items-center justify-center rounded border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-[var(--muted-strong)] transition hover:border-white/18 hover:bg-white/[0.07]";
const CLS_BTN_TILE =
  "inline-flex min-h-[4.25rem] flex-col items-start justify-center rounded px-4 py-3 text-left transition";

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5 animate-spin"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z" />
    </svg>
  );
}

function ModuleIcon({ id }: { id: string }) {
  if (id === "fm") {
    // Classic radio receiver
    return (
      <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16">
        <rect height="8" rx="1" width="13" x="1.5" y="6" />
        <line x1="5" x2="12" y1="3.5" y2="6" />
        <circle cx="11.5" cy="10" r="1.8" />
        <rect height="3.5" rx="0.5" width="4.5" x="2.5" y="7.5" />
      </svg>
    );
  }
  if (id === "pmr") {
    // Walkie-talkie
    return (
      <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16">
        <rect height="10" rx="1" width="6" x="5" y="4" />
        <line x1="8" x2="8" y1="1.5" y2="4" />
        <line x1="6.5" x2="9.5" y1="8" y2="8" />
        <circle cx="8" cy="11.5" fill="currentColor" r="1.1" stroke="none" />
      </svg>
    );
  }
  if (id === "adsb") {
    // Airplane (top-down)
    return (
      <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16">
        <line x1="8" x2="8" y1="2.5" y2="13.5" />
        <path d="M3.5 7.5L8 6l4.5 1.5" />
        <path d="M5.5 11.5L8 10.5l2.5 1" />
      </svg>
    );
  }
  if (id === "ais") {
    // Sailboat side view: mast, triangular sail, curved hull
    return (
      <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16">
        <line x1="7" x2="7" y1="2" y2="11" />
        <path d="M7 2.5L13 11H7Z" />
        <path d="M1.5 11L14 11L12.5 13.5Q8 16 3.5 13.5Z" />
      </svg>
    );
  }
  if (id === "airband") {
    // ATC control tower
    return (
      <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16">
        <line x1="8" x2="8" y1="1" y2="5" />
        <rect height="4" rx="1" width="7" x="4.5" y="5" />
        <path d="M5.5 9l-2 5h9l-2-5" />
        <line x1="4" x2="12" y1="11.5" y2="11.5" />
      </svg>
    );
  }
  return null;
}

export function Dashboard({
  activeModule,
  manifest,
}: {
  activeModule: AppModuleId;
  manifest: CatalogManifest;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<Record<string, LoadedCountryCatalog>>({});
  const pendingLoadsRef = useRef<Map<string, Promise<LoadedCountryCatalog | null>>>(
    new Map(),
  );

  const [customStations, setCustomStations] = useState<FmStation[]>(() => {
    if (activeModule !== "fm") {
      return [];
    }

    if (typeof window === "undefined") {
      return [];
    }

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as FmStation[];
      return Array.isArray(parsed) ? sortStations(parsed) : [];
    } catch {
      return [];
    }
  });
  const [loadedCountries, setLoadedCountries] = useState<Record<string, LoadedCountryCatalog>>(
    {},
  );
  const [showWelcome, setShowWelcome] = useState(false);
  const [savedLocation, setSavedLocation] = useState<SavedLocation | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [regionFilter, setRegionFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [hardware, setHardware] = useState<HardwareStatus | null>(null);
  const [hardwareError, setHardwareError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [streamError, setStreamError] = useState("");
  const [draft, setDraft] = useState<CustomStationDraft>(DEFAULT_DRAFT);
  const [showAdd, setShowAdd] = useState(false);
  const [controls, setControls] = useState({ lna: 24, vga: 20, audioGain: 1.0 });
  const [volume, setVolume] = useState(1);
  const [startingStationId, setStartingStationId] = useState<string | null>(null);
  const [loadingCountryId, setLoadingCountryId] = useState<string | null>(null);
  const [listHeight, setListHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const isFmModule = activeModule === "fm";

  const countriesById = useMemo(
    () => new Map(manifest.countries.map((country) => [country.id, country])),
    [manifest.countries],
  );

  const lookupCatalog = useMemo(
    () => ({ regions: manifest.regions, countries: manifest.countries }),
    [manifest.countries, manifest.regions],
  );

  function persistLocation(location: SavedLocation | null): void {
    if (location) {
      window.localStorage.setItem(LOCATION_KEY, JSON.stringify(location));
      setSavedLocation(location);
      return;
    }

    window.localStorage.setItem(LOCATION_KEY, "skipped");
    setSavedLocation(null);
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(LAST_MODULE_STORAGE_KEY, activeModule);
    } catch {
      // Ignore local persistence failures.
    }

    document.cookie = getCookieHeaderForModule(activeModule);
  }, [activeModule]);

  useEffect(() => {
    if (!isFmModule) {
      setShowWelcome(false);
      return;
    }

    const raw = window.localStorage.getItem(LOCATION_KEY);
    if (!raw) {
      setShowWelcome(true);
      return;
    }

    if (raw === "skipped") {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<SavedLocation>;
      if (!parsed.countryId) {
        setShowWelcome(true);
        return;
      }

      const country = countriesById.get(parsed.countryId);
      if (!country) {
        setShowWelcome(true);
        return;
      }

      const location: SavedLocation = {
        regionId: country.regionId,
        countryId: country.id,
        countryName: country.name,
        cityId: typeof parsed.cityId === "string" ? parsed.cityId : "all",
        cityName:
          typeof parsed.cityName === "string" && parsed.cityName.trim().length > 0
            ? parsed.cityName
            : "All cities",
      };

      setSavedLocation(location);
      setRegionFilter(country.regionId);
      setCountryFilter(country.id);
      setCityFilter(location.cityId);
    } catch {
      setShowWelcome(true);
    }
  }, [countriesById, isFmModule]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(customStations));
  }, [customStations]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  async function refreshHardware(): Promise<void> {
    try {
      setHardware(await fetchHardwareStatus());
      setHardwareError("");
    } catch (error) {
      setHardwareError(
        error instanceof Error ? error.message : "Could not read HackRF status.",
      );
    }
  }

  function stopListening(): void {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setPlayingId(null);
    setStartingStationId(null);
  }

  function resetFilters(): void {
    startTransition(() => {
      setQuery("");
      setCityFilter("all");
      if (countryFilter === "all") {
        setRegionFilter("all");
      }
    });
  }

  async function loadCountryCatalog(countryId: string): Promise<LoadedCountryCatalog | null> {
    if (cacheRef.current[countryId]) {
      return cacheRef.current[countryId];
    }

    const pending = pendingLoadsRef.current.get(countryId);
    if (pending) {
      return pending;
    }

    const task = (async () => {
      setLoadingCountryId(countryId);
      setCatalogError("");

      try {
        const response = await fetch(`/catalog/countries/${countryId}.json`, {
          cache: "force-cache",
        });
        if (!response.ok) {
          throw new Error(`Failed to load ${countryId} catalog shard (${response.status}).`);
        }

        const shard = (await response.json()) as CatalogCountryShard;
        const loaded = {
          catalog: hydrateCountryShard(manifest, shard),
          shard,
        };

        cacheRef.current[countryId] = loaded;
        setLoadedCountries((current) => ({ ...current, [countryId]: loaded }));
        return loaded;
      } catch (error) {
        setCatalogError(
          error instanceof Error
            ? error.message
            : "Could not load the selected country catalog.",
        );
        return null;
      } finally {
        pendingLoadsRef.current.delete(countryId);
        setLoadingCountryId((current) => (current === countryId ? null : current));
      }
    })();

    pendingLoadsRef.current.set(countryId, task);
    return task;
  }

  const ensureCountryLoaded = useEffectEvent(
    async (countryId: string): Promise<LoadedCountryCatalog | null> =>
      loadCountryCatalog(countryId),
  );

  useEffect(() => {
    if (!isFmModule) {
      return;
    }

    if (countryFilter === "all") {
      return;
    }

    void ensureCountryLoaded(countryFilter);
  }, [countryFilter, isFmModule]);

  useEffect(() => {
    let dead = false;
    const audio = audioRef.current;

    const poll = async () => {
      try {
        const data = await fetchHardwareStatus();
        if (!dead) {
          setHardware(data);
          setHardwareError("");
        }
      } catch (error) {
        if (!dead) {
          setHardwareError(
            error instanceof Error ? error.message : "Could not read HackRF status.",
          );
        }
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 4_000);

    return () => {
      dead = true;
      clearInterval(timer);
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    };
  }, []);

  useEffect(() => {
    if (!isFmModule) {
      return;
    }

    const listNode = listRef.current;
    if (!listNode) {
      return;
    }

    const syncMetrics = () => {
      setScrollTop(listNode.scrollTop);
      setListHeight(listNode.clientHeight);
    };

    syncMetrics();
    listNode.addEventListener("scroll", syncMetrics, { passive: true });

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => syncMetrics())
        : null;
    resizeObserver?.observe(listNode);
    window.addEventListener("resize", syncMetrics);

    return () => {
      listNode.removeEventListener("scroll", syncMetrics);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncMetrics);
    };
  }, [isFmModule]);

  const regionOptions = useMemo(
    () => buildRegionOptions(manifest, customStations),
    [customStations, manifest],
  );
  const activeRegion =
    regionFilter === "all" || regionOptions.some((region) => region.id === regionFilter)
      ? regionFilter
      : "all";

  const countryOptions = useMemo(
    () => buildCountryOptions(manifest, activeRegion, customStations),
    [activeRegion, customStations, manifest],
  );
  const activeCountry =
    countryFilter === "all" || countryOptions.some((country) => country.id === countryFilter)
      ? countryFilter
      : "all";

  const activeCountrySummary =
    activeCountry === "all" ? null : countriesById.get(activeCountry) ?? null;
  const activeCountryData =
    activeCountry === "all" ? null : loadedCountries[activeCountry] ?? null;
  const cityOptions = useMemo(
    () => buildCityOptions(activeCountryData?.shard ?? null, activeCountry, customStations),
    [activeCountry, activeCountryData, customStations],
  );
  const activeCity =
    cityFilter === "all" || cityOptions.some((city) => city.id === cityFilter)
      ? cityFilter
      : "all";

  const allStations = useMemo(() => {
    const scopedCustomStations =
      activeCountry === "all"
        ? customStations
        : customStations.filter((station) => station.location.countryId === activeCountry);
    const loadedStations = activeCountryData?.catalog.stations ?? [];

    return sortStations([...scopedCustomStations, ...loadedStations]);
  }, [activeCountry, activeCountryData, customStations]);

  const knownStations = useMemo(() => {
    return [
      ...customStations,
      ...Object.values(loadedCountries).flatMap((country) => country.catalog.stations),
    ];
  }, [customStations, loadedCountries]);

  const visible = useMemo(() => {
    return allStations.filter((station) => {
      if (activeRegion !== "all" && station.location.regionId !== activeRegion) {
        return false;
      }
      if (activeCountry !== "all" && station.location.countryId !== activeCountry) {
        return false;
      }
      if (activeCity !== "all" && station.location.cityId !== activeCity) {
        return false;
      }

      return matchesStationSearch(station, deferredQuery);
    });
  }, [activeCity, activeCountry, activeRegion, allStations, deferredQuery]);

  const selected =
    visible.find((station) => station.id === selectedId) ||
    visible[0] ||
    allStations.find((station) => station.id === selectedId) ||
    allStations[0] ||
    null;

  useEffect(() => {
    if (selectedId && allStations.some((station) => station.id === selectedId)) {
      return;
    }

    const fallback = visible[0] ?? allStations[0] ?? null;
    if (fallback) {
      setSelectedId(fallback.id);
      return;
    }

    if (selectedId) {
      setSelectedId("");
    }
  }, [allStations, selectedId, visible]);

  useEffect(() => {
    if (pendingScrollId) {
      return;
    }

    const listNode = listRef.current;
    if (!listNode) {
      return;
    }

    listNode.scrollTo({ top: 0, behavior: "auto" });
    setScrollTop(0);
  }, [activeCity, activeCountry, activeRegion, deferredQuery, pendingScrollId]);

  useEffect(() => {
    if (!pendingScrollId) {
      return;
    }

    const index = visible.findIndex((station) => station.id === pendingScrollId);
    if (index < 0) {
      return;
    }

    const listNode = listRef.current;
    if (listNode) {
      listNode.scrollTo({
        top: index * STATION_ROW_HEIGHT,
        behavior: "smooth",
      });
    }

    setSelectedId(pendingScrollId);
    setPendingScrollId(null);
  }, [pendingScrollId, visible]);

  const windowedRange = useMemo(() => {
    if (visible.length === 0) {
      return { start: 0, end: 0 };
    }

    const viewportHeight = listHeight || 640;
    const start = Math.max(
      0,
      Math.floor(scrollTop / STATION_ROW_HEIGHT) - STATION_LIST_OVERSCAN,
    );
    const end = Math.min(
      visible.length,
      Math.ceil((scrollTop + viewportHeight) / STATION_ROW_HEIGHT) + STATION_LIST_OVERSCAN,
    );

    return { start, end };
  }, [listHeight, scrollTop, visible.length]);

  const windowedStations = visible.slice(windowedRange.start, windowedRange.end);
  const topSpacerHeight = windowedRange.start * STATION_ROW_HEIGHT;
  const bottomSpacerHeight =
    (visible.length - windowedRange.end) * STATION_ROW_HEIGHT;

  function focusPlayingStation(): void {
    if (!playingId) {
      return;
    }

    const station = knownStations.find((candidate) => candidate.id === playingId);
    if (!station) {
      return;
    }

    startTransition(() => {
      setQuery("");
      setRegionFilter(station.location.regionId);
      setCountryFilter(station.location.countryId);
      setCityFilter(station.location.cityId);
      setSelectedId(station.id);
    });

    setPendingScrollId(station.id);
  }

  function handleLocationSelect(location: SavedLocation): void {
    persistLocation(location);
    startTransition(() => {
      setRegionFilter(location.regionId);
      setCountryFilter(location.countryId);
      setCityFilter(location.cityId);
      setQuery("");
    });
    setShowWelcome(false);
  }

  function handleLocationSkip(): void {
    persistLocation(null);
    setShowWelcome(false);
  }

  async function startListening(station: FmStation | null): Promise<void> {
    if (!station || !audioRef.current) {
      return;
    }

    setStreamError("");
    setPlayingId(null);
    setSelectedId(station.id);
    setStartingStationId(station.id);

    const audio = audioRef.current;
    audio.pause();
    audio.src = buildStreamUrl(station, controls);

    try {
      await audio.play();
      setPlayingId(station.id);
      void refreshHardware();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      audio.removeAttribute("src");
      audio.load();
      setPlayingId(null);
      setStreamError(
        error instanceof Error
          ? error.message
          : "Browser could not start audio playback.",
      );
    } finally {
      setStartingStationId(null);
    }
  }

  function handleAddPreset(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const freq = Number.parseFloat(draft.freqMhz);
    if (!Number.isFinite(freq) || freq < 64 || freq > 108) {
      setStreamError("Frequency must be between 64 and 108 MHz.");
      return;
    }

    const station = buildCustomStation(draft, lookupCatalog);
    setCustomStations((current) => sortStations([...current, station]));
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

    await startListening(buildCustomStation(draft, lookupCatalog));
  }

  function removeCustom(id: string): void {
    if (playingId === id || startingStationId === id) {
      stopListening();
    }

    setCustomStations((current) => current.filter((station) => station.id !== id));
  }

  function handleRegionChange(nextRegion: string): void {
    persistLocation(null);
    startTransition(() => {
      setRegionFilter(nextRegion);
      setCountryFilter("all");
      setCityFilter("all");
      setQuery("");
    });
  }

  function handleCountryChange(nextCountry: string): void {
    if (nextCountry === "all") {
      persistLocation(null);
      startTransition(() => {
        setCountryFilter("all");
        setCityFilter("all");
        setSelectedId("");
      });
      return;
    }

    const country = countriesById.get(nextCountry);
    if (!country) {
      return;
    }

    persistLocation({
      regionId: country.regionId,
      countryId: country.id,
      countryName: country.name,
      cityId: "all",
      cityName: "All cities",
    });

    startTransition(() => {
      setRegionFilter(country.regionId);
      setCountryFilter(country.id);
      setCityFilter("all");
      setQuery("");
    });
  }

  function handleCityChange(nextCity: string): void {
    setCityFilter(nextCity);

    if (activeCountry === "all") {
      return;
    }

    const country = countriesById.get(activeCountry);
    if (!country) {
      return;
    }

    if (nextCity === "all") {
      persistLocation({
        regionId: country.regionId,
        countryId: country.id,
        countryName: country.name,
        cityId: "all",
        cityName: "All cities",
      });
      return;
    }

    const city = cityOptions.find((option) => option.id === nextCity);
    if (!city) {
      return;
    }

    persistLocation({
      regionId: country.regionId,
      countryId: country.id,
      countryName: country.name,
      cityId: city.id,
      cityName: city.label,
    });
  }

  const hasFilters =
    query.trim().length > 0 || activeRegion !== "all" || activeCountry !== "all" || activeCity !== "all";
  const telemetry = hardware?.activeStream?.telemetry ?? null;
  const hardwareMeta = hwTone(hardware?.state ?? "unknown");
  const locationLabel = savedLocation
    ? savedLocation.cityId !== "all"
      ? savedLocation.cityName
      : savedLocation.countryName
    : "All locations";
  const activeCountryLoading =
    activeCountry !== "all" && !activeCountryData && loadingCountryId === activeCountry;
  const shouldShowSelectCountryState =
    isFmModule && activeCountry === "all" && customStations.length === 0;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {isFmModule && showWelcome ? (
        <WelcomeModal
          manifest={manifest}
          onLoadCountry={async (countryId) => {
            const loaded = await loadCountryCatalog(countryId);
            return loaded?.shard ?? null;
          }}
          onSelect={handleLocationSelect}
          onSkip={handleLocationSkip}
        />
      ) : null}

      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/8 bg-black/40 px-4 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold uppercase tracking-[0.3em] text-[var(--accent)]">
            HackRF
          </span>
          <span className="font-mono text-[10px] text-[var(--muted)] opacity-50">webui</span>
        </div>

        <div className="mx-1 h-4 w-px bg-white/10" />

        <div
          className={cx(
            "flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold",
            hardwareMeta.badge,
          )}
        >
          <span
            className={cx(
              "h-1.5 w-1.5 rounded-full",
              hardwareMeta.dot,
              hardwareMeta.pulse && "animate-pulse",
            )}
          />
          {hardware?.product || "HackRF One"}
        </div>

        {hardware?.state === "connected" && hardware.firmware ? (
          <span className="font-mono text-[10px] text-[var(--muted)]">
            fw&nbsp;{hardware.firmware}
          </span>
        ) : null}

        <div className="flex-1" />

        {hardware?.activeStream ? (
          <button
            className={cx(
              "flex items-center gap-2 rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/6 px-3 py-1",
              isFmModule && playingId
                ? "transition hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/10"
                : "cursor-default",
            )}
            onClick={isFmModule && playingId ? focusPlayingStation : undefined}
            title={isFmModule && playingId ? "Show in station list" : undefined}
            type="button"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
            <span className="font-mono text-sm font-bold tabular-nums text-[var(--foreground)]">
              {(hardware.activeStream.freqHz / 1_000_000).toFixed(1)}&nbsp;MHz
            </span>
            <span className="text-xs text-[var(--muted)]">
              {hardware.activeStream.label}
            </span>
          </button>
        ) : null}

        {isFmModule && playingId ? (
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
          title="Refresh hardware status"
          type="button"
        >
          ↺
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="flex w-[70px] shrink-0 flex-col border-r border-white/8 bg-black/20 py-2">
          {APP_MODULES.map((module) => {
            const isActive = module.live && activeModule === module.id;

            if (!module.live) {
              return (
                <button
                  key={module.id}
                  className={cx(
                    "flex flex-col items-center gap-1 px-2 py-3 text-center",
                    "cursor-not-allowed text-[var(--muted)] opacity-30",
                  )}
                  disabled
                  title={`${module.label} · coming soon`}
                  type="button"
                >
                  <ModuleIcon id={module.id} />
                  <span className="font-mono text-[11px] font-bold uppercase tracking-[0.1em]">
                    {module.label}
                  </span>
                  <span className="font-mono text-[8px] leading-none text-current opacity-70">
                    {module.band}
                  </span>
                  <span className="font-mono text-[7px] uppercase tracking-wide opacity-60">
                    soon
                  </span>
                </button>
              );
            }

            return (
              <Link
                key={module.id}
                className={cx(
                  "flex flex-col items-center gap-1 px-2 py-3 text-center transition-colors",
                  isActive
                    ? "border-r-accent bg-[var(--accent)]/6 text-[var(--accent)]"
                    : "text-[var(--muted-strong)] hover:bg-white/[0.03] hover:text-[var(--foreground)]",
                )}
                href={module.path}
                title={`${module.label} · ${module.band}`}
              >
                <ModuleIcon id={module.id} />
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.1em]">
                  {module.label}
                </span>
                <span className="font-mono text-[8px] leading-none text-current opacity-70">
                  {module.band}
                </span>
              </Link>
            );
          })}
        </nav>

        {activeModule === "pmr" ? (
          <PmrModule
            controls={controls}
            hardware={hardware}
            onControlsChange={setControls}
            onRefreshHardware={refreshHardware}
          />
        ) : null}

        {activeModule === "adsb" ? (
          <AdsbModule hardware={hardware} onRefreshHardware={refreshHardware} />
        ) : null}

        {activeModule === "ais" ? (
          <AisModule hardware={hardware} onRefreshHardware={refreshHardware} />
        ) : null}

        {isFmModule ? (
        <div className="flex flex-1 overflow-hidden">
          <aside className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-white/8 bg-black/10">
            {/* Title */}
            <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--foreground)]">FM</span>
                <span className="font-mono text-[10px] text-[var(--muted)]">Broadcast</span>
              </div>
              <span className="font-mono text-[10px] text-[var(--muted)]">{formatCount(visible.length)}</span>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Filters */}
              <div className="border-b border-white/[0.07] px-4 py-3">
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Filters</span>
                  {hasFilters ? (
                    <button
                      className="font-mono text-[9px] uppercase tracking-[0.15em] text-[var(--accent)] transition hover:opacity-70"
                      onClick={resetFilters}
                      type="button"
                    >
                      Reset
                    </button>
                  ) : null}
                </div>

                <button
                  className="mb-2.5 flex w-full items-center gap-1.5 border-b border-white/[0.05] pb-2.5 text-left transition hover:text-[var(--foreground)]"
                  onClick={() => setShowWelcome(true)}
                  title="Change location filter"
                  type="button"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--muted-strong)]">
                    {locationLabel}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] text-[var(--accent)] opacity-70">edit</span>
                </button>

                <div className="space-y-2">
                  <input
                    className={CLS_INPUT}
                    placeholder={
                      activeCountry === "all" ? "Select a country first..." : "Search loaded stations..."
                    }
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />

                  <select
                    className={CLS_INPUT}
                    value={activeRegion}
                    onChange={(event) => handleRegionChange(event.target.value)}
                  >
                    <option value="all">All regions</option>
                    {regionOptions.map((region) => (
                      <option key={region.id} value={region.id}>
                        {region.label} ({formatCount(region.count)})
                      </option>
                    ))}
                  </select>

                  <select
                    className={CLS_INPUT}
                    value={activeCountry}
                    onChange={(event) => handleCountryChange(event.target.value)}
                  >
                    <option value="all">Choose a country</option>
                    {countryOptions.map((country) => (
                      <option key={country.id} value={country.id}>
                        {country.label} ({formatCount(country.count)})
                      </option>
                    ))}
                  </select>

                  <select
                    className={CLS_INPUT}
                    disabled={activeCountry === "all"}
                    value={activeCity}
                    onChange={(event) => handleCityChange(event.target.value)}
                  >
                    <option value="all">
                      {activeCountry === "all" ? "Load a country first" : "All cities"}
                    </option>
                    {cityOptions.map((city) => (
                      <option key={city.id} value={city.id}>
                        {city.label} ({formatCount(city.count)})
                      </option>
                    ))}
                  </select>
                </div>

                {activeCountrySummary ? (
                  <p className="mt-2 font-mono text-[10px] text-[var(--muted)]">
                    {formatCount(allStations.length)} loaded
                  </p>
                ) : null}
              </div>

              {/* Coverage link */}
              <div className="border-b border-white/[0.07]">
                <Link
                  className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-white/[0.03]"
                  href="/fm/coverage"
                >
                  <span>
                    <span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--accent)]">
                      Coverage
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-[var(--muted-strong)]">
                      FM global map
                    </span>
                  </span>
                  <span className="font-mono text-[10px] text-[var(--muted)]">→</span>
                </Link>
              </div>

              <div>
                <button
                  className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-white/[0.025]"
                  onClick={() => setShowAdd((current) => !current)}
                  type="button"
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted-strong)]">
                    {showAdd ? "− Cancel" : "+ Add preset"}
                  </span>
                </button>

              {showAdd ? (
                <form className="space-y-2 px-4 pb-4" onSubmit={handleAddPreset}>
                  <input
                    className={CLS_INPUT}
                    placeholder="Name"
                    value={draft.name}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                  <input
                    className={CLS_INPUT}
                    placeholder="Freq MHz (e.g. 99.5)"
                    value={draft.freqMhz}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, freqMhz: event.target.value }))
                    }
                  />
                  <input
                    className={CLS_INPUT}
                    placeholder="Country"
                    value={draft.country}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, country: event.target.value }))
                    }
                  />
                  <input
                    className={CLS_INPUT}
                    placeholder="City"
                    value={draft.city}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, city: event.target.value }))
                    }
                  />
                  <textarea
                    className={cx(CLS_INPUT, "min-h-14 resize-none")}
                    placeholder="Notes..."
                    value={draft.description}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, description: event.target.value }))
                    }
                  />
                  <div className="flex gap-2">
                    <button className={cx("flex-1", CLS_BTN_PRIMARY)} type="submit">
                      Save
                    </button>
                    <button className={CLS_BTN_GHOST} onClick={() => void tuneDraft()} type="button">
                      ▶
                    </button>
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
            </div>
          </aside>

          <main className="flex flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-2.5">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                  FM Broadcast
                </span>
                {activeCountrySummary ? (
                  <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
                    {activeCountrySummary.name} shard
                    {activeCountryLoading ? " · loading..." : ""}
                  </p>
                ) : null}
              </div>
              <span className="font-mono text-[10px] text-[var(--muted)]">
                {activeCountrySummary
                  ? `${formatCount(allStations.length)} loaded`
                  : `${formatCount(customStations.length)} custom`}
              </span>
            </div>

            {shouldShowSelectCountryState ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                <div className="max-w-md space-y-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--accent)]">
                    Catalog Ready
                  </p>
                  <h3 className="text-xl font-semibold text-[var(--foreground)]">
                    Pick a country to load its FM shard
                  </h3>
                  <p className="text-sm leading-6 text-[var(--muted)]">
                    The initial UI stays light by shipping only a manifest. Once you pick a
                    country, the app loads that catalog locally and keeps the station list fluid.
                  </p>
                </div>
              </div>
            ) : activeCountryLoading ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                <div className="space-y-3">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.03]">
                    <Spinner />
                  </div>
                  <p className="text-sm text-[var(--muted)]">
                    Loading {activeCountrySummary?.name ?? "country"} catalog shard...
                  </p>
                </div>
              </div>
            ) : catalogError && !activeCountryData ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                <p className="max-w-md rounded border border-rose-400/20 bg-rose-400/8 p-4 text-sm leading-6 text-rose-200">
                  {catalogError}
                </p>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                <p className="text-sm text-[var(--muted)]">
                  No stations match the current filters. Try another city or clear the search.
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto" ref={listRef}>
                <div style={{ height: topSpacerHeight }} />
                {windowedStations.map((station) => {
                  const isSelected = selected?.id === station.id;
                  const isPlaying = playingId === station.id;
                  const isStarting = startingStationId === station.id;

                  return (
                    <div
                      key={station.id}
                      className={cx(
                        "group flex cursor-pointer items-center gap-3 border-b border-white/[0.045] px-4 transition-colors",
                        isSelected
                          ? "border-l-accent bg-[var(--accent)]/7"
                          : "border-l-clear hover:bg-white/[0.025]",
                      )}
                      data-station-id={station.id}
                      onClick={() => setSelectedId(station.id)}
                      style={{ height: STATION_ROW_HEIGHT }}
                    >
                      <span
                        className={cx(
                          "w-14 shrink-0 font-mono text-base font-bold tabular-nums",
                          isPlaying
                            ? "text-[var(--accent)]"
                            : isSelected
                              ? "text-[var(--foreground)]"
                              : "text-[var(--muted-strong)]",
                        )}
                      >
                        {station.freqMhz.toFixed(1)}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p
                          className={cx(
                            "truncate text-sm",
                            isSelected
                              ? "font-semibold text-[var(--foreground)]"
                              : "font-medium text-[var(--muted-strong)]",
                          )}
                        >
                          {station.name}
                        </p>
                        <p className="truncate font-mono text-[10px] text-[var(--muted)]">
                          {station.location.cityName} · {station.location.countryCode}
                        </p>
                      </div>

                      {isPlaying ? (
                        <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--accent)]">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
                          on air
                        </span>
                      ) : isStarting ? (
                        <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-[0.2em] text-amber-200">
                          <Spinner />
                          starting
                        </span>
                      ) : null}

                      <button
                        className={cx(
                          "shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold transition",
                          isPlaying || isStarting
                            ? "border-[var(--accent)]/35 bg-[var(--accent)]/10 text-[var(--accent)]"
                            : "border-white/10 bg-white/[0.03] text-[var(--muted)] opacity-0 group-hover:opacity-100",
                        )}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (isPlaying) {
                            stopListening();
                            return;
                          }

                          void startListening(station);
                        }}
                        type="button"
                      >
                        {isStarting ? <Spinner /> : isPlaying ? "■" : "▶"}
                      </button>

                      {!station.curated ? (
                        <button
                          className="shrink-0 rounded-full border border-rose-400/20 px-2 py-1 font-mono text-[9px] text-rose-300 opacity-0 transition hover:bg-rose-400/10 group-hover:opacity-100"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeCustom(station.id);
                          }}
                          type="button"
                        >
                          ✕
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                <div style={{ height: bottomSpacerHeight }} />
              </div>
            )}
          </main>

          <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-white/8 bg-black/15">
            {selected ? (
              <>
                <div className="border-b border-white/8 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                        {selected.location.countryName}
                      </p>
                      <h2 className="mt-1 text-xl font-semibold leading-tight text-[var(--foreground)]">
                        {selected.name}
                      </h2>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {selected.location.cityName}
                      </p>
                    </div>
                    <div className="shrink-0 rounded border border-white/[0.07] bg-black/20 px-3 py-2 text-right">
                      <p className="font-mono text-2xl font-bold tabular-nums leading-none text-[var(--foreground)]">
                        {selected.freqMhz.toFixed(1)}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-[var(--muted)]">MHz</p>
                    </div>
                  </div>

                  {selected.description ? (
                    <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                      {selected.description}
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span
                      className={cx(
                        "rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]",
                        selected.curated
                          ? "border-[var(--accent)]/25 bg-[var(--accent)]/8 text-[var(--foreground)]"
                          : "border-[var(--highlight)]/25 bg-[var(--highlight)]/8 text-[var(--foreground)]",
                      )}
                    >
                      {selected.curated ? "curated" : "custom"}
                    </span>
                    {selected.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-sm border border-white/8 bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-[var(--muted)]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="space-y-5 border-b border-white/8 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                    RF Controls
                  </p>

                  <label className="block space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">
                        LNA
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">
                        {controls.lna} dB
                      </span>
                    </div>
                    <input
                      className="rf-slider w-full"
                      max={40}
                      min={0}
                      step={8}
                      type="range"
                      value={controls.lna}
                      onChange={(event) =>
                        setControls((current) => ({
                          ...current,
                          lna: Number.parseInt(event.target.value, 10),
                        }))
                      }
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">
                        VGA
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">
                        {controls.vga} dB
                      </span>
                    </div>
                    <input
                      className="rf-slider w-full"
                      max={62}
                      min={0}
                      step={2}
                      type="range"
                      value={controls.vga}
                      onChange={(event) =>
                        setControls((current) => ({
                          ...current,
                          vga: Number.parseInt(event.target.value, 10),
                        }))
                      }
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">
                        Volume
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">
                        {controls.audioGain.toFixed(1)}x
                      </span>
                    </div>
                    <input
                      className="rf-slider w-full"
                      max={8}
                      min={0.2}
                      step={0.1}
                      type="range"
                      value={controls.audioGain}
                      onChange={(event) =>
                        setControls((current) => ({
                          ...current,
                          audioGain: Number.parseFloat(event.target.value),
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="space-y-3 p-5">
                  <button
                    className={cx(
                      "w-full inline-flex items-center justify-center gap-1.5 rounded border px-4 py-2 text-sm font-semibold transition",
                      playingId === selected.id || startingStationId === selected.id
                        ? "border-rose-400/25 bg-rose-400/[0.08] text-rose-300 hover:border-rose-400/45"
                        : "border-[var(--accent)]/40 bg-[var(--accent)]/12 text-[var(--foreground)] hover:border-[var(--accent)]/70 hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-40",
                    )}
                    disabled={startingStationId !== null && startingStationId !== selected.id}
                    onClick={() => {
                      if (playingId === selected.id || startingStationId === selected.id) {
                        stopListening();
                        return;
                      }
                      void startListening(selected);
                    }}
                    type="button"
                  >
                    {startingStationId === selected.id ? (
                      <><Spinner />Starting…</>
                    ) : playingId === selected.id ? (
                      "Stop"
                    ) : (
                      "▶ Listen"
                    )}
                  </button>

                  <audio
                    className="w-full rounded-lg opacity-90"
                    controls
                    onEnded={() => {
                      setPlayingId(null);
                      setStartingStationId(null);
                    }}
                    onError={() => {
                      setPlayingId(null);
                      setStartingStationId(null);
                      setStreamError(
                        "Could not open stream. Check HackRF status, ffmpeg, and the native binary.",
                      );
                      void refreshHardware();
                    }}
                    preload="none"
                    ref={audioRef}
                  />

                  {streamError ? (
                    <p className="rounded border border-rose-400/20 bg-rose-400/8 p-3 text-xs leading-5 text-rose-200">
                      {streamError}
                    </p>
                  ) : null}

                  {catalogError && activeCountryData ? (
                    <p className="rounded border border-amber-400/20 bg-amber-400/8 p-3 text-xs leading-5 text-amber-200">
                      {catalogError}
                    </p>
                  ) : null}

                  {hardwareError ? (
                    <p className="rounded border border-amber-400/20 bg-amber-400/8 p-3 text-xs leading-5 text-amber-200">
                      {hardwareError}
                    </p>
                  ) : null}

                  {telemetry ? (
                    <div className="border border-white/[0.07] p-3">
                      <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--muted)]">
                        Telemetry
                      </p>
                      <div className="grid grid-cols-3 gap-1 text-center">
                        {(
                          [
                            ["RMS", telemetry.rms],
                            ["Peak", telemetry.peak],
                            ["RF", telemetry.rf],
                          ] as [string, number][]
                        ).map(([label, value]) => (
                          <div key={label}>
                            <p className="font-mono text-[8px] text-[var(--muted)]">{label}</p>
                            <p className="font-mono text-[11px] text-[var(--accent)]">
                              {value.toFixed(3)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                <p className="text-sm text-[var(--muted)]">
                  {activeCountry === "all"
                    ? "Select a country or add a custom preset to start tuning."
                    : "Select a station to tune."}
                </p>
              </div>
            )}
          </aside>
        </div>
        ) : null}
      </div>
    </div>
  );
}
