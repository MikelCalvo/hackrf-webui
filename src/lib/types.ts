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

export type AisBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type AisPoint = {
  latitude: number;
  longitude: number;
};

export type AisRuntimeState = "stopped" | "starting" | "running" | "error";

export type AisRuntimeStatus = {
  state: AisRuntimeState;
  message: string;
  binaryAvailable: boolean;
  binaryPath: string;
  startedAt: string | null;
  lastFrameAt: string | null;
  centerFreqHz: number;
  sampleRate: number;
};

export type AisChannelStatus = {
  id: string;
  label: string;
  freqHz: number;
  frameCount: number;
  messageCount: number;
  lastSeenAt: string | null;
  lastMessageType: string | null;
  lastPhase: number | null;
};

export type AisTilePackSummary = {
  available: boolean;
  mode: "remote-live" | "local-pack";
  kind: "raster" | "pmtiles";
  name: string;
  tileUrlTemplate: string | null;
  pmtilesUrl: string | null;
  flavor: "light" | "dark" | "white" | "grayscale" | "black" | null;
  lang: string | null;
  attribution: string;
  bounds: AisBounds | null;
  minZoom: number;
  maxZoom: number;
  installedAt: string | null;
  manifestPath: string | null;
};

export type AisVesselContact = {
  mmsi: string;
  name: string;
  callsign: string;
  imo: string;
  shipType: string;
  destination: string;
  latitude: number;
  longitude: number;
  speedKnots: number | null;
  courseDeg: number | null;
  navStatus: string;
  lastSeenAt: string;
  lastPositionAt: string;
  lastStaticAt: string | null;
  messageType: string;
  sourceLabel: string;
  isMoving: boolean;
};

export type AisFeedSnapshot = {
  generatedAt: string;
  vesselCount: number;
  movingCount: number;
  latestPositionAt: string | null;
  center: AisPoint | null;
  bounds: AisBounds | null;
  vessels: AisVesselContact[];
  channels: AisChannelStatus[];
  warnings: string[];
  tilePack: AisTilePackSummary;
  runtime: AisRuntimeStatus;
};
