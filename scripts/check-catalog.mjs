#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const ROOT_DIR = resolve(new URL("..", import.meta.url).pathname);
const PUBLIC_CATALOG_DIR = join(ROOT_DIR, "public", "catalog");
const PUBLIC_MANIFEST_PATH = join(PUBLIC_CATALOG_DIR, "manifest.json");
const SOURCE_MANIFEST_PATH = join(ROOT_DIR, "src", "data", "catalog", "manifest.json");
const COUNTRIES_DIR = join(PUBLIC_CATALOG_DIR, "countries");

const MAX_MANIFEST_BYTES = Number.parseInt(process.env.CATALOG_MAX_MANIFEST_BYTES || String(128 * 1024), 10);
const MAX_COUNTRY_SHARD_BYTES = Number.parseInt(process.env.CATALOG_MAX_COUNTRY_SHARD_BYTES || String(16 * 1024 * 1024), 10);

function fail(message) {
  process.stderr.write(`[catalog-check] error: ${message}\n`);
  process.exitCode = 1;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function assertFile(path) {
  if (!existsSync(path)) {
    fail(`Missing required file: ${path}`);
    return false;
  }
  return true;
}

function stableJson(value) {
  return JSON.stringify(value);
}

function checkBudget(path, maxBytes) {
  const size = statSync(path).size;
  if (size > maxBytes) {
    fail(`${path} is ${size} bytes, above the ${maxBytes} byte budget.`);
  }
  return size;
}

if (!assertFile(PUBLIC_MANIFEST_PATH) || !assertFile(SOURCE_MANIFEST_PATH) || !assertFile(COUNTRIES_DIR)) {
  process.exit(process.exitCode || 1);
}

const publicManifest = readJson(PUBLIC_MANIFEST_PATH);
const sourceManifest = readJson(SOURCE_MANIFEST_PATH);
if (!publicManifest || !sourceManifest) {
  process.exit(process.exitCode || 1);
}

if (stableJson(publicManifest) !== stableJson(sourceManifest)) {
  fail("public/catalog/manifest.json and src/data/catalog/manifest.json differ. Run npm run catalog:build and commit both outputs.");
}

checkBudget(PUBLIC_MANIFEST_PATH, MAX_MANIFEST_BYTES);

const countries = Array.isArray(publicManifest.countries) ? publicManifest.countries : [];
const countryIds = new Set();
let totalCities = 0;
let totalStations = 0;

for (const country of countries) {
  if (!country || typeof country.id !== "string" || country.id.length === 0) {
    fail("Manifest contains a country without a valid id.");
    continue;
  }
  if (countryIds.has(country.id)) {
    fail(`Duplicate country id in manifest: ${country.id}`);
  }
  countryIds.add(country.id);

  const shardPath = join(COUNTRIES_DIR, `${country.id}.json`);
  if (!assertFile(shardPath)) {
    continue;
  }
  checkBudget(shardPath, MAX_COUNTRY_SHARD_BYTES);

  const shard = readJson(shardPath);
  if (!shard) {
    continue;
  }
  if (shard.country?.id !== country.id) {
    fail(`${shardPath} has country id ${shard.country?.id ?? "<missing>"}, expected ${country.id}.`);
  }
  const cities = Array.isArray(shard.cities) ? shard.cities : [];
  const stations = Array.isArray(shard.stations) ? shard.stations : [];
  if (cities.length !== country.cityCount) {
    fail(`${country.id} cityCount mismatch: manifest=${country.cityCount}, shard=${cities.length}.`);
  }
  if (stations.length !== country.stationCount) {
    fail(`${country.id} stationCount mismatch: manifest=${country.stationCount}, shard=${stations.length}.`);
  }
  totalCities += cities.length;
  totalStations += stations.length;
}

const shardFiles = readdirSync(COUNTRIES_DIR)
  .filter((entry) => entry.endsWith(".json"))
  .map((entry) => basename(entry, ".json"));
for (const shardId of shardFiles) {
  if (!countryIds.has(shardId)) {
    fail(`Country shard has no manifest entry: ${shardId}.json`);
  }
}

const stats = publicManifest.stats || {};
if (stats.totalCountries !== countries.length) {
  fail(`totalCountries mismatch: stats=${stats.totalCountries}, manifest=${countries.length}.`);
}
if (stats.totalCities !== totalCities) {
  fail(`totalCities mismatch: stats=${stats.totalCities}, shards=${totalCities}.`);
}
if (stats.totalStations !== totalStations) {
  fail(`totalStations mismatch: stats=${stats.totalStations}, shards=${totalStations}.`);
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

process.stdout.write(`[catalog-check] ok: ${countries.length} countries, ${totalCities} cities, ${totalStations} stations.\n`);
