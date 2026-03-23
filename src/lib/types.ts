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

export type CatalogCity = {
  id: string;
  name: string;
  countryId: string;
  timezone: string;
  latitude: number;
  longitude: number;
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
