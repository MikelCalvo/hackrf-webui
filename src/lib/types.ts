export type CatalogRegion = {
  id: string;
  name: string;
  sortOrder: number;
};

export type CatalogCountry = {
  id: string;
  code: string;
  name: string;
  regionId: string;
};

export type CatalogCountryCoverageStatus =
  | "active"
  | "partial"
  | "manual"
  | "blocked";

export type CatalogCountryCoverageTier =
  | "official-full"
  | "official-substantial"
  | "official-partial"
  | "manual-seed"
  | "blocked";

export type CatalogCountrySourceQuality =
  | "official-regulator"
  | "official-public-sector"
  | "serious-secondary"
  | "manual-curated"
  | "mixed";

export type CatalogCountryCoverageScope =
  | "national"
  | "regional"
  | "public-service-only"
  | "city-seed";

export type CatalogCountrySourceKind =
  | "regulator"
  | "public-sector"
  | "regional-authority"
  | "secondary"
  | "manual";

export type CatalogCountrySourceSummary = {
  name: string;
  url?: string;
  kind?: CatalogCountrySourceKind;
};

export type CatalogCountrySummary = CatalogCountry & {
  cityCount: number;
  stationCount: number;
  coverageTier: CatalogCountryCoverageTier;
  sourceQuality: CatalogCountrySourceQuality;
  coverageStatus: CatalogCountryCoverageStatus;
  coverageScope: CatalogCountryCoverageScope;
  coverageScore: number;
  sourceCount: number;
  sources: CatalogCountrySourceSummary[];
  hasOfficialImporter: boolean;
  lastImportedAt?: string;
  cachedFallbackUsed?: boolean;
  notesPath?: string;
  coverageNotes?: string;
};

export type CatalogCity = {
  id: string;
  name: string;
  countryId: string;
  timezone: string;
  latitude: number;
  longitude: number;
};

export type CatalogCitySummary = CatalogCity & {
  stationCount: number;
};

export type SeedFmStation = {
  id: string;
  name: string;
  freqMhz: number;
  cityId: string;
  description: string;
  tags: string[];
  source: string;
  sourceUrl?: string;
  verifiedAt: string;
  curated: boolean;
};

export type StationLocation = {
  regionId: string;
  regionName: string;
  countryId: string;
  countryName: string;
  countryCode: string;
  cityId: string;
  cityName: string;
  label: string;
};

export type FmStation = {
  id: string;
  name: string;
  freqMhz: number;
  location: StationLocation;
  description: string;
  tags: string[];
  source: string;
  sourceUrl?: string;
  verifiedAt: string;
  curated: boolean;
};

export type CatalogData = {
  regions: CatalogRegion[];
  countries: CatalogCountry[];
  cities: CatalogCity[];
  stations: FmStation[];
};

export type CatalogManifest = {
  generatedAt: string;
  regions: CatalogRegion[];
  countries: CatalogCountrySummary[];
  stats: {
    totalCountries: number;
    totalCities: number;
    totalStations: number;
    byCoverageStatus: Partial<Record<CatalogCountryCoverageStatus, number>>;
  };
};

export type CatalogCountryShard = {
  country: CatalogCountrySummary;
  cities: CatalogCitySummary[];
  stations: SeedFmStation[];
};

export type CatalogLookupData = {
  regions: CatalogRegion[];
  countries: Array<CatalogCountry | CatalogCountrySummary>;
};

export type SignalLevelTelemetry = {
  rms: number;
  peak: number;
  rf: number;
  updatedAt: string;
};

export type StreamSessionSnapshot = {
  id: string;
  label: string;
  freqHz: number;
  startedAt: string;
  lna: number;
  vga: number;
  audioGain: number;
  telemetry: SignalLevelTelemetry | null;
};

export type HardwareState =
  | "connected"
  | "disconnected"
  | "cli-missing"
  | "binary-missing"
  | "ffmpeg-missing"
  | "error";

export type HardwareStatus = {
  state: HardwareState;
  cliAvailable: boolean;
  binaryAvailable: boolean;
  ffmpegAvailable: boolean;
  binaryPath: string;
  product: string;
  firmware: string;
  hardware: string;
  serial: string;
  message: string;
  activeStream: StreamSessionSnapshot | null;
};

export type StreamRequest = {
  label: string;
  freqHz: number;
  lna: number;
  vga: number;
  audioGain: number;
};

export type CustomStationDraft = {
  name: string;
  freqMhz: string;
  country: string;
  city: string;
  description: string;
};
