import type {
  AppLocationCatalogScope,
  AppLocationGpsdFallbackMode,
  GeoPoint,
  GpsdSnapshot,
  ResolvedAppLocation,
  StoredAppLocation,
} from "@/lib/types";

export const APP_LOCATION_KEY = "hackrf-webui.location.v2";

function trimString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function createEmptyCatalogScope(): AppLocationCatalogScope {
  return {
    regionId: null,
    regionName: null,
    countryId: null,
    countryCode: null,
    countryName: null,
    cityId: null,
    cityName: null,
    latitude: null,
    longitude: null,
  };
}

export function createEmptyStoredAppLocation(): StoredAppLocation {
  return {
    version: 2,
    configured: false,
    sourceMode: "catalog",
    gpsdFallbackMode: "catalog",
    catalogScope: createEmptyCatalogScope(),
    mapPin: null,
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeCatalogScope(value: unknown): AppLocationCatalogScope {
  const raw = value as Partial<AppLocationCatalogScope> | null | undefined;

  return {
    regionId: trimString(raw?.regionId),
    regionName: trimString(raw?.regionName),
    countryId: trimString(raw?.countryId),
    countryCode: trimString(raw?.countryCode),
    countryName: trimString(raw?.countryName),
    cityId: trimString(raw?.cityId),
    cityName: trimString(raw?.cityName),
    latitude: finiteNumber(raw?.latitude),
    longitude: finiteNumber(raw?.longitude),
  };
}

function normalizeGeoPoint(value: unknown): GeoPoint | null {
  const raw = value as Partial<GeoPoint> | null | undefined;
  const latitude = finiteNumber(raw?.latitude);
  const longitude = finiteNumber(raw?.longitude);
  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitude, longitude };
}

export function normalizeStoredAppLocation(value: unknown): StoredAppLocation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<StoredAppLocation>;
  const sourceMode =
    raw.sourceMode === "map" || raw.sourceMode === "gpsd" || raw.sourceMode === "catalog"
      ? raw.sourceMode
      : "catalog";
  const gpsdFallbackMode: AppLocationGpsdFallbackMode =
    raw.gpsdFallbackMode === "none" || raw.gpsdFallbackMode === "map" || raw.gpsdFallbackMode === "catalog"
      ? raw.gpsdFallbackMode
      : "catalog";

  return {
    version: 2,
    configured: raw.configured === true,
    sourceMode,
    gpsdFallbackMode,
    catalogScope: normalizeCatalogScope(raw.catalogScope),
    mapPin: normalizeGeoPoint(raw.mapPin),
    updatedAt: trimString(raw.updatedAt) ?? new Date().toISOString(),
  };
}

export function readStoredAppLocation(): StoredAppLocation | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(APP_LOCATION_KEY);
    if (!raw) {
      return null;
    }

    return normalizeStoredAppLocation(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeStoredAppLocation(location: StoredAppLocation): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(APP_LOCATION_KEY, JSON.stringify(location));
}

export function buildCatalogScopeLabel(scope: AppLocationCatalogScope): string {
  if (scope.cityName) {
    return scope.countryCode ? `${scope.cityName}, ${scope.countryCode}` : scope.cityName;
  }

  if (scope.countryName) {
    return scope.countryName;
  }

  if (scope.regionName) {
    return scope.regionName;
  }

  return "No catalog scope";
}

export function buildCatalogScopeCaption(scope: AppLocationCatalogScope): string {
  if (scope.cityName && scope.countryName) {
    return `${scope.cityName} in ${scope.countryName}`;
  }

  if (scope.countryName) {
    return `${scope.countryName} only`;
  }

  if (scope.regionName) {
    return `${scope.regionName} only`;
  }

  return "Global";
}

export function buildSourceModeLabel(
  sourceMode: StoredAppLocation["sourceMode"],
): string {
  switch (sourceMode) {
    case "gpsd":
      return "GPSD";
    case "map":
      return "Map pin";
    default:
      return "Catalog";
  }
}

export function buildGpsdFallbackLabel(mode: AppLocationGpsdFallbackMode): string {
  switch (mode) {
    case "none":
      return "No fallback";
    case "map":
      return "Map pin fallback";
    default:
      return "Catalog fallback";
  }
}

export function buildCatalogScopeFilters(scope: AppLocationCatalogScope): {
  regionFilter: string;
  countryFilter: string;
  cityFilter: string;
} {
  return {
    regionFilter: scope.regionId ?? "all",
    countryFilter: scope.countryId ?? "all",
    cityFilter: scope.cityId ?? "all",
  };
}

export function buildCatalogCentroid(scope: AppLocationCatalogScope): GeoPoint | null {
  if (scope.latitude === null || scope.longitude === null) {
    return null;
  }

  return {
    latitude: scope.latitude,
    longitude: scope.longitude,
  };
}

export function resolveAppLocation(
  location: StoredAppLocation | null,
  gpsd: GpsdSnapshot | null,
): ResolvedAppLocation {
  const current = location ?? createEmptyStoredAppLocation();
  const catalogCentroid = buildCatalogCentroid(current.catalogScope);
  const gpsFix =
    gpsd
    && gpsd.latitude !== null
    && gpsd.longitude !== null
    && (gpsd.fixState === "2d" || gpsd.fixState === "3d")
      ? { latitude: gpsd.latitude, longitude: gpsd.longitude }
      : null;

  if (current.sourceMode === "gpsd") {
    if (gpsFix) {
      return {
        configured: current.configured,
        sourceMode: current.sourceMode,
        gpsdFallbackMode: current.gpsdFallbackMode,
        catalogScope: current.catalogScope,
        mapPin: current.mapPin,
        resolvedPosition: gpsFix,
        sourceStatus: "ready",
        sourceDetail: gpsd?.fixState === "3d" ? "GPSD 3D fix" : "GPSD 2D fix",
      };
    }

    const fallbackPosition =
      current.gpsdFallbackMode === "map"
        ? current.mapPin
        : current.gpsdFallbackMode === "catalog"
          ? catalogCentroid
          : null;
    const fallbackDetail =
      current.gpsdFallbackMode === "map"
        ? current.mapPin
          ? "GPSD waiting, using map pin fallback"
          : "GPSD waiting, map pin fallback is not configured"
        : current.gpsdFallbackMode === "catalog"
          ? catalogCentroid
            ? "GPSD waiting, using catalog fallback"
            : "GPSD waiting, catalog fallback is not configured"
          : "GPSD waiting, no fallback configured";

    return {
      configured: current.configured,
      sourceMode: current.sourceMode,
      gpsdFallbackMode: current.gpsdFallbackMode,
      catalogScope: current.catalogScope,
      mapPin: current.mapPin,
      resolvedPosition: fallbackPosition,
      sourceStatus:
        gpsd?.available
          ? fallbackPosition
            ? "ready"
            : "waiting"
          : fallbackPosition
            ? "ready"
            : "unavailable",
      sourceDetail: gpsd?.available ? fallbackDetail : gpsd?.message ?? "GPSD unavailable",
    };
  }

  if (current.sourceMode === "map") {
    return {
      configured: current.configured,
      sourceMode: current.sourceMode,
      gpsdFallbackMode: current.gpsdFallbackMode,
      catalogScope: current.catalogScope,
      mapPin: current.mapPin,
      resolvedPosition: current.mapPin ?? catalogCentroid,
      sourceStatus: current.mapPin ? "ready" : "waiting",
      sourceDetail: current.mapPin ? "Exact map pin" : "Select a point on the map",
    };
  }

  return {
    configured: current.configured,
    sourceMode: current.sourceMode,
    gpsdFallbackMode: current.gpsdFallbackMode,
    catalogScope: current.catalogScope,
    mapPin: current.mapPin,
    resolvedPosition: catalogCentroid,
    sourceStatus: catalogCentroid ? "ready" : "waiting",
    sourceDetail: catalogCentroid ? "Catalog centroid" : "Choose a country or city",
  };
}
