import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAP_ROOT_DIR = resolve(ROOT_DIR, "public", "tiles", "osm");
const MANIFEST_PATH = join(MAP_ROOT_DIR, "manifest.json");
const GLOBAL_DIR = join(MAP_ROOT_DIR, "global");
const GLOBAL_PMTILES_PATH = join(GLOBAL_DIR, "world.pmtiles");
const COUNTRY_DIR = join(MAP_ROOT_DIR, "countries");
const CACHE_DIR = resolve(ROOT_DIR, ".cache", "maps");
const PMTILES_CACHE_DIR = join(CACHE_DIR, "pmtiles");
const CATALOG_MANIFEST_PATH = resolve(ROOT_DIR, "src", "data", "catalog", "manifest.json");
const COUNTRY_SHARDS_DIR = resolve(ROOT_DIR, "public", "catalog", "countries");

const DEFAULT_PM_SOURCE =
  process.env.MAP_DEFAULT_SOURCE?.trim()
  || "https://data.source.coop/protomaps/openstreetmap/v4.pmtiles";
const DEFAULT_THEME = "dark";
const DEFAULT_LANG = "en";
const DEFAULT_GLOBAL_BUDGET = "4G";
const DEFAULT_COUNTRY_MAX_ZOOM = 14;
const DEFAULT_DOWNLOAD_THREADS = 8;
const MIN_SUPPORTED_ZOOM = 0;
const MAX_SUPPORTED_ZOOM = 15;
const DEFAULT_ATTRIBUTION = "\u00a9 Protomaps \u00a9 OpenStreetMap contributors";

const GLOBAL_PROFILES = [
  { id: "compact", maxZoom: 8, estimatedSizeBytes: 526 * 1024 * 1024 },
  { id: "balanced", maxZoom: 9, estimatedSizeBytes: Math.round(1.5 * 1024 * 1024 * 1024) },
  { id: "detailed", maxZoom: 10, estimatedSizeBytes: Math.round(3.5 * 1024 * 1024 * 1024) },
  { id: "xdetail", maxZoom: 11, estimatedSizeBytes: Math.round(7.4 * 1024 * 1024 * 1024) },
  { id: "ultra", maxZoom: 12, estimatedSizeBytes: 16 * 1024 * 1024 * 1024 },
  { id: "max", maxZoom: 13, estimatedSizeBytes: 33 * 1024 * 1024 * 1024 },
];

function log(message) {
  process.stdout.write(`[maps] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[maps] error: ${message}\n`);
  process.exit(1);
}

function usage() {
  process.stdout.write(`Usage: ./manage_maps.sh <command> [options]

Commands:
  status
  ensure
  install-global
  add-country <country>
  remove-country <country>
  list-countries
  clean

Options:
  --global-budget <size>       Global layer storage target. Default: ${DEFAULT_GLOBAL_BUDGET}
  --global-max-zoom <z>        Force the global layer max zoom.
  --country <value>            Country id, ISO code or exact name.
  --country-max-zoom <z>       Country overlay max zoom. Default: ${DEFAULT_COUNTRY_MAX_ZOOM}
  --reinstall                  Rebuild matching managed layers.
  --yes                        Skip confirmation prompts where applicable.
  --dry-run                    Print the work without writing files.
  -h, --help                   Show this help text.
`);
}

function parseInteger(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    fail(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function ensureZoom(value, label) {
  const zoom = parseInteger(value, label);
  if (zoom < MIN_SUPPORTED_ZOOM || zoom > MAX_SUPPORTED_ZOOM) {
    fail(`${label} must be between ${MIN_SUPPORTED_ZOOM} and ${MAX_SUPPORTED_ZOOM}.`);
  }
  return zoom;
}

function parseSize(value) {
  const trimmed = String(value).trim().toUpperCase();
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([KMGTP]?B?)?$/.exec(trimmed);
  if (!match) {
    fail(`Invalid size value: ${value}`);
  }

  const amount = Number.parseFloat(match[1]);
  const unit = (match[2] || "B").replace(/B$/, "");
  const power =
    unit === ""
      ? 0
      : unit === "K"
        ? 1
        : unit === "M"
          ? 2
          : unit === "G"
            ? 3
            : unit === "T"
              ? 4
              : unit === "P"
                ? 5
                : null;

  if (power === null) {
    fail(`Unsupported size suffix in ${value}`);
  }

  return Math.round(amount * 1024 ** power);
}

function humanSize(sizeBytes) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = sizeBytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);

  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function commandAvailable(command, args = ["--help"]) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

  if (result.error) {
    fail(`Could not run ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = `${result.stderr || ""}`.trim();
    fail(`${command} ${args.join(" ")} failed.${stderr ? ` ${stderr}` : ""}`);
  }

  return result;
}

function runStreaming(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    fail(`Could not run ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed.`);
  }
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "hackrf-webui/manage-maps",
      "X-Map-Installer": "offline-basemap",
    },
  });

  if (!response.ok) {
    fail(`Could not download ${url} (${response.status}).`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function resolvePmtilesReleaseAsset() {
  const response = await fetch("https://api.github.com/repos/protomaps/go-pmtiles/releases/latest", {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "hackrf-webui/manage-maps",
      "X-Map-Installer": "offline-basemap",
    },
  });

  if (!response.ok) {
    fail(`Could not resolve the latest go-pmtiles release (${response.status}).`);
  }

  const release = await response.json();
  const assets = Array.isArray(release.assets) ? release.assets : [];

  let expectedSuffix = "";
  if (process.platform === "linux" && process.arch === "x64") {
    expectedSuffix = "_Linux_x86_64.tar.gz";
  } else if (process.platform === "linux" && process.arch === "arm64") {
    expectedSuffix = "_Linux_arm64.tar.gz";
  } else if (process.platform === "darwin" && process.arch === "x64") {
    expectedSuffix = "_Darwin_x86_64.zip";
  } else if (process.platform === "darwin" && process.arch === "arm64") {
    expectedSuffix = "_Darwin_arm64.zip";
  } else {
    fail(`Unsupported platform for automatic pmtiles CLI download: ${process.platform}/${process.arch}`);
  }

  const asset = assets.find((entry) => typeof entry.name === "string" && entry.name.endsWith(expectedSuffix));
  if (!asset?.browser_download_url || !asset.name) {
    fail(`Could not find a go-pmtiles asset for ${process.platform}/${process.arch}.`);
  }

  return asset;
}

async function ensurePmtilesCli() {
  const explicit = process.env.PMTILES_BIN?.trim();
  if (explicit) {
    const resolved = resolve(ROOT_DIR, explicit);
    if (!existsSync(resolved)) {
      fail(`PMTILES_BIN points to a missing file: ${resolved}`);
    }
    return resolved;
  }

  if (commandAvailable("pmtiles")) {
    return "pmtiles";
  }

  mkdirSync(PMTILES_CACHE_DIR, { recursive: true });
  const binaryPath = join(PMTILES_CACHE_DIR, "pmtiles");
  if (existsSync(binaryPath)) {
    chmodSync(binaryPath, 0o755);
    return binaryPath;
  }

  const asset = await resolvePmtilesReleaseAsset();
  const archivePath = join(PMTILES_CACHE_DIR, asset.name);
  log(`Downloading go-pmtiles CLI from ${asset.browser_download_url}`);
  writeFileSync(archivePath, await fetchBuffer(asset.browser_download_url));

  rmSync(binaryPath, { force: true });
  if (asset.name.endsWith(".zip")) {
    run("unzip", ["-o", archivePath, "-d", PMTILES_CACHE_DIR]);
  } else if (asset.name.endsWith(".tar.gz")) {
    run("tar", ["-xzf", archivePath, "-C", PMTILES_CACHE_DIR]);
  } else {
    fail(`Unsupported go-pmtiles archive format: ${asset.name}`);
  }

  rmSync(archivePath, { force: true });
  if (!existsSync(binaryPath)) {
    fail("The go-pmtiles archive was downloaded, but the pmtiles binary was not extracted.");
  }

  chmodSync(binaryPath, 0o755);
  return binaryPath;
}

function ensureDirs() {
  mkdirSync(MAP_ROOT_DIR, { recursive: true });
  mkdirSync(GLOBAL_DIR, { recursive: true });
  mkdirSync(COUNTRY_DIR, { recursive: true });
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(PMTILES_CACHE_DIR, { recursive: true });
}

function pathToUrl(filePath) {
  const relativePath = relative(MAP_ROOT_DIR, filePath).replace(/\\/g, "/");
  return `/tiles/osm/${relativePath}`;
}

function filePathRelativeToRoot(filePath) {
  return relative(ROOT_DIR, filePath).replace(/\\/g, "/");
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeCountryCode(value) {
  return String(value).trim().toUpperCase();
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== "object") {
    return null;
  }

  const west = Number(bounds.west);
  const south = Number(bounds.south);
  const east = Number(bounds.east);
  const north = Number(bounds.north);
  if (![west, south, east, north].every((value) => Number.isFinite(value))) {
    return null;
  }

  return {
    west: Math.max(-180, Math.min(180, west)),
    south: Math.max(-85, Math.min(85, south)),
    east: Math.max(-180, Math.min(180, east)),
    north: Math.max(-85, Math.min(85, north)),
  };
}

function normalizeLayer(layer) {
  if (!layer || typeof layer !== "object" || typeof layer.id !== "string" || typeof layer.name !== "string") {
    fail("Map manifest contains an invalid layer entry.");
  }

  const role = layer.role === "country" ? "country" : layer.role === "global" ? "global" : null;
  if (!role) {
    fail(`Map manifest layer '${layer.id}' has an invalid role.`);
  }

  const kind = layer.kind === "pmtiles" ? "pmtiles" : null;
  if (!kind) {
    fail(`Map manifest layer '${layer.id}' has an unsupported kind.`);
  }

  const minZoom = ensureZoom(layer.minZoom ?? MIN_SUPPORTED_ZOOM, `min zoom for ${layer.id}`);
  const maxZoom = ensureZoom(layer.maxZoom ?? minZoom, `max zoom for ${layer.id}`);
  if (maxZoom < minZoom) {
    fail(`Map manifest layer '${layer.id}' has max zoom below min zoom.`);
  }

  const filePath = typeof layer.filePath === "string" && layer.filePath.trim()
    ? layer.filePath.trim()
    : null;

  return {
    id: layer.id.trim(),
    role,
    kind,
    name: layer.name.trim(),
    countryId: role === "country" && typeof layer.countryId === "string" ? layer.countryId.trim() : null,
    countryName: role === "country" && typeof layer.countryName === "string" ? layer.countryName.trim() : null,
    tileUrlTemplate: null,
    pmtilesUrl:
      typeof layer.pmtilesUrl === "string" && layer.pmtilesUrl.trim()
        ? layer.pmtilesUrl.trim()
        : null,
    filePath,
    fileSizeBytes: Number.isFinite(layer.fileSizeBytes) ? Math.max(0, layer.fileSizeBytes) : 0,
    flavor: DEFAULT_THEME,
    lang: DEFAULT_LANG,
    attribution:
      typeof layer.attribution === "string" && layer.attribution.trim()
        ? layer.attribution.trim()
        : DEFAULT_ATTRIBUTION,
    bounds: normalizeBounds(layer.bounds),
    minZoom,
    maxZoom,
    installedAt:
      typeof layer.installedAt === "string" && layer.installedAt.trim()
        ? layer.installedAt.trim()
        : null,
  };
}

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    return null;
  }

  const manifest = readJson(MANIFEST_PATH);
  if (!manifest || typeof manifest !== "object") {
    fail("Map manifest exists but could not be parsed. Run ./manage_maps.sh clean and reinstall.");
  }

  if (manifest.version !== 1 || !Array.isArray(manifest.layers)) {
    fail("Map manifest exists but is not a managed version 1 manifest. Run ./manage_maps.sh clean and reinstall.");
  }

  const layers = manifest.layers.map(normalizeLayer);
  return {
    version: 1,
    name:
      typeof manifest.name === "string" && manifest.name.trim()
        ? manifest.name.trim()
        : "Managed offline maps",
    theme: manifest.theme === DEFAULT_THEME ? DEFAULT_THEME : DEFAULT_THEME,
    source:
      typeof manifest.source === "string" && manifest.source.trim()
        ? manifest.source.trim()
        : DEFAULT_PM_SOURCE,
    globalBudgetBytes: Number.isFinite(manifest.globalBudgetBytes) ? Math.max(0, manifest.globalBudgetBytes) : null,
    installedAt:
      typeof manifest.installedAt === "string" && manifest.installedAt.trim()
        ? manifest.installedAt.trim()
        : null,
    layers,
  };
}

function loadCatalogCountries() {
  const manifest = readJson(CATALOG_MANIFEST_PATH);
  const countries = Array.isArray(manifest?.countries) ? manifest.countries : [];
  return countries.map((country) => ({
    id: String(country.id),
    code: normalizeCountryCode(country.code || ""),
    name: String(country.name),
  }));
}

function resolveCountry(value) {
  const query = String(value || "").trim();
  if (!query) {
    fail("A country id, ISO code or exact country name is required.");
  }

  const normalized = query.toLowerCase();
  const normalizedCode = normalizeCountryCode(query);
  const countries = loadCatalogCountries();

  const byId = countries.find((country) => country.id === normalized);
  if (byId) {
    return byId;
  }

  const byCode = countries.find((country) => country.code === normalizedCode);
  if (byCode) {
    return byCode;
  }

  const byName = countries.find((country) => country.name.toLowerCase() === normalized);
  if (byName) {
    return byName;
  }

  fail(`Could not resolve country '${value}'. Use list-countries to inspect the catalog ids.`);
}

function resolveCountryBounds(countryId) {
  const shardPath = join(COUNTRY_SHARDS_DIR, `${countryId}.json`);
  const shard = readJson(shardPath);
  const cities = Array.isArray(shard?.cities) ? shard.cities : [];
  if (cities.length === 0) {
    fail(`Could not derive map bounds for ${countryId}; no city shard was found.`);
  }

  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  for (const city of cities) {
    if (!Number.isFinite(city.longitude) || !Number.isFinite(city.latitude)) {
      continue;
    }
    west = Math.min(west, city.longitude);
    east = Math.max(east, city.longitude);
    south = Math.min(south, city.latitude);
    north = Math.max(north, city.latitude);
  }

  if (!Number.isFinite(west) || !Number.isFinite(east) || !Number.isFinite(south) || !Number.isFinite(north)) {
    fail(`Could not derive valid map bounds for ${countryId}.`);
  }

  const latPad = Math.max((north - south) * 0.08, 0.25);
  const lonPad = Math.max((east - west) * 0.08, 0.25);

  return {
    west: Math.max(-180, west - lonPad),
    east: Math.min(180, east + lonPad),
    south: Math.max(-85, south - latPad),
    north: Math.min(85, north + latPad),
  };
}

function boundsToBbox(bounds) {
  return `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
}

function chooseGlobalProfileFromBudget(budgetBytes) {
  const eligible = GLOBAL_PROFILES.filter((profile) => profile.estimatedSizeBytes <= budgetBytes);
  if (eligible.length > 0) {
    return eligible[eligible.length - 1];
  }
  return GLOBAL_PROFILES[0];
}

function buildLayerRecord({
  id,
  role,
  name,
  filePath,
  minZoom,
  maxZoom,
  bounds = null,
  countryId = null,
  countryName = null,
}) {
  const sizeBytes = existsSync(filePath) ? statSync(filePath).size : 0;
  return {
    id,
    role,
    kind: "pmtiles",
    name,
    countryId,
    countryName,
    tileUrlTemplate: null,
    pmtilesUrl: pathToUrl(filePath),
    filePath: filePathRelativeToRoot(filePath),
    fileSizeBytes: sizeBytes,
    flavor: DEFAULT_THEME,
    lang: DEFAULT_LANG,
    attribution: DEFAULT_ATTRIBUTION,
    bounds,
    minZoom,
    maxZoom,
    installedAt: new Date().toISOString(),
  };
}

function totalLayerBytes(layers) {
  return layers.reduce((sum, layer) => sum + (layer.fileSizeBytes || 0), 0);
}

function writeManifest(layers, metadata = {}) {
  const orderedLayers = [
    ...layers.filter((layer) => layer.role === "global"),
    ...layers
      .filter((layer) => layer.role === "country")
      .sort((left, right) => (left.countryName || left.name).localeCompare(right.countryName || right.name)),
  ];

  const manifest = {
    version: 1,
    name: "Managed offline maps",
    theme: DEFAULT_THEME,
    source: metadata.source ?? DEFAULT_PM_SOURCE,
    globalBudgetBytes: metadata.globalBudgetBytes ?? null,
    installedAt: new Date().toISOString(),
    layers: orderedLayers,
  };

  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function printStatus() {
  const manifest = readManifest();
  if (!manifest) {
    log("No offline maps installed.");
    return;
  }

  const globalLayer = manifest.layers.find((layer) => layer.role === "global") || null;
  const countryLayers = manifest.layers.filter((layer) => layer.role === "country");

  log(`Manifest version: ${manifest.version}`);
  log(`Theme: ${manifest.theme}`);
  log(`Source: ${manifest.source}`);
  if (manifest.globalBudgetBytes !== null) {
    log(`Global budget: ${humanSize(manifest.globalBudgetBytes)}`);
  }

  if (globalLayer) {
    log(
      `Global layer: ${globalLayer.name} (${humanSize(globalLayer.fileSizeBytes)}, z${globalLayer.minZoom}-z${globalLayer.maxZoom})`,
    );
  } else {
    log("Global layer: missing");
  }

  log(`Country overlays: ${countryLayers.length}`);
  for (const layer of countryLayers) {
    log(
      `- ${layer.countryName || layer.countryId || layer.id}: ${humanSize(layer.fileSizeBytes)}, z${layer.minZoom}-z${layer.maxZoom}`,
    );
  }

  log(`Total size: ${humanSize(totalLayerBytes(manifest.layers))}`);
}

async function confirmOrFail(message, assumeYes) {
  if (assumeYes) {
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail(`${message} Re-run with --yes in non-interactive mode.`);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(`${message} [y/N] `);
    if (!/^(y|yes)$/i.test(answer.trim())) {
      log("Cancelled.");
      process.exit(0);
    }
  } finally {
    rl.close();
  }
}

function atomicExtractTargetPath(filePath) {
  return `${filePath}.partial`;
}

function extractPmtiles({
  pmtilesBin,
  outputPath,
  minZoom = null,
  maxZoom,
  bounds = null,
}) {
  ensureDirs();
  const tempPath = atomicExtractTargetPath(outputPath);
  rmSync(tempPath, { force: true });

  const args = [
    "extract",
    DEFAULT_PM_SOURCE,
    tempPath,
    `--maxzoom=${maxZoom}`,
    `--download-threads=${DEFAULT_DOWNLOAD_THREADS}`,
  ];

  if (minZoom !== null) {
    args.push(`--minzoom=${minZoom}`);
  }

  if (bounds) {
    args.push(`--bbox=${boundsToBbox(bounds)}`);
  }

  runStreaming(pmtilesBin, args);
  rmSync(outputPath, { force: true });
  renameSync(tempPath, outputPath);
}

async function installGlobalLayer({
  globalBudgetBytes,
  globalMaxZoom,
  reinstall,
  dryRun,
}) {
  const targetProfile = globalMaxZoom === null
    ? chooseGlobalProfileFromBudget(globalBudgetBytes)
    : {
        id: "custom",
        maxZoom: globalMaxZoom,
        estimatedSizeBytes: 0,
      };

  const existing = readManifest();
  const existingGlobal = existing?.layers.find((layer) => layer.role === "global") || null;
  if (
    existingGlobal
    && existingGlobal.kind === "pmtiles"
    && existsSync(resolve(ROOT_DIR, existingGlobal.filePath))
    && !reinstall
  ) {
    if (existingGlobal.maxZoom >= targetProfile.maxZoom) {
      if (existingGlobal.maxZoom === targetProfile.maxZoom) {
        log(`Global layer already present at z${targetProfile.maxZoom}.`);
      } else {
        log(
          `Keeping existing global layer at z${existingGlobal.maxZoom}; requested z${targetProfile.maxZoom} would be lower.`,
        );
      }
      return existingGlobal;
    }
  }

  if (dryRun) {
    log(
      `Would install global layer at z${targetProfile.maxZoom} (${targetProfile.id}, budget ${humanSize(globalBudgetBytes)}).`,
    );
    return {
      id: "global",
      role: "global",
      kind: "pmtiles",
      name: `Protomaps Dark World z${targetProfile.maxZoom}`,
      countryId: null,
      countryName: null,
      tileUrlTemplate: null,
      pmtilesUrl: pathToUrl(GLOBAL_PMTILES_PATH),
      filePath: filePathRelativeToRoot(GLOBAL_PMTILES_PATH),
      fileSizeBytes: 0,
      flavor: DEFAULT_THEME,
      lang: DEFAULT_LANG,
      attribution: DEFAULT_ATTRIBUTION,
      bounds: null,
      minZoom: 0,
      maxZoom: targetProfile.maxZoom,
      installedAt: null,
    };
  }

  const pmtilesBin = await ensurePmtilesCli();
  log(`Installing global layer up to z${targetProfile.maxZoom} (budget ${humanSize(globalBudgetBytes)}).`);
  extractPmtiles({
    pmtilesBin,
    outputPath: GLOBAL_PMTILES_PATH,
    maxZoom: targetProfile.maxZoom,
  });

  return buildLayerRecord({
    id: "global",
    role: "global",
    name: `Protomaps Dark World z${targetProfile.maxZoom}`,
    filePath: GLOBAL_PMTILES_PATH,
    minZoom: 0,
    maxZoom: targetProfile.maxZoom,
  });
}

async function installCountryLayer({
  country,
  countryMaxZoom,
  globalMaxZoom,
  reinstall,
  dryRun,
}) {
  const overlayMinZoom = globalMaxZoom + 1;
  if (countryMaxZoom <= globalMaxZoom) {
    fail(
      `Country max zoom z${countryMaxZoom} must be higher than the global max zoom z${globalMaxZoom}.`,
    );
  }

  const existing = readManifest();
  const existingLayer = existing?.layers.find(
    (layer) => layer.role === "country" && layer.countryId === country.id,
  ) || null;
  if (
    existingLayer
    && existsSync(resolve(ROOT_DIR, existingLayer.filePath))
    && !reinstall
  ) {
    if (existingLayer.maxZoom >= countryMaxZoom) {
      if (existingLayer.minZoom === overlayMinZoom && existingLayer.maxZoom === countryMaxZoom) {
        log(`${country.name} overlay already present.`);
      } else {
        log(
          `Keeping existing ${country.name} overlay at z${existingLayer.minZoom}-z${existingLayer.maxZoom}.`,
        );
      }
      return existingLayer;
    }
  }

  const bounds = resolveCountryBounds(country.id);
  const outputPath = join(COUNTRY_DIR, `${country.code.toLowerCase()}.pmtiles`);

  if (dryRun) {
    log(`Would install ${country.name} overlay at z${overlayMinZoom}-z${countryMaxZoom}.`);
    return {
      id: `country-${country.code.toLowerCase()}`,
      role: "country",
      kind: "pmtiles",
      name: `${country.name} high detail`,
      countryId: country.id,
      countryName: country.name,
      tileUrlTemplate: null,
      pmtilesUrl: pathToUrl(outputPath),
      filePath: filePathRelativeToRoot(outputPath),
      fileSizeBytes: 0,
      flavor: DEFAULT_THEME,
      lang: DEFAULT_LANG,
      attribution: DEFAULT_ATTRIBUTION,
      bounds,
      minZoom: overlayMinZoom,
      maxZoom: countryMaxZoom,
      installedAt: null,
    };
  }

  const pmtilesBin = await ensurePmtilesCli();
  log(`Installing ${country.name} overlay up to z${countryMaxZoom}.`);
  extractPmtiles({
    pmtilesBin,
    outputPath,
    minZoom: overlayMinZoom,
    maxZoom: countryMaxZoom,
    bounds,
  });

  return buildLayerRecord({
    id: `country-${country.code.toLowerCase()}`,
    role: "country",
    name: `${country.name} high detail`,
    filePath: outputPath,
    minZoom: overlayMinZoom,
    maxZoom: countryMaxZoom,
    bounds,
    countryId: country.id,
    countryName: country.name,
  });
}

async function ensureManagedMaps(options) {
  const requestedCountry = options.country ? resolveCountry(options.country) : null;
  const existing = readManifest();
  const existingCountryLayers = (existing?.layers || []).filter((layer) => layer.role === "country");
  const preservedCountryLayers = existingCountryLayers.filter(
    (layer) => layer.filePath && existsSync(resolve(ROOT_DIR, layer.filePath)),
  );
  const preservedOtherCountryLayers = preservedCountryLayers.filter(
    (layer) => !requestedCountry || layer.countryId !== requestedCountry.id,
  );

  const globalLayer = await installGlobalLayer(options);
  const nextLayers = [globalLayer];
  nextLayers.push(...preservedOtherCountryLayers);

  if (options.dryRun) {
    if (requestedCountry) {
      const overlay = await installCountryLayer({
        country: requestedCountry,
        countryMaxZoom: options.countryMaxZoom,
        globalMaxZoom: globalLayer.maxZoom,
        reinstall: options.reinstall,
        dryRun: true,
      });
      nextLayers.push(overlay);
    }

    const totalSize = totalLayerBytes(nextLayers);
    log(`Would keep ${nextLayers.length} layer(s), total ${humanSize(totalSize)}.`);
    return;
  }

  if (requestedCountry) {
    writeManifest([globalLayer, ...preservedCountryLayers], {
      globalBudgetBytes: options.globalBudgetBytes,
      source: DEFAULT_PM_SOURCE,
    });
  }

  if (requestedCountry) {
    const overlay = await installCountryLayer({
      country: requestedCountry,
      countryMaxZoom: options.countryMaxZoom,
      globalMaxZoom: globalLayer.maxZoom,
      reinstall: options.reinstall,
      dryRun: false,
    });
    nextLayers.push(overlay);
  }

  writeManifest(nextLayers, {
    globalBudgetBytes: options.globalBudgetBytes,
    source: DEFAULT_PM_SOURCE,
  });
  log(`Managed maps ready. Total size: ${humanSize(totalLayerBytes(nextLayers))}`);
}

function removeCountryLayer(countryInput, dryRun) {
  const manifest = readManifest();
  if (!manifest) {
    log("No offline maps installed.");
    return;
  }

  const country = resolveCountry(countryInput);
  const kept = [];
  let removed = null;

  for (const layer of manifest.layers) {
    if (layer.role === "country" && layer.countryId === country.id) {
      removed = layer;
      continue;
    }
    kept.push(layer);
  }

  if (!removed) {
    log(`${country.name} overlay is not installed.`);
    return;
  }

  if (dryRun) {
    log(`Would remove ${country.name} overlay.`);
    return;
  }

  if (removed.filePath) {
    rmSync(resolve(ROOT_DIR, removed.filePath), { force: true });
  }
  writeManifest(kept, {
    globalBudgetBytes: manifest.globalBudgetBytes,
    source: manifest.source,
  });
  log(`${country.name} overlay removed.`);
}

function listCountries() {
  for (const country of loadCatalogCountries()) {
    process.stdout.write(`${country.code}\t${country.id}\t${country.name}\n`);
  }
}

async function cleanMaps({ assumeYes, dryRun }) {
  const targets = [MAP_ROOT_DIR, CACHE_DIR];
  if (!targets.some((target) => existsSync(target))) {
    log("No managed maps found.");
    return;
  }

  if (!dryRun) {
    await confirmOrFail("Remove all local offline maps?", assumeYes);
  }

  for (const target of targets) {
    if (!existsSync(target)) {
      continue;
    }
    log(`${dryRun ? "Would remove" : "Removing"} ${target}`);
    if (!dryRun) {
      rmSync(target, { recursive: true, force: true });
    }
  }
}

function parseArgs(argv) {
  const args = {
    command: "",
    globalBudgetBytes: parseSize(DEFAULT_GLOBAL_BUDGET),
    globalMaxZoom: null,
    country: "",
    countryMaxZoom: DEFAULT_COUNTRY_MAX_ZOOM,
    reinstall: false,
    dryRun: false,
    assumeYes: false,
  };

  const rest = [...argv];
  const command = rest.shift();
  if (!command || command === "-h" || command === "--help") {
    usage();
    process.exit(0);
  }

  args.command = command;
  if ((command === "add-country" || command === "remove-country") && rest[0] && !rest[0].startsWith("-")) {
    args.country = rest.shift() ?? "";
  }

  while (rest.length > 0) {
    const current = rest.shift();
    switch (current) {
      case "--global-budget":
        args.globalBudgetBytes = parseSize(rest.shift() ?? "");
        break;
      case "--global-max-zoom":
        args.globalMaxZoom = ensureZoom(rest.shift() ?? "", "global max zoom");
        break;
      case "--country":
        args.country = rest.shift() ?? "";
        break;
      case "--country-max-zoom":
        args.countryMaxZoom = ensureZoom(rest.shift() ?? "", "country max zoom");
        break;
      case "--reinstall":
        args.reinstall = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--yes":
        args.assumeYes = true;
        break;
      default:
        if (current.startsWith("--global-budget=")) {
          args.globalBudgetBytes = parseSize(current.split("=", 2)[1] || "");
        } else if (current.startsWith("--global-max-zoom=")) {
          args.globalMaxZoom = ensureZoom(current.split("=", 2)[1] || "", "global max zoom");
        } else if (current.startsWith("--country=")) {
          args.country = current.split("=", 2)[1] || "";
        } else if (current.startsWith("--country-max-zoom=")) {
          args.countryMaxZoom = ensureZoom(current.split("=", 2)[1] || "", "country max zoom");
        } else {
          fail(`Unknown option: ${current}`);
        }
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case "status":
      printStatus();
      return;
    case "list-countries":
      listCountries();
      return;
    case "clean":
      await cleanMaps(args);
      return;
    case "ensure":
      await ensureManagedMaps(args);
      return;
    case "install-global":
      await ensureManagedMaps({
        ...args,
        country: "",
      });
      return;
    case "add-country":
      if (!args.country) {
        fail("add-country requires a country id, ISO code or exact country name.");
      }
      await ensureManagedMaps(args);
      return;
    case "remove-country":
      if (!args.country) {
        fail("remove-country requires a country id, ISO code or exact country name.");
      }
      removeCountryLayer(args.country, args.dryRun);
      return;
    default:
      fail(`Unknown command: ${args.command}`);
  }
}

await main();
