import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import AdmZip from "adm-zip";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACK_DIR = resolve(ROOT_DIR, process.env.AIS_TILE_PACK_DIR || "public/tiles/osm");
const MANIFEST_PATH = join(PACK_DIR, "manifest.json");
const PMTILES_OUTPUT_PATH = join(PACK_DIR, "world.pmtiles");
const CACHE_DIR = resolve(ROOT_DIR, ".cache", "ais-map");

const PACK_URL = process.env.AIS_TILE_PACK_URL?.trim() || "";
const PACK_FILE = process.env.AIS_TILE_PACK_FILE?.trim() || "";
const REINSTALL = process.env.AIS_TILE_PACK_REINSTALL === "1";
const PMTILES_BIN = process.env.PMTILES_BIN?.trim() || "";
const DEFAULT_PM_SOURCE =
  process.env.AIS_TILE_PACK_DEFAULT_SOURCE?.trim()
  || "https://data.source.coop/protomaps/openstreetmap/v4.pmtiles";
const DEFAULT_MAX_ZOOM = parseIntegerEnv("AIS_TILE_PACK_MAX_ZOOM", 12);
const MAP_PACK_PROFILE = process.env.MAP_PACK_PROFILE?.trim() || "";

function log(message) {
  process.stdout.write(`[maps] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[maps] error: ${message}\n`);
  process.exit(1);
}

function parseIntegerEnv(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function hasExistingPack() {
  return existsSync(MANIFEST_PATH);
}

function ensureEmptyPackDir() {
  rmSync(PACK_DIR, { recursive: true, force: true });
  mkdirSync(PACK_DIR, { recursive: true });
}

function ensureCacheDir() {
  mkdirSync(CACHE_DIR, { recursive: true });
}

function isUrl(value) {
  return /^https?:\/\//i.test(value);
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

  return result;
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "hackrf-webui/ais-map-installer",
      "X-Map-Installer": "offline-basemap",
    },
  });
  if (!response.ok) {
    fail(`Could not download ${url} (${response.status}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function resolvePmtilesReleaseAsset() {
  const response = await fetch("https://api.github.com/repos/protomaps/go-pmtiles/releases/latest", {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "hackrf-webui/ais-map-installer",
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
  if (PMTILES_BIN) {
    const resolved = resolve(ROOT_DIR, PMTILES_BIN);
    if (!existsSync(resolved)) {
      fail(`PMTILES_BIN points to a missing file: ${resolved}`);
    }
    return resolved;
  }

  if (commandAvailable("pmtiles")) {
    return "pmtiles";
  }

  ensureCacheDir();
  const binaryPath = join(CACHE_DIR, "pmtiles");
  if (existsSync(binaryPath)) {
    chmodSync(binaryPath, 0o755);
    return binaryPath;
  }

  const asset = await resolvePmtilesReleaseAsset();
  const archivePath = join(CACHE_DIR, asset.name);
  log(`Downloading go-pmtiles CLI from ${asset.browser_download_url}`);
  writeFileSync(archivePath, await fetchBuffer(asset.browser_download_url));

  rmSync(binaryPath, { force: true });
  if (asset.name.endsWith(".zip")) {
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(CACHE_DIR, true);
  } else if (asset.name.endsWith(".tar.gz")) {
    run("tar", ["-xzf", archivePath, "-C", CACHE_DIR]);
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

function buildPmtilesManifest(sizeBytes, source) {
  return {
    kind: "pmtiles",
    name: MAP_PACK_PROFILE
      ? `Protomaps Dark World ${MAP_PACK_PROFILE} z${DEFAULT_MAX_ZOOM}`
      : `Protomaps Dark World z${DEFAULT_MAX_ZOOM}`,
    pmtilesUrl: "/tiles/osm/world.pmtiles",
    flavor: "dark",
    lang: "en",
    attribution: "\u00a9 Protomaps \u00a9 OpenStreetMap contributors",
    bounds: null,
    minZoom: 0,
    maxZoom: DEFAULT_MAX_ZOOM,
    installedAt: new Date().toISOString(),
    fileSizeBytes: sizeBytes,
    source,
  };
}

async function installPmtilesPack(sourceInput) {
  const pmtilesBin = await ensurePmtilesCli();
  const remoteSource = isUrl(sourceInput);
  const source = remoteSource ? sourceInput : resolve(ROOT_DIR, sourceInput);

  if (remoteSource) {
    log("Remote map source detected. Download and extraction happen together in the next step.");
    log(`Downloading and building the offline basemap up to z${DEFAULT_MAX_ZOOM} from ${source}`);
  } else {
    log(`Building the offline basemap up to z${DEFAULT_MAX_ZOOM} from local source ${source}`);
  }

  runStreaming(pmtilesBin, [
    "extract",
    source,
    PMTILES_OUTPUT_PATH,
    "--maxzoom",
    String(DEFAULT_MAX_ZOOM),
    "--download-threads",
    "8",
  ]);

  const sizeBytes = statSync(PMTILES_OUTPUT_PATH).size;
  log(`Offline basemap size: ${humanSize(sizeBytes)}`);

  writeFileSync(
    MANIFEST_PATH,
    `${JSON.stringify(buildPmtilesManifest(sizeBytes, source), null, 2)}\n`,
  );
}

async function loadZipBuffer() {
  if (PACK_URL) {
    log(`Downloading raster map pack from ${PACK_URL}`);
    return fetchBuffer(PACK_URL);
  }

  const resolvedFile = resolve(ROOT_DIR, PACK_FILE);
  log(`Reading raster map pack from ${resolvedFile}`);
  return readFileSync(resolvedFile);
}

function stampRasterManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    fail("The raster map pack must contain a manifest.json at its root.");
  }

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const nextManifest = {
    kind: "raster",
    tileUrlTemplate: "/tiles/osm/{z}/{x}/{y}.png",
    attribution: "\u00a9 OpenStreetMap contributors",
    installedAt: new Date().toISOString(),
    ...manifest,
  };

  writeFileSync(MANIFEST_PATH, `${JSON.stringify(nextManifest, null, 2)}\n`);
}

async function installRasterZipPack() {
  const zip = new AdmZip(await loadZipBuffer());
  zip.extractAllTo(PACK_DIR, true);
  stampRasterManifest();
}

function wantsRasterZip() {
  const input = PACK_URL || PACK_FILE;
  return input.toLowerCase().endsWith(".zip");
}

async function main() {
  if (hasExistingPack() && !REINSTALL) {
    log("Offline map pack already present. Set AIS_TILE_PACK_REINSTALL=1 to replace it.");
    return;
  }

  ensureEmptyPackDir();

  if (PACK_URL || PACK_FILE) {
    if (wantsRasterZip()) {
      await installRasterZipPack();
      log(`Raster map pack installed into ${PACK_DIR}`);
      return;
    }

    await installPmtilesPack(PACK_URL || PACK_FILE);
    log(`PMTiles basemap installed into ${PMTILES_OUTPUT_PATH}`);
    return;
  }

  log("No map-pack source configured. Installing the default dark offline world basemap.");
  await installPmtilesPack(DEFAULT_PM_SOURCE);
  log(`PMTiles basemap installed into ${PMTILES_OUTPUT_PATH}`);
}

await main();
