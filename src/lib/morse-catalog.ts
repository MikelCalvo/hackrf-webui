import type { RadioSessionChannel } from "@/lib/radio-session";
import type { GeoPoint, ResolvedAppLocation } from "@/lib/types";

export const HACKRF_ONE_FREQUENCY_RANGE_HZ = {
  minHz: 1_000_000,
  maxHz: 6_000_000_000,
} as const;

export type MorseCatalogKind = "amateur-cw-segment" | "beacon" | "navigation-aid";
export type MorseSourceClass = "amateur-band-plan" | "beacon" | "aeronautical-information";
export type IaruRegion = "1" | "2" | "3";
export type SourceFormat = "HTML" | "PDF" | "AIP" | "CSV";
export type SourceClassification = "legal" | "voluntary" | "curated";
export type MorseCatalogApplicability = "global" | "iaru-region" | "countries" | "unknown";
export type MorseCatalogFrontEnd = "cw_carrier" | "am_tone";

export type MorseSourceProvenance = {
  authority: string;
  url: string;
  publishedOrEffectiveDate: string;
  verifiedDate: string;
  format: SourceFormat;
  classification: SourceClassification;
  license?: string;
  licenseUrl?: string;
  sourceRecordId?: string;
};

export type MorseCatalogEntry = {
  id: string;
  kind: MorseCatalogKind;
  sourceClass: MorseSourceClass;
  name: string;
  /** Published station identifier/callsign expected in decoded Morse. */
  identifier?: string | null;
  /** A tunable point frequency. Segment entries deliberately use null. */
  frequencyHz: number | null;
  frequencyRangeHz?: { minHz: number; maxHz: number };
  frontEnd?: MorseCatalogFrontEnd;
  applicability?: MorseCatalogApplicability;
  iaruRegions: IaruRegion[];
  countryCodes: string[];
  location?: GeoPoint;
  schedule?: string;
  provenance: MorseSourceProvenance;
};

export type MorseCatalogCompatibility = {
  entry: MorseCatalogEntry;
  compatible: boolean;
  incompatibilityReason: string | null;
};

export type RankedMorseCatalogEntry = MorseCatalogCompatibility & {
  distanceKm: number | null;
};

export type MorseCatalogFilter = {
  sourceClasses?: MorseSourceClass[];
  iaruRegion?: IaruRegion;
  countryCode?: string;
};

const EARTH_RADIUS_KM = 6371.0088;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function pointFromLocation(location: ResolvedAppLocation | GeoPoint | null | undefined): GeoPoint | null {
  if (!location) return null;
  return "resolvedPosition" in location ? location.resolvedPosition : location;
}

/** Great-circle distance using the IUGG mean Earth radius. */
export function haversineDistanceKm(from: GeoPoint, to: GeoPoint): number {
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round((2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) * 1000) / 1000;
}

export function isHackrfOneFrequencyCompatible(frequencyHz: number): boolean {
  return Number.isInteger(frequencyHz)
    && frequencyHz >= HACKRF_ONE_FREQUENCY_RANGE_HZ.minHz
    && frequencyHz <= HACKRF_ONE_FREQUENCY_RANGE_HZ.maxHz;
}

export function withHackrfCompatibility(entries: MorseCatalogEntry[]): MorseCatalogCompatibility[] {
  return entries.map((entry) => {
    if (entry.frequencyHz === null) {
      return { entry, compatible: false, incompatibilityReason: "This entry has no tunable point frequency." };
    }
    if (!isHackrfOneFrequencyCompatible(entry.frequencyHz)) {
      return {
        entry,
        compatible: false,
        incompatibilityReason: "HackRF One supports 1 MHz through 6 GHz; this point frequency is outside that range.",
      };
    }
    return { entry, compatible: true, incompatibilityReason: null };
  });
}

function matchesScope(entry: MorseCatalogEntry, expectedRegion: IaruRegion | undefined, expectedCountry: string | undefined): boolean {
  if (entry.applicability === "global") return true;
  if (entry.applicability === "unknown") return !expectedRegion && !expectedCountry;
  if (expectedRegion && entry.applicability === "iaru-region" && !entry.iaruRegions.includes(expectedRegion)) return false;
  if (expectedCountry && entry.applicability === "countries" && !entry.countryCodes.includes(expectedCountry)) return false;
  if (expectedRegion && entry.applicability === "countries") return true;
  if (expectedCountry && entry.applicability === "iaru-region") return true;
  if (expectedRegion && entry.iaruRegions.length > 0 && !entry.iaruRegions.includes(expectedRegion)) return false;
  if (expectedCountry && entry.countryCodes.length > 0 && !entry.countryCodes.includes(expectedCountry)) return false;
  return (!expectedRegion && !expectedCountry) || entry.iaruRegions.length > 0 || entry.countryCodes.length > 0;
}

export function filterMorseCatalog(entries: MorseCatalogEntry[], filter: MorseCatalogFilter = {}): MorseCatalogEntry[] {
  const countryCode = filter.countryCode?.toUpperCase();
  return entries.filter((entry) => (
    (!filter.sourceClasses || filter.sourceClasses.includes(entry.sourceClass))
    && matchesScope(entry, filter.iaruRegion, countryCode)
  ));
}

export function rankMorseCatalog(
  entries: MorseCatalogEntry[],
  location: ResolvedAppLocation | GeoPoint | null | undefined,
): RankedMorseCatalogEntry[] {
  const referencePoint = pointFromLocation(location);
  return withHackrfCompatibility(entries)
    .map((item) => ({
      ...item,
      distanceKm: referencePoint && item.entry.location ? haversineDistanceKm(referencePoint, item.entry.location) : null,
    }))
    .sort((left, right) => {
      if (left.distanceKm !== null && right.distanceKm !== null) return left.distanceKm - right.distanceKm;
      if (left.distanceKm !== null) return -1;
      if (right.distanceKm !== null) return 1;
      return left.entry.name.localeCompare(right.entry.name);
    });
}

export function toMorseRadioSessionChannels(entries: MorseCatalogCompatibility[]): RadioSessionChannel[] {
  return entries
    .filter((item): item is MorseCatalogCompatibility & { entry: MorseCatalogEntry & { frequencyHz: number } } => (
      item.compatible && item.entry.frequencyHz !== null
    ))
    .map(({ entry }, index) => ({
      id: `morse:${entry.id}`,
      bandId: "morse-catalog",
      number: index + 1,
      freqMhz: entry.frequencyHz / 1_000_000,
      label: entry.name,
      notes: `MORSE catalog: ${entry.sourceClass}${entry.identifier ? ` · ident ${entry.identifier}` : ""}`,
      expectedIdentifier: entry.identifier ?? null,
      catalogSource: entry.provenance.authority,
      catalogRecordId: entry.provenance.sourceRecordId ?? entry.id,
      catalogVersion: entry.provenance.publishedOrEffectiveDate,
    }));
}

export type MorseScanPlan = {
  channels: RadioSessionChannel[];
  excludedByLimit: number;
};

function scanPlanPreference(left: MorseCatalogEntry, right: MorseCatalogEntry): number {
  const identifierDiff = Number(Boolean(right.identifier)) - Number(Boolean(left.identifier));
  if (identifierDiff !== 0) return identifierDiff;
  const legalDiff = Number(right.provenance.classification === "legal") - Number(left.provenance.classification === "legal");
  if (legalDiff !== 0) return legalDiff;
  return left.id.localeCompare(right.id);
}

export function buildMorseScanPlan(entries: MorseCatalogEntry[], limit = 100): MorseScanPlan {
  const canonical = new Map<string, MorseCatalogEntry>();
  for (const entry of entries) {
    if (entry.frequencyHz === null || !isHackrfOneFrequencyCompatible(entry.frequencyHz)) continue;
    const key = `${entry.frequencyHz}:${entry.frontEnd ?? "cw_carrier"}`;
    const current = canonical.get(key);
    if (!current || scanPlanPreference(entry, current) < 0) canonical.set(key, entry);
  }
  const selected = [...canonical.values()]
    .sort((left, right) => left.frequencyHz! - right.frequencyHz! || left.id.localeCompare(right.id));
  const safeLimit = Math.max(0, Math.min(512, Math.floor(limit)));
  return {
    channels: toMorseRadioSessionChannels(withHackrfCompatibility(selected.slice(0, safeLimit))),
    excludedByLimit: Math.max(0, selected.length - safeLimit),
  };
}
