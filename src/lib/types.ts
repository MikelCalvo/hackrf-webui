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

export type AudioDemodMode = "am" | "nfm" | "wfm";
export type AudioCaptureModule = "pmr" | "airband" | "maritime";
export type AudioCaptureMode = "manual" | "scan";

export type ActivityCaptureRequestMeta = {
  module: AudioCaptureModule;
  mode: AudioCaptureMode;
  bandId?: string | null;
  channelId?: string | null;
  channelNumber?: number | null;
  channelNotes?: string | null;
  squelch?: number | null;
  sourceMode?: AppLocationSourceMode | null;
  gpsdFallbackMode?: AppLocationGpsdFallbackMode | null;
  sourceStatus?: ResolvedAppLocation["sourceStatus"] | null;
  sourceDetail?: string | null;
  regionId?: string | null;
  regionName?: string | null;
  countryId?: string | null;
  countryCode?: string | null;
  countryName?: string | null;
  cityId?: string | null;
  cityName?: string | null;
  resolvedLatitude?: number | null;
  resolvedLongitude?: number | null;
};

export type StreamSessionPhase = "starting" | "running" | "retuning";

export type StreamSessionSnapshot = {
  id: string;
  label: string;
  freqHz: number;
  demodMode: AudioDemodMode;
  startedAt: string;
  phase: StreamSessionPhase;
  phaseSince: string;
  lna: number;
  vga: number;
  audioGain: number;
  pendingLabel: string | null;
  pendingFreqHz: number | null;
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
  activityCapture?: ActivityCaptureRequestMeta | null;
};

export type CustomStationDraft = {
  name: string;
  freqMhz: string;
  country: string;
  city: string;
  description: string;
};

export type GeoBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type GeoPoint = {
  latitude: number;
  longitude: number;
};

export type AppLocationSourceMode = "catalog" | "map" | "gpsd";
export type AppLocationGpsdFallbackMode = "none" | "catalog" | "map";

export type AppLocationCatalogScope = {
  regionId: string | null;
  regionName: string | null;
  countryId: string | null;
  countryCode: string | null;
  countryName: string | null;
  cityId: string | null;
  cityName: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type StoredAppLocation = {
  version: 2;
  configured: boolean;
  sourceMode: AppLocationSourceMode;
  gpsdFallbackMode: AppLocationGpsdFallbackMode;
  catalogScope: AppLocationCatalogScope;
  mapPin: GeoPoint | null;
  updatedAt: string;
};

export type GpsdFixState = "unavailable" | "no-fix" | "2d" | "3d";

export type GpsdSnapshot = {
  available: boolean;
  host: string;
  port: number;
  activeDevices: number;
  fixState: GpsdFixState;
  mode: number;
  latitude: number | null;
  longitude: number | null;
  altitudeMeters: number | null;
  speedMps: number | null;
  trackDeg: number | null;
  time: string | null;
  device: string | null;
  message: string;
};

export type ResolvedAppLocation = {
  configured: boolean;
  sourceMode: AppLocationSourceMode;
  gpsdFallbackMode: AppLocationGpsdFallbackMode;
  catalogScope: AppLocationCatalogScope;
  mapPin: GeoPoint | null;
  resolvedPosition: GeoPoint | null;
  sourceStatus: "ready" | "waiting" | "unavailable";
  sourceDetail: string;
};

export type AisBounds = GeoBounds;

export type AisPoint = GeoPoint;

export type OfflineMapLayerRole = "global" | "country";

export type OfflineMapLayerSummary = {
  id: string;
  role: OfflineMapLayerRole;
  countryId: string | null;
  countryName: string | null;
  kind: "raster" | "pmtiles";
  name: string;
  tileUrlTemplate: string | null;
  pmtilesUrl: string | null;
  flavor: "light" | "dark" | "white" | "grayscale" | "black" | null;
  lang: string | null;
  attribution: string;
  bounds: GeoBounds | null;
  minZoom: number;
  maxZoom: number;
  installedAt: string | null;
  manifestPath: string | null;
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

export type OfflineMapSummary = {
  version: 1;
  available: boolean;
  mode: "remote-live" | "local-pack";
  kind: "raster" | "pmtiles";
  name: string;
  tileUrlTemplate: string | null;
  pmtilesUrl: string | null;
  flavor: "light" | "dark" | "white" | "grayscale" | "black" | null;
  lang: string | null;
  attribution: string;
  bounds: GeoBounds | null;
  minZoom: number;
  maxZoom: number;
  installedAt: string | null;
  manifestPath: string | null;
  countryLayerCount: number;
  layers: OfflineMapLayerSummary[];
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
  headingDeg: number | null;
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
  recentVessels: AisVesselContact[];
  channels: AisChannelStatus[];
  warnings: string[];
  maps: OfflineMapSummary;
  runtime: AisRuntimeStatus;
};

export type AisTrackPoint = {
  id: string;
  observationKey: string;
  mmsi: string;
  name: string;
  callsign: string;
  imo: string;
  shipType: string;
  destination: string;
  navStatus: string;
  messageType: string;
  messageTypeCode: number | null;
  sourceLabel: string;
  channelId: string | null;
  phase: number | null;
  latitude: number;
  longitude: number;
  speedKnots: number | null;
  courseDeg: number | null;
  headingDeg: number | null;
  isMoving: boolean;
  lastSeenAt: string;
  lastPositionAt: string;
  lastStaticAt: string | null;
  metadata: Record<string, unknown> | null;
};

export type AisTrackHistoryResponse = {
  mmsi: string;
  pointCount: number;
  firstPositionAt: string | null;
  lastPositionAt: string | null;
  points: AisTrackPoint[];
};

export type AdsbRuntimeState = "stopped" | "starting" | "running" | "error";

export type AdsbRuntimeStatus = {
  state: AdsbRuntimeState;
  message: string;
  binaryAvailable: boolean;
  binaryPath: string;
  startedAt: string | null;
  lastJsonAt: string | null;
  centerFreqHz: number;
  sampleRate: number;
  jsonDir: string;
  receiverLatitude: number | null;
  receiverLongitude: number | null;
};

export type AdsbDecoderStats = {
  messages: number;
  modes: number;
  bad: number;
  signalDbfs: number | null;
  noiseDbfs: number | null;
  peakSignalDbfs: number | null;
  gainDb: number | null;
  strongSignals: number;
  samplesProcessed: number;
  samplesDropped: number;
};

export type AdsbReceiverInfo = {
  latitude: number | null;
  longitude: number | null;
  refreshMs: number | null;
  version: string;
};

export type AdsbAircraftContact = {
  hex: string;
  flight: string;
  type: string;
  category: string;
  squawk: string;
  emergency: string;
  latitude: number | null;
  longitude: number | null;
  altitudeFeet: number | null;
  groundSpeedKnots: number | null;
  trackDeg: number | null;
  verticalRateFpm: number | null;
  onGround: boolean;
  messageCount: number;
  rssi: number | null;
  seenAt: string;
  seenPosAt: string | null;
  sourceLabel: string;
};

export type AdsbFeedSnapshot = {
  generatedAt: string;
  aircraftCount: number;
  positionCount: number;
  airborneCount: number;
  latestMessageAt: string | null;
  center: GeoPoint | null;
  bounds: GeoBounds | null;
  aircraft: AdsbAircraftContact[];
  recentAircraft: AdsbAircraftContact[];
  warnings: string[];
  maps: OfflineMapSummary;
  runtime: AdsbRuntimeStatus;
  receiver: AdsbReceiverInfo | null;
  stats: AdsbDecoderStats | null;
};

export type AdsbTrackPoint = {
  id: string;
  observationKey: string;
  hex: string;
  flight: string;
  type: string;
  category: string;
  squawk: string;
  emergency: string;
  sourceLabel: string;
  latitude: number;
  longitude: number;
  altitudeFeet: number | null;
  groundSpeedKnots: number | null;
  trackDeg: number | null;
  verticalRateFpm: number | null;
  onGround: boolean;
  messageCount: number;
  rssi: number | null;
  seenAt: string;
  seenPosAt: string | null;
  generatedAt: string | null;
  receiverLatitude: number | null;
  receiverLongitude: number | null;
  metadata: Record<string, unknown> | null;
};

export type AdsbTrackHistoryResponse = {
  hex: string;
  pointCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  points: AdsbTrackPoint[];
};
