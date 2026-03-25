import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type {
  GeoBounds,
  OfflineMapLayerRole,
  OfflineMapLayerSummary,
  OfflineMapSummary,
} from "@/lib/types";

type LocalMapLayerManifest = {
  id?: string;
  role?: OfflineMapLayerRole;
  countryId?: string;
  countryName?: string;
  kind?: "raster" | "pmtiles";
  name?: string;
  tileUrlTemplate?: string;
  pmtilesUrl?: string;
  flavor?: "light" | "dark" | "white" | "grayscale" | "black";
  lang?: string;
  attribution?: string;
  bounds?: GeoBounds | null;
  minZoom?: number;
  maxZoom?: number;
  installedAt?: string;
  filePath?: string;
  fileSizeBytes?: number;
};

type LocalMapManifest = {
  version: 1;
  name?: string;
  theme?: "light" | "dark" | "white" | "grayscale" | "black";
  source?: string;
  globalBudgetBytes?: number | null;
  installedAt?: string;
  layers?: LocalMapLayerManifest[];
};

const DEFAULT_TILE_URL_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_TILE_ATTRIBUTION = "\u00a9 OpenStreetMap contributors";
const MAP_MANIFEST_PATH = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "public",
  "tiles",
  "osm",
  "manifest.json",
);

function normalizePmtilesFlavor(
  value: string | undefined,
): "light" | "dark" | "white" | "grayscale" | "black" {
  const normalized = value?.trim();
  switch (normalized) {
    case "light":
    case "white":
    case "grayscale":
    case "black":
    case "dark":
      return normalized;
    default:
      return "dark";
  }
}

function normalizeLayer(
  manifest: LocalMapLayerManifest | undefined,
  defaults: {
    id: string;
    role: OfflineMapLayerRole;
    countryId?: string | null;
    countryName?: string | null;
    name: string;
  },
  manifestPath: string | null,
): OfflineMapLayerSummary | null {
  if (!manifest) {
    return null;
  }

  const kind = manifest.kind === "pmtiles" ? "pmtiles" : "raster";
  const minZoom = typeof manifest.minZoom === "number" ? Math.max(0, manifest.minZoom) : 0;
  const maxZoom = typeof manifest.maxZoom === "number" ? Math.max(0, manifest.maxZoom) : 12;
  return {
    id: manifest.id?.trim() || defaults.id,
    role: manifest.role === "country" ? "country" : defaults.role,
    countryId: manifest.countryId?.trim() || defaults.countryId || null,
    countryName: manifest.countryName?.trim() || defaults.countryName || null,
    kind,
    name: manifest.name?.trim() || defaults.name,
    tileUrlTemplate:
      kind === "raster"
        ? manifest.tileUrlTemplate?.trim() || "/tiles/osm/{z}/{x}/{y}.png"
        : null,
    pmtilesUrl:
      kind === "pmtiles"
        ? manifest.pmtilesUrl?.trim() || "/tiles/osm/global/world.pmtiles"
        : null,
    flavor: kind === "pmtiles" ? normalizePmtilesFlavor(manifest.flavor) : null,
    lang: kind === "pmtiles" ? manifest.lang?.trim() || "en" : null,
    attribution: manifest.attribution?.trim() || DEFAULT_TILE_ATTRIBUTION,
    bounds: manifest.bounds ?? null,
    minZoom,
    maxZoom,
    installedAt: manifest.installedAt?.trim() || null,
    manifestPath,
  };
}

function mergeLayerBounds(layers: OfflineMapLayerSummary[]): GeoBounds | null {
  const positioned = layers.filter((layer): layer is OfflineMapLayerSummary & { bounds: GeoBounds } =>
    layer.bounds !== null,
  );
  if (positioned.length === 0) {
    return null;
  }

  let west = positioned[0].bounds.west;
  let east = positioned[0].bounds.east;
  let south = positioned[0].bounds.south;
  let north = positioned[0].bounds.north;

  for (const layer of positioned) {
    west = Math.min(west, layer.bounds.west);
    east = Math.max(east, layer.bounds.east);
    south = Math.min(south, layer.bounds.south);
    north = Math.max(north, layer.bounds.north);
  }

  return { west, south, east, north };
}

function emptySummary(manifestPath: string | null): OfflineMapSummary {
  return {
    version: 1,
    available: false,
    mode: "remote-live",
    kind: "raster",
    name: "OpenStreetMap Live",
    tileUrlTemplate: DEFAULT_TILE_URL_TEMPLATE,
    pmtilesUrl: null,
    flavor: null,
    lang: null,
    attribution: DEFAULT_TILE_ATTRIBUTION,
    bounds: null,
    minZoom: 3,
    maxZoom: 19,
    installedAt: null,
    manifestPath,
    countryLayerCount: 0,
    layers: [],
  };
}

export function mapManifestPath(): string {
  return MAP_MANIFEST_PATH;
}

export function buildOfflineMapSummary(warnings: string[]): OfflineMapSummary {
  if (!existsSync(MAP_MANIFEST_PATH)) {
    warnings.push(
      "Offline maps are not installed. The map will use live OpenStreetMap tiles until local layers are installed.",
    );
    return emptySummary(null);
  }

  try {
    const manifest = JSON.parse(readFileSync(MAP_MANIFEST_PATH, "utf8")) as LocalMapManifest;
    const manifestPath = MAP_MANIFEST_PATH;

    if (manifest.version !== 1 || !Array.isArray(manifest.layers)) {
      warnings.push("The offline map manifest is present but has an unsupported format.");
      return emptySummary(manifestPath);
    }

    const layers = manifest.layers
      .map((layer, index) =>
        normalizeLayer(
          layer,
          {
            id: layer.id?.trim() || `layer-${index}`,
            role: layer.role === "country" ? "country" : "global",
            countryId: layer.countryId?.trim() || null,
            countryName: layer.countryName?.trim() || null,
            name:
              layer.name?.trim()
              || layer.countryName?.trim()
              || layer.countryId?.trim()
              || `Layer ${index + 1}`,
          },
          manifestPath,
        ),
      )
      .filter((layer): layer is OfflineMapLayerSummary => Boolean(layer));

    const primaryLayer = layers.find((layer) => layer.role === "global") ?? layers[0];
    if (!primaryLayer) {
      warnings.push("The offline map manifest does not define any layers.");
      return emptySummary(manifestPath);
    }

    const minZoom = Math.min(...layers.map((layer) => layer.minZoom));
    const maxZoom = Math.max(...layers.map((layer) => layer.maxZoom));
    const countryLayerCount = layers.filter((layer) => layer.role === "country").length;
    const latestInstalledAt =
      manifest.installedAt?.trim()
      || layers
        .map((layer) => layer.installedAt)
        .filter((value): value is string => Boolean(value))
        .sort((left, right) => left.localeCompare(right))
        .at(-1)
      || null;

    return {
      version: 1,
      available: true,
      mode: "local-pack",
      kind: primaryLayer.kind,
      name: manifest.name?.trim() || primaryLayer.name,
      tileUrlTemplate: primaryLayer.tileUrlTemplate,
      pmtilesUrl: primaryLayer.pmtilesUrl,
      flavor: primaryLayer.flavor,
      lang: primaryLayer.lang,
      attribution: primaryLayer.attribution,
      bounds: mergeLayerBounds(layers) ?? primaryLayer.bounds,
      minZoom,
      maxZoom,
      installedAt: latestInstalledAt,
      manifestPath,
      countryLayerCount,
      layers,
    };
  } catch {
    warnings.push("The offline map manifest is present but could not be parsed.");
    return emptySummary(MAP_MANIFEST_PATH);
  }
}
