import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { COUNTRY_METADATA_OVERRIDES } from "./config/country-metadata.mjs";
import {
  loadGeoNames,
  matchGeoCity,
  matchGeoCityByCoordinates,
} from "./lib/geonames.mjs";
import {
  compareText,
  ensureUniqueId,
  formatFreqKey,
  normalizeKey,
  normalizeFreqMhz,
  readJson,
  slugify,
  writeJson,
} from "./lib/utils.mjs";
import { loadAcmaAuStations } from "./sources/acma-au.mjs";
import { loadAnatelBrStations } from "./sources/anatel-br.mjs";
import { loadAneCoStations } from "./sources/ane-co.mjs";
import { loadAgcomItStations } from "./sources/agcom-it.mjs";
import { loadAecMkStations } from "./sources/aec-mk.mjs";
import { loadAkosSiStations } from "./sources/akos-si.mjs";
import { loadAnrcetiMdStations } from "./sources/anrceti-md.mjs";
import { loadArcomFrStations } from "./sources/arcom-fr.mjs";
import { loadArcotelEcStations } from "./sources/arcotel-ec.mjs";
import { loadAttBoStations } from "./sources/att-bo.mjs";
import { loadBaMtStations } from "./sources/ba-mt.mjs";
import { loadBakomChStations } from "./sources/bakom-ch.mjs";
import { loadBnetzaDeStations } from "./sources/bnetza-de.mjs";
import { loadConatelPyStations } from "./sources/conatel-py.mjs";
import { loadCnaRoStations } from "./sources/cna-ro.mjs";
import { loadCsaBeStations } from "./sources/csa-be.mjs";
import { loadCtuCzStations } from "./sources/ctu-cz.mjs";
import { loadDecCyStations } from "./sources/dec-cy.mjs";
import { loadEsakariLvStations } from "./sources/esakari-lv.mjs";
import { loadEsrGrStations } from "./sources/esr-gr.mjs";
import { loadFccUsStations } from "./sources/fcc-us.mjs";
import { loadHakomHrStations } from "./sources/hakom-hr.mjs";
import { loadIftMxStations } from "./sources/ift-mx.mjs";
import { loadImdaSgStations } from "./sources/imda-sg.mjs";
import { loadIndiaFmStations } from "./sources/india-fm.mjs";
import { loadIlrLuStations } from "./sources/ilr-lu.mjs";
import { loadIsedCaStations } from "./sources/ised-ca.mjs";
import { loadManualSeed } from "./sources/manual-seed.mjs";
import { loadMtcPeStations } from "./sources/mtc-pe.mjs";
import { loadMicVnStations } from "./sources/mic-vn.mjs";
import { loadNccTwStations } from "./sources/ncc-tw.mjs";
import { loadNkrziUaStations } from "./sources/nkrzi-ua.mjs";
import { loadNmhhHuStations } from "./sources/nmhh-hu.mjs";
import { loadRdiNlStations } from "./sources/rdi-nl.mjs";
import { loadRatelRsStations } from "./sources/ratel-rs.mjs";
import { loadAnacomPtStations } from "./sources/anacom-pt.mjs";
import { loadRegionalBeStations } from "./sources/regional-be.mjs";
import { loadRegionalEsStations } from "./sources/regional-es.mjs";
import { loadRegionalPhStations } from "./sources/regional-ph.mjs";
import { loadRrtLtStations } from "./sources/rrt-lt.mjs";
import { loadRteIeStations } from "./sources/rte-ie.mjs";
import { loadRtmMyStations } from "./sources/rtm-my.mjs";
import { loadRtrAtStations } from "./sources/rtr-at.mjs";
import { loadRtukTrStations } from "./sources/rtuk-tr.mjs";
import { loadSanMarinoSmStations } from "./sources/sanmarino-sm.mjs";
import { loadSdfiDkStations } from "./sources/sdfi-dk.mjs";
import { loadSpainCuratedStations } from "./sources/spain-curated.mjs";
import { loadSubtelClStations } from "./sources/subtel-cl.mjs";
import { loadTeleoffSkStations } from "./sources/teleoff-sk.mjs";
import { loadTraficomFiStations } from "./sources/traficom-fi.mjs";
import { loadTtjaEeStations } from "./sources/ttja-ee.mjs";
import { loadUkePlStations } from "./sources/uke-pl.mjs";
import { loadUrsecUyStations } from "./sources/ursec-uy.mjs";
import { loadEkipMeStations } from "./sources/ekip-me.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const outputDir = path.join(rootDir, "src/data/catalog");
const publicCatalogDir = path.join(rootDir, "public", "catalog");
const publicCountryDir = path.join(publicCatalogDir, "countries");
const SOURCE_TIMEOUT_MS = 120000;
const DEFAULT_IMPORTED_COUNTRY_METADATA = {
  coverageStatus: "active",
  coverageTier: "official-substantial",
  coverageScope: "national",
  sourceQuality: "official-regulator",
  hasOfficialImporter: true,
};
const DEFAULT_MANUAL_COUNTRY_METADATA = {
  coverageStatus: "manual",
  coverageTier: "manual-seed",
  coverageScope: "city-seed",
  sourceQuality: "manual-curated",
  hasOfficialImporter: false,
};
const COVERAGE_SCORE_BY_TIER = {
  "official-full": 92,
  "official-substantial": 80,
  "official-partial": 58,
  "manual-seed": 18,
  blocked: 0,
};
const COVERAGE_SCORE_BY_QUALITY = {
  "official-regulator": 8,
  "official-public-sector": 2,
  mixed: -4,
  "serious-secondary": -10,
  "manual-curated": -12,
};
const COVERAGE_SCORE_BY_STATUS = {
  active: 0,
  partial: -6,
  manual: -2,
  blocked: 0,
};

function buildStationKey(cityId, name, freqMhz) {
  return `${cityId}|${normalizeKey(name)}|${formatFreqKey(freqMhz)}`;
}

function sortCountries(countries) {
  return [...countries].sort((left, right) => compareText(left.name, right.name));
}

function sortCities(cities) {
  return [...cities].sort((left, right) => {
    const countryDiff = compareText(left.countryId, right.countryId);
    if (countryDiff !== 0) {
      return countryDiff;
    }
    return compareText(left.name, right.name);
  });
}

function sortStations(stations) {
  return [...stations].sort((left, right) => {
    const cityDiff = compareText(left.cityId, right.cityId);
    if (cityDiff !== 0) {
      return cityDiff;
    }
    if (left.freqMhz !== right.freqMhz) {
      return left.freqMhz - right.freqMhz;
    }
    return compareText(left.name, right.name);
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function deriveCoverageScore(metadata) {
  if (Number.isFinite(metadata.coverageScore)) {
    return clamp(metadata.coverageScore, 0, 100);
  }

  const tierScore = COVERAGE_SCORE_BY_TIER[metadata.coverageTier] ?? 0;
  const qualityScore = COVERAGE_SCORE_BY_QUALITY[metadata.sourceQuality] ?? 0;
  const statusScore = COVERAGE_SCORE_BY_STATUS[metadata.coverageStatus] ?? 0;
  return clamp(tierScore + qualityScore + statusScore, 0, 100);
}

function buildCountrySourceSummaries(stations, metadata) {
  const sourcesByKey = new Map();

  for (const station of stations) {
    if (!station.source) {
      continue;
    }

    const key = normalizeKey(station.source);
    if (!key) {
      continue;
    }

    const current = sourcesByKey.get(key);
    if (current) {
      if (!current.url && station.sourceUrl) {
        current.url = station.sourceUrl;
      }
      continue;
    }

    sourcesByKey.set(key, {
      name: station.source,
      url: station.sourceUrl,
      kind: metadata.hasOfficialImporter ? undefined : "manual",
    });
  }

  return [...sourcesByKey.values()].sort((left, right) => compareText(left.name, right.name));
}

function findLastImportedAt(stations) {
  let latest = "";
  for (const station of stations) {
    if (station.verifiedAt && station.verifiedAt > latest) {
      latest = station.verifiedAt;
    }
  }
  return latest || undefined;
}

function buildCountryMetadata(countryCode, importerCountryCodes, fallbackCountryCodes) {
  const normalizedCode = countryCode.toUpperCase();
  const base = importerCountryCodes.has(normalizedCode)
    ? DEFAULT_IMPORTED_COUNTRY_METADATA
    : DEFAULT_MANUAL_COUNTRY_METADATA;
  const override = COUNTRY_METADATA_OVERRIDES[normalizedCode] ?? {};
  const metadata = {
    ...base,
    ...override,
  };

  metadata.coverageScore = deriveCoverageScore(metadata);
  if (fallbackCountryCodes.has(normalizedCode)) {
    metadata.cachedFallbackUsed = true;
  }

  return metadata;
}

function summarizeCatalog(catalog, options) {
  const { fallbackCountryCodes, importerCountryCodes } = options;
  const citiesById = new Map(catalog.cities.map((city) => [city.id, city]));
  const stationCountByCityId = new Map();
  const stationCountByCountryId = new Map();
  const stationsByCountryId = new Map();

  for (const station of catalog.stations) {
    const city = citiesById.get(station.cityId);
    if (!city) {
      continue;
    }

    stationCountByCityId.set(
      city.id,
      (stationCountByCityId.get(city.id) ?? 0) + 1,
    );
    stationCountByCountryId.set(
      city.countryId,
      (stationCountByCountryId.get(city.countryId) ?? 0) + 1,
    );

    const countryStations = stationsByCountryId.get(city.countryId) ?? [];
    countryStations.push(station);
    stationsByCountryId.set(city.countryId, countryStations);
  }

  const citySummariesByCountryId = new Map();
  for (const city of catalog.cities) {
    const stationCount = stationCountByCityId.get(city.id) ?? 0;
    if (stationCount === 0) {
      continue;
    }

    const cities = citySummariesByCountryId.get(city.countryId) ?? [];
    cities.push({
      ...city,
      stationCount,
    });
    citySummariesByCountryId.set(city.countryId, cities);
  }

  const countrySummaries = sortCountries(
    catalog.countries
      .map((country) => {
        const metadata = buildCountryMetadata(
          country.code,
          importerCountryCodes,
          fallbackCountryCodes,
        );
        const countryStations = sortStations(stationsByCountryId.get(country.id) ?? []);
        const sources = buildCountrySourceSummaries(countryStations, metadata);

        return {
          ...country,
          cityCount: citySummariesByCountryId.get(country.id)?.length ?? 0,
          stationCount: stationCountByCountryId.get(country.id) ?? 0,
          sourceCount: sources.length,
          sources,
          lastImportedAt: findLastImportedAt(countryStations),
          ...metadata,
        };
      })
      .filter((country) => country.stationCount > 0),
  );

  const shards = countrySummaries.map((country) => ({
    country,
    cities: sortCities(citySummariesByCountryId.get(country.id) ?? []),
    stations: sortStations(stationsByCountryId.get(country.id) ?? []),
  }));

  const byCoverageStatus = {};
  for (const country of countrySummaries) {
    byCoverageStatus[country.coverageStatus] =
      (byCoverageStatus[country.coverageStatus] ?? 0) + 1;
  }

  const generatedAt = new Date().toISOString();

  return {
    manifest: {
      generatedAt,
      regions: catalog.regions,
      countries: countrySummaries,
      stats: {
        totalCountries: countrySummaries.length,
        totalCities: catalog.cities.length,
        totalStations: catalog.stations.length,
        byCoverageStatus,
      },
    },
    shards,
  };
}

async function loadCachedCountryStations(countryCodes) {
  if (!countryCodes?.length) {
    return [];
  }

  let manifest;
  try {
    manifest = await readJson(path.join(publicCatalogDir, "manifest.json"));
  } catch (error) {
    console.error(`[catalog] cache manifest read failed: ${error.message}`);
    return [];
  }

  const countriesByCode = new Map(
    (manifest.countries ?? []).map((country) => [country.code.toUpperCase(), country]),
  );
  const stations = [];

  for (const countryCode of countryCodes) {
    const manifestCountry = countriesByCode.get(countryCode.toUpperCase());
    if (!manifestCountry) {
      continue;
    }

    let shard;
    try {
      shard = await readJson(path.join(publicCountryDir, `${manifestCountry.id}.json`));
    } catch (error) {
      console.error(
        `[catalog] cache shard read failed for ${manifestCountry.id}: ${error.message}`,
      );
      continue;
    }

    const citiesById = new Map((shard.cities ?? []).map((city) => [city.id, city]));
    for (const station of shard.stations ?? []) {
      if (station.source === "Community seed") {
        continue;
      }

      const city = citiesById.get(station.cityId);
      if (!city) {
        continue;
      }

      stations.push({
        cityName: city.name,
        countryCode: manifestCountry.code,
        curated: station.curated,
        description: station.description,
        freqMhz: station.freqMhz,
        latitude: city.latitude,
        longitude: city.longitude,
        name: station.name,
        source: station.source,
        sourceUrl: station.sourceUrl,
        tags: station.tags,
        timezone: city.timezone,
        verifiedAt: station.verifiedAt,
      });
    }
  }

  return stations;
}

async function loadSourceWithTimeout(source) {
  const controller = new AbortController();
  const timeoutMs = source.timeoutMs ?? SOURCE_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      source.load({ signal: controller.signal }),
      new Promise((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new Error(`Timed out after ${timeoutMs}ms`)),
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function createCatalogBuilder(manualSeed, geoNames) {
  const countriesById = new Map(manualSeed.countries.map((country) => [country.id, country]));
  const countriesByCode = new Map(
    manualSeed.countries.map((country) => [country.code.toUpperCase(), country]),
  );
  const citiesById = new Map(manualSeed.cities.map((city) => [city.id, city]));
  const citiesByCountryAndName = new Map();
  for (const city of manualSeed.cities) {
    const country = countriesById.get(city.countryId);
    if (!country) {
      continue;
    }
    citiesByCountryAndName.set(
      `${country.code.toUpperCase()}|${normalizeKey(city.name)}`,
      city,
    );
  }

  const stations = [...manualSeed.stations];
  const stationKeys = new Set();
  const stationIds = new Set(manualSeed.stations.map((station) => station.id));
  for (const station of manualSeed.stations) {
    stationKeys.add(buildStationKey(station.cityId, station.name, station.freqMhz));
  }

  function resolveCountry(countryCode) {
    const code = countryCode.toUpperCase();
    const existing = countriesByCode.get(code);
    if (existing) {
      return existing;
    }

    const geoCountry = geoNames.countriesByCode.get(code);
    if (!geoCountry) {
      return undefined;
    }

    const nextCountry = {
      id: ensureUniqueId(slugify(geoCountry.name), countriesById),
      code: geoCountry.code,
      name: geoCountry.name,
      regionId: geoCountry.regionId,
    };

    countriesById.set(nextCountry.id, nextCountry);
    countriesByCode.set(code, nextCountry);
    return nextCountry;
  }

  function resolveCity(country, station) {
    const cityName = station.cityName;
    const existing = citiesByCountryAndName.get(
      `${country.code.toUpperCase()}|${normalizeKey(cityName)}`,
    );
    if (existing) {
      return {
        city: existing,
        resolution: "matchedByName",
      };
    }

    const geoCity = matchGeoCity(
      geoNames,
      country.code,
      cityName,
      station.admin1Code,
    );
    if (geoCity) {
      const baseCityId = `${country.code.toLowerCase()}-${slugify(geoCity.name)}`;
      const nextCity = {
        id: ensureUniqueId(baseCityId, citiesById),
        name: geoCity.name,
        countryId: country.id,
        timezone: geoCity.timezone || station.timezone || "UTC",
        latitude: geoCity.latitude,
        longitude: geoCity.longitude,
      };

      citiesById.set(nextCity.id, nextCity);
      citiesByCountryAndName.set(
        `${country.code.toUpperCase()}|${normalizeKey(cityName)}`,
        nextCity,
      );
      citiesByCountryAndName.set(
        `${country.code.toUpperCase()}|${normalizeKey(nextCity.name)}`,
        nextCity,
      );
      return {
        city: nextCity,
        resolution: "matchedByName",
      };
    }

    const coordinateCity = matchGeoCityByCoordinates(
      geoNames,
      country.code,
      station.latitude,
      station.longitude,
      station.admin1Code,
    );
    if (coordinateCity) {
      const baseCityId = `${country.code.toLowerCase()}-${slugify(coordinateCity.name)}`;
      const nextCity = {
        id: ensureUniqueId(baseCityId, citiesById),
        name: coordinateCity.name,
        countryId: country.id,
        timezone: coordinateCity.timezone || station.timezone || "UTC",
        latitude: coordinateCity.latitude,
        longitude: coordinateCity.longitude,
      };

      citiesById.set(nextCity.id, nextCity);
      citiesByCountryAndName.set(
        `${country.code.toUpperCase()}|${normalizeKey(cityName)}`,
        nextCity,
      );
      citiesByCountryAndName.set(
        `${country.code.toUpperCase()}|${normalizeKey(nextCity.name)}`,
        nextCity,
      );
      return {
        city: nextCity,
        resolution: "matchedByCoords",
      };
    }

    if (
      !Number.isFinite(station.latitude) ||
      !Number.isFinite(station.longitude)
    ) {
      return undefined;
    }

    const safeCityName = cityName.trim() || `${country.name} Local`;
    const baseCityId = `${country.code.toLowerCase()}-${slugify(safeCityName)}`;
    const nextCity = {
      id: ensureUniqueId(baseCityId, citiesById),
      name: safeCityName,
      countryId: country.id,
      timezone: station.timezone || "UTC",
      latitude: station.latitude,
      longitude: station.longitude,
    };

    citiesById.set(nextCity.id, nextCity);
    citiesByCountryAndName.set(
      `${country.code.toUpperCase()}|${normalizeKey(cityName)}`,
      nextCity,
    );
    citiesByCountryAndName.set(
      `${country.code.toUpperCase()}|${normalizeKey(nextCity.name)}`,
      nextCity,
    );
    return {
      city: nextCity,
      resolution: "syntheticFallback",
    };
  }

  function addSourceStations(sourceStations) {
    let added = 0;
    let skippedUnknownCountry = 0;
    let skippedUnresolvedCity = 0;
    let skippedDuplicate = 0;
    let matchedByName = 0;
    let matchedByCoords = 0;
    let syntheticFallback = 0;

    for (const station of sourceStations) {
      const country = resolveCountry(station.countryCode);
      if (!country) {
        skippedUnknownCountry += 1;
        continue;
      }

      const resolvedCity = resolveCity(country, station);
      if (!resolvedCity) {
        skippedUnresolvedCity += 1;
        continue;
      }

      const stationKey = buildStationKey(
        resolvedCity.city.id,
        station.name,
        station.freqMhz,
      );
      if (stationKeys.has(stationKey)) {
        skippedDuplicate += 1;
        continue;
      }

      const baseId = `${resolvedCity.city.id}-${slugify(station.name)}-${String(
        normalizeFreqMhz(station.freqMhz),
      ).replace(/\./g, "-")}`;
      const nextStation = {
        id: ensureUniqueId(baseId, stationIds),
        name: station.name,
        freqMhz: normalizeFreqMhz(station.freqMhz),
        cityId: resolvedCity.city.id,
        description: station.description,
        tags: station.tags,
        source: station.source,
        sourceUrl: station.sourceUrl,
        verifiedAt: station.verifiedAt,
        curated: station.curated,
      };

      stationIds.add(nextStation.id);
      stationKeys.add(stationKey);
      stations.push(nextStation);

      if (resolvedCity.resolution === "matchedByName") {
        matchedByName += 1;
      } else if (resolvedCity.resolution === "matchedByCoords") {
        matchedByCoords += 1;
      } else if (resolvedCity.resolution === "syntheticFallback") {
        syntheticFallback += 1;
      }

      added += 1;
    }

    return {
      added,
      skipped: skippedUnknownCountry + skippedUnresolvedCity + skippedDuplicate,
      skippedUnknownCountry,
      skippedUnresolvedCity,
      skippedDuplicate,
      matchedByName,
      matchedByCoords,
      syntheticFallback,
    };
  }

  return {
    addSourceStations,
    build() {
      const usedCountryIds = new Set(
        [...citiesById.values()].map((city) => city.countryId),
      );
      const countries = sortCountries(
        [...countriesById.values()].filter((country) => usedCountryIds.has(country.id)),
      );
      const usedRegionIds = new Set(countries.map((country) => country.regionId));
      const regions = geoNames.regions.filter((region) => usedRegionIds.has(region.id));

      return {
        regions,
        countries,
        cities: sortCities([...citiesById.values()]),
        stations: sortStations(stations),
      };
    },
  };
}

async function main() {
  const manualSeed = await loadManualSeed();
  const geoNames = await loadGeoNames();
  const sourceLoaders = [
    { key: "acma", load: loadAcmaAuStations, cacheCountries: ["AU"] },
    { key: "aecMk", load: loadAecMkStations, cacheCountries: ["MK"] },
    { key: "agcomIt", load: loadAgcomItStations, cacheCountries: ["IT"] },
    { key: "anrcetiMd", load: loadAnrcetiMdStations, cacheCountries: ["MD"] },
    { key: "anatel", load: loadAnatelBrStations, cacheCountries: ["BR"] },
    { key: "ane", load: loadAneCoStations, cacheCountries: ["CO"] },
    { key: "akos", load: loadAkosSiStations, cacheCountries: ["SI"] },
    { key: "arcom", load: loadArcomFrStations, cacheCountries: ["FR"] },
    { key: "arcotel", load: loadArcotelEcStations, cacheCountries: ["EC"] },
    { key: "att", load: loadAttBoStations, cacheCountries: ["BO"] },
    { key: "baMt", load: loadBaMtStations, cacheCountries: ["MT"] },
    { key: "bakom", load: loadBakomChStations, cacheCountries: ["CH"] },
    { key: "bnetza", load: loadBnetzaDeStations, cacheCountries: ["DE"] },
    { key: "cnaRo", load: loadCnaRoStations, cacheCountries: ["RO"] },
    { key: "conatel", load: loadConatelPyStations, cacheCountries: ["PY"] },
    { key: "csaBe", load: loadCsaBeStations, cacheCountries: ["BE"] },
    { key: "ctu", load: loadCtuCzStations, cacheCountries: ["CZ"] },
    { key: "decCy", load: loadDecCyStations, cacheCountries: ["CY"] },
    { key: "esakariLv", load: loadEsakariLvStations, cacheCountries: ["LV"] },
    { key: "esrGr", load: loadEsrGrStations, cacheCountries: ["GR"] },
    { key: "fcc", load: loadFccUsStations, cacheCountries: ["US", "AS", "GU", "MP", "PR", "VI"] },
    { key: "hakom", load: loadHakomHrStations, cacheCountries: ["HR"] },
    { key: "ift", load: loadIftMxStations, cacheCountries: ["MX"] },
    { key: "imda", load: loadImdaSgStations, cacheCountries: ["SG"] },
    { key: "india", load: loadIndiaFmStations, cacheCountries: ["IN"] },
    { key: "ilrLu", load: loadIlrLuStations, cacheCountries: ["LU"] },
    { key: "ised", load: loadIsedCaStations, cacheCountries: ["CA"] },
    { key: "mtc", load: loadMtcPeStations, cacheCountries: ["PE"] },
    { key: "micVn", load: loadMicVnStations, cacheCountries: ["VN"] },
    { key: "ncc", load: loadNccTwStations, cacheCountries: ["TW"] },
    { key: "nkrziUa", load: loadNkrziUaStations, cacheCountries: ["UA"] },
    { key: "nmhh", load: loadNmhhHuStations, cacheCountries: ["HU"] },
    { key: "ekipMe", load: loadEkipMeStations, cacheCountries: ["ME"] },
    { key: "rdiNl", load: loadRdiNlStations, cacheCountries: ["NL"] },
    { key: "ratelRs", load: loadRatelRsStations, cacheCountries: ["RS"] },
    { key: "anacomPt", load: loadAnacomPtStations, cacheCountries: ["PT"] },
    { key: "regionalBe", load: loadRegionalBeStations, cacheCountries: ["BE"] },
    { key: "regionalEs", load: loadRegionalEsStations, cacheCountries: ["ES"] },
    { key: "regionalPh", load: loadRegionalPhStations, cacheCountries: ["PH"] },
    { key: "rrtLt", load: loadRrtLtStations, cacheCountries: ["LT"] },
    { key: "rte", load: loadRteIeStations, cacheCountries: ["IE"] },
    { key: "rtm", load: loadRtmMyStations, cacheCountries: ["MY"] },
    { key: "rtr", load: loadRtrAtStations, cacheCountries: ["AT"] },
    { key: "rtuk", load: loadRtukTrStations, cacheCountries: ["TR"] },
    { key: "sanmarinoSm", load: loadSanMarinoSmStations, cacheCountries: ["SM"] },
    { key: "sdfiDk", load: loadSdfiDkStations, cacheCountries: ["DK"] },
    { key: "spainCurated", load: loadSpainCuratedStations },
    { key: "subtel", load: loadSubtelClStations, cacheCountries: ["CL"] },
    {
      key: "teleoff",
      load: loadTeleoffSkStations,
      cacheCountries: ["SK"],
      timeoutMs: 240000,
    },
    { key: "traficomFi", load: loadTraficomFiStations, cacheCountries: ["FI"] },
    { key: "ttjaEe", load: loadTtjaEeStations, cacheCountries: ["EE"] },
    { key: "uke", load: loadUkePlStations, cacheCountries: ["PL"] },
    { key: "ursec", load: loadUrsecUyStations, cacheCountries: ["UY"] },
  ];

  const loadedSources = {};
  const sourceStates = {};
  for (const source of sourceLoaders) {
    console.error(`[catalog] loading ${source.key}`);
    try {
      loadedSources[source.key] = await loadSourceWithTimeout(source);
      sourceStates[source.key] = { usedFallback: false };
      console.error(
        `[catalog] loaded ${source.key} (${loadedSources[source.key].length} rows)`,
      );
    } catch (error) {
      console.error(`[catalog] source ${source.key} failed: ${error.message}`);
      const cachedStations = await loadCachedCountryStations(source.cacheCountries);
      console.error(
        `[catalog] cache lookup ${source.key}: ${source.cacheCountries?.join(",") || "-"} -> ${cachedStations.length} rows`,
      );
      if (!cachedStations.length) {
        throw error;
      }

      console.error(
        `[catalog] using cached ${source.key} fallback (${cachedStations.length} rows)`,
      );
      loadedSources[source.key] = cachedStations;
      sourceStates[source.key] = { usedFallback: true };
    }
  }

  const importerCountryCodes = new Set(
    sourceLoaders.flatMap((source) => source.cacheCountries ?? []).map((code) => code.toUpperCase()),
  );
  const fallbackCountryCodes = new Set(
    sourceLoaders
      .filter((source) => sourceStates[source.key]?.usedFallback)
      .flatMap((source) => source.cacheCountries ?? [])
      .map((code) => code.toUpperCase()),
  );
  const builder = createCatalogBuilder(manualSeed, geoNames);
  const sourceResults = Object.fromEntries(
    sourceLoaders.map((source) => [
      source.key,
      builder.addSourceStations(loadedSources[source.key]),
    ]),
  );
  const catalog = builder.build();
  const runtimeCatalog = summarizeCatalog(catalog, {
    importerCountryCodes,
    fallbackCountryCodes,
  });

  await Promise.all([
    fs.rm(publicCountryDir, { recursive: true, force: true }),
    fs.rm(path.join(outputDir, "regions.json"), { force: true }),
    fs.rm(path.join(outputDir, "countries.json"), { force: true }),
    fs.rm(path.join(outputDir, "cities.json"), { force: true }),
    fs.rm(path.join(outputDir, "fm-stations.json"), { force: true }),
    fs.rm(path.join(outputDir, "countries"), { recursive: true, force: true }),
  ]);

  await Promise.all([
    writeJson(path.join(outputDir, "manifest.json"), runtimeCatalog.manifest),
    writeJson(path.join(publicCatalogDir, "manifest.json"), runtimeCatalog.manifest),
    ...runtimeCatalog.shards.map((shard) =>
      writeJson(path.join(publicCountryDir, `${shard.country.id}.json`), shard),
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        ...sourceResults,
        countries: runtimeCatalog.manifest.countries.length,
        cities: catalog.cities.length,
        stations: catalog.stations.length,
        shards: runtimeCatalog.shards.length,
        stats: runtimeCatalog.manifest.stats,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
