import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { GeoBounds, MapTilePackSummary } from "@/lib/types";

type LocalTilePackManifest = {
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
};

const DEFAULT_TILE_URL_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_TILE_ATTRIBUTION = "\u00a9 OpenStreetMap contributors";
const TILE_PACK_MANIFEST_PATH = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "public",
  "tiles",
  "osm",
  "manifest.json",
);

function normalizePmtilesFlavor(
  value: string | undefined,
): "light" | "dark" | "white" | "grayscale" | "black" {
  const trimmed = value?.trim();

  switch (trimmed) {
    case "light":
    case "white":
    case "grayscale":
    case "black":
      return trimmed;
    default:
      return "dark";
  }
}

export function mapTilePackManifestPath(): string {
  return TILE_PACK_MANIFEST_PATH;
}

export function buildTilePackSummary(warnings: string[]): MapTilePackSummary {
  if (!existsSync(TILE_PACK_MANIFEST_PATH)) {
    warnings.push(
      "Offline map tiles are not installed. The map will use live OpenStreetMap tiles until a local pack is installed.",
    );

    return {
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
      manifestPath: null,
    };
  }

  try {
    const manifest = JSON.parse(readFileSync(TILE_PACK_MANIFEST_PATH, "utf8")) as LocalTilePackManifest;
    const kind = manifest.kind === "pmtiles" ? "pmtiles" : "raster";
    return {
      available: true,
      mode: "local-pack",
      kind,
      name:
        manifest.name?.trim()
        || (kind === "pmtiles" ? "Protomaps Dark Offline World" : "Offline Tile Pack"),
      tileUrlTemplate:
        kind === "raster"
          ? manifest.tileUrlTemplate?.trim() || "/tiles/osm/{z}/{x}/{y}.png"
          : null,
      pmtilesUrl:
        kind === "pmtiles"
          ? manifest.pmtilesUrl?.trim() || "/tiles/osm/world.pmtiles"
          : null,
      flavor: kind === "pmtiles" ? normalizePmtilesFlavor(manifest.flavor) : null,
      lang: kind === "pmtiles" ? manifest.lang?.trim() || "en" : null,
      attribution: manifest.attribution?.trim() || DEFAULT_TILE_ATTRIBUTION,
      bounds: manifest.bounds ?? null,
      minZoom: Number.isFinite(manifest.minZoom) ? Math.max(0, manifest.minZoom!) : 0,
      maxZoom: Number.isFinite(manifest.maxZoom) ? Math.max(0, manifest.maxZoom!) : 12,
      installedAt: manifest.installedAt?.trim() || null,
      manifestPath: TILE_PACK_MANIFEST_PATH,
    };
  } catch {
    warnings.push("The offline map-pack manifest is present but could not be parsed.");

    return {
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
      manifestPath: TILE_PACK_MANIFEST_PATH,
    };
  }
}
