import AdmZip from "adm-zip";

import { normalizeKey } from "./utils.mjs";

const COUNTRY_INFO_URL = "https://download.geonames.org/export/dump/countryInfo.txt";
const CITIES500_URL = "https://download.geonames.org/export/dump/cities500.zip";

const REGIONS = [
  { id: "africa", name: "Africa", sortOrder: 10 },
  { id: "asia", name: "Asia", sortOrder: 20 },
  { id: "europe", name: "Europe", sortOrder: 30 },
  { id: "north-america", name: "North America", sortOrder: 40 },
  { id: "oceania", name: "Oceania", sortOrder: 50 },
  { id: "south-america", name: "South America", sortOrder: 60 },
  { id: "antarctica", name: "Antarctica", sortOrder: 70 },
];

const CONTINENT_TO_REGION = {
  AF: "africa",
  AN: "antarctica",
  AS: "asia",
  EU: "europe",
  NA: "north-america",
  OC: "oceania",
  SA: "south-america",
};

async function downloadText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "hackrf-webui-catalog-builder/0.1 (+https://github.com/MikelCalvo/hackrf-webui)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }

  return await res.text();
}

async function downloadZipText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "hackrf-webui-catalog-builder/0.1 (+https://github.com/MikelCalvo/hackrf-webui)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }

  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const [entry] = zip.getEntries();
  if (!entry) {
    throw new Error(`Zip archive is empty: ${url}`);
  }

  return zip.readAsText(entry, "utf8");
}

function parseCountryInfo(rawText) {
  const countriesByCode = new Map();

  for (const line of rawText.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) {
      continue;
    }

    const columns = line.split("\t");
    const [
      iso,
      ,
      ,
      ,
      countryName,
      capital,
      ,
      ,
      continent,
    ] = columns;

    const regionId = CONTINENT_TO_REGION[continent] || "europe";
    countriesByCode.set(iso, {
      code: iso,
      name: countryName,
      capital,
      regionId,
    });
  }

  return countriesByCode;
}

function addIndexRecord(index, countryCode, key, city) {
  if (!key) {
    return;
  }

  const countryIndex = index.get(countryCode) || new Map();
  const current = countryIndex.get(key);
  if (!current || current.population < city.population) {
    countryIndex.set(key, city);
  }
  index.set(countryCode, countryIndex);
}

function addCityRecord(listIndex, key, city) {
  const records = listIndex.get(key) ?? [];
  records.push(city);
  listIndex.set(key, records);
}

function buildCityLookupVariants(value) {
  const variants = new Set();
  const queue = [String(value ?? "")];

  while (queue.length > 0) {
    const current = queue.shift();
    const normalized = normalizeKey(current);
    if (!normalized || variants.has(normalized)) {
      continue;
    }

    variants.add(normalized);

    const withoutParens = current.replace(/\s*\([^)]*\)\s*$/u, " ").trim();
    if (withoutParens && withoutParens !== current) {
      queue.push(withoutParens);
    }

    for (const separator of ["/", ",", " - "]) {
      if (!current.includes(separator)) {
        continue;
      }

      const [head] = current.split(separator);
      if (head) {
        queue.push(head.trim());
      }
    }
  }

  return [...variants];
}

function parseCities(rawText) {
  const cityIndex = new Map();
  const cityIndexByAdmin1 = new Map();
  const citiesByCountry = new Map();
  const citiesByCountryAndAdmin1 = new Map();

  for (const line of rawText.split(/\r?\n/)) {
    if (!line) {
      continue;
    }

    const columns = line.split("\t");
    if (columns.length < 19) {
      continue;
    }

    const [
      geonameId,
      name,
      asciiName,
      alternateNames,
      latitude,
      longitude,
      ,
      featureCode,
      countryCode,
      ,
      admin1Code,
      ,
      ,
      ,
      population,
      ,
      ,
      timezone,
    ] = columns;

    if (!countryCode || !name) {
      continue;
    }

    const city = {
      geonameId: Number(geonameId),
      name,
      asciiName,
      latitude: Number(latitude),
      longitude: Number(longitude),
      timezone: timezone || "UTC",
      featureCode,
      admin1Code,
      population: Number(population || 0),
    };

    addCityRecord(citiesByCountry, countryCode, city);
    addCityRecord(citiesByCountryAndAdmin1, `${countryCode}|${admin1Code || ""}`, city);
    addIndexRecord(cityIndex, countryCode, normalizeKey(name), city);
    addIndexRecord(cityIndex, countryCode, normalizeKey(asciiName), city);
    addIndexRecord(
      cityIndexByAdmin1,
      `${countryCode}|${admin1Code || ""}`,
      normalizeKey(name),
      city,
    );
    addIndexRecord(
      cityIndexByAdmin1,
      `${countryCode}|${admin1Code || ""}`,
      normalizeKey(asciiName),
      city,
    );

    if (alternateNames) {
      const variants = alternateNames.split(",");
      for (const variant of variants.slice(0, 128)) {
        addIndexRecord(cityIndex, countryCode, normalizeKey(variant), city);
        addIndexRecord(
          cityIndexByAdmin1,
          `${countryCode}|${admin1Code || ""}`,
          normalizeKey(variant),
          city,
        );
      }
    }
  }

  return {
    cityIndex,
    cityIndexByAdmin1,
    citiesByCountry,
    citiesByCountryAndAdmin1,
  };
}

export async function loadGeoNames() {
  const [countryInfoRaw, citiesRaw] = await Promise.all([
    downloadText(COUNTRY_INFO_URL),
    downloadZipText(CITIES500_URL),
  ]);
  const parsedCities = parseCities(citiesRaw);

  return {
    countriesByCode: parseCountryInfo(countryInfoRaw),
    cityIndex: parsedCities.cityIndex,
    cityIndexByAdmin1: parsedCities.cityIndexByAdmin1,
    citiesByCountry: parsedCities.citiesByCountry,
    citiesByCountryAndAdmin1: parsedCities.citiesByCountryAndAdmin1,
    regions: REGIONS,
  };
}

export function matchGeoCity(geoNames, countryCode, cityName, admin1Code) {
  const candidateKeys = buildCityLookupVariants(cityName);

  if (admin1Code) {
    const adminIndex = geoNames.cityIndexByAdmin1.get(
      `${countryCode.toUpperCase()}|${admin1Code}`,
    );
    if (adminIndex) {
      for (const candidateKey of candidateKeys) {
        const match = adminIndex.get(candidateKey);
        if (match) {
          return match;
        }
      }
    }
  }

  const countryIndex = geoNames.cityIndex.get(countryCode.toUpperCase());
  if (!countryIndex) {
    return undefined;
  }

  for (const candidateKey of candidateKeys) {
    const match = countryIndex.get(candidateKey);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function haversineDistanceKm(latitudeA, longitudeA, latitudeB, longitudeB) {
  const earthRadiusKm = 6371;
  const toRadians = (value) => (value * Math.PI) / 180;
  const latDelta = toRadians(latitudeB - latitudeA);
  const lonDelta = toRadians(longitudeB - longitudeA);
  const lat1 = toRadians(latitudeA);
  const lat2 = toRadians(latitudeB);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDelta / 2) ** 2;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestCity(candidates, latitude, longitude, maxDistanceKm) {
  if (!candidates?.length) {
    return undefined;
  }

  let bestCity;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (
      !Number.isFinite(candidate.latitude) ||
      !Number.isFinite(candidate.longitude)
    ) {
      continue;
    }

    if (
      Math.abs(candidate.latitude - latitude) > 2.5 ||
      Math.abs(candidate.longitude - longitude) > 2.5
    ) {
      continue;
    }

    const distanceKm = haversineDistanceKm(
      latitude,
      longitude,
      candidate.latitude,
      candidate.longitude,
    );

    if (distanceKm < bestDistance) {
      bestCity = candidate;
      bestDistance = distanceKm;
    }
  }

  if (bestCity && bestDistance <= maxDistanceKm) {
    return bestCity;
  }

  return undefined;
}

export function matchGeoCityByCoordinates(
  geoNames,
  countryCode,
  latitude,
  longitude,
  admin1Code,
) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return undefined;
  }

  const upperCountryCode = countryCode.toUpperCase();
  const adminCandidates = admin1Code
    ? geoNames.citiesByCountryAndAdmin1.get(`${upperCountryCode}|${admin1Code}`)
    : undefined;
  const adminMatch = findNearestCity(adminCandidates, latitude, longitude, 90);
  if (adminMatch) {
    return adminMatch;
  }

  const countryCandidates = geoNames.citiesByCountry.get(upperCountryCode);
  return findNearestCity(countryCandidates, latitude, longitude, 140);
}
