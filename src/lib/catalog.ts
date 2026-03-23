import rawCities from "@/data/catalog/cities.json";
import rawCountries from "@/data/catalog/countries.json";
import rawRegions from "@/data/catalog/regions.json";
import rawStations from "@/data/catalog/fm-stations.json";
import type {
  CatalogCity,
  CatalogCountry,
  CatalogData,
  CatalogRegion,
  CustomStationDraft,
  FmStation,
  SeedFmStation,
  StationLocation,
} from "@/lib/types";

const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

export function compareText(left: string, right: string): number {
  return collator.compare(left, right);
}

export function sortStations(stations: FmStation[]): FmStation[] {
  return [...stations].sort((left, right) => {
    const regionDiff = compareText(
      left.location.regionName,
      right.location.regionName,
    );
    if (regionDiff !== 0) {
      return regionDiff;
    }

    const countryDiff = compareText(
      left.location.countryName,
      right.location.countryName,
    );
    if (countryDiff !== 0) {
      return countryDiff;
    }

    const cityDiff = compareText(left.location.cityName, right.location.cityName);
    if (cityDiff !== 0) {
      return cityDiff;
    }

    return left.freqMhz - right.freqMhz;
  });
}

function sortRegions(regions: CatalogRegion[]): CatalogRegion[] {
  return [...regions].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    return compareText(left.name, right.name);
  });
}

function sortCountries(countries: CatalogCountry[]): CatalogCountry[] {
  return [...countries].sort((left, right) => compareText(left.name, right.name));
}

function sortCities(cities: CatalogCity[]): CatalogCity[] {
  return [...cities].sort((left, right) => compareText(left.name, right.name));
}

function buildLocation(
  city: CatalogCity,
  country: CatalogCountry,
  region: CatalogRegion,
): StationLocation {
  return {
    regionId: region.id,
    regionName: region.name,
    countryId: country.id,
    countryName: country.name,
    countryCode: country.code,
    cityId: city.id,
    cityName: city.name,
    label: `${city.name}, ${country.name}`,
  };
}

const seedRegions = sortRegions(rawRegions as CatalogRegion[]);
const seedCountries = sortCountries(rawCountries as CatalogCountry[]);
const seedCities = sortCities(rawCities as CatalogCity[]);

const regionsById = new Map(seedRegions.map((region) => [region.id, region]));
const countriesById = new Map(
  seedCountries.map((country) => [country.id, country]),
);
const citiesById = new Map(seedCities.map((city) => [city.id, city]));

function enrichSeedStation(seed: SeedFmStation): FmStation {
  const city = citiesById.get(seed.cityId);
  if (!city) {
    throw new Error(`Catalog city not found for station ${seed.id}: ${seed.cityId}`);
  }

  const country = countriesById.get(city.countryId);
  if (!country) {
    throw new Error(
      `Catalog country not found for station ${seed.id}: ${city.countryId}`,
    );
  }

  const region = regionsById.get(country.regionId);
  if (!region) {
    throw new Error(
      `Catalog region not found for station ${seed.id}: ${country.regionId}`,
    );
  }

  return {
    id: seed.id,
    name: seed.name,
    freqMhz: seed.freqMhz,
    location: buildLocation(city, country, region),
    description: seed.description,
    tags: seed.tags,
    source: seed.source,
    sourceUrl: seed.sourceUrl,
    verifiedAt: seed.verifiedAt,
    curated: seed.curated,
  };
}

export const seedStations: FmStation[] = sortStations(
  (rawStations as SeedFmStation[]).map(enrichSeedStation),
);

export const seedCatalog: CatalogData = {
  regions: seedRegions,
  countries: seedCountries,
  cities: seedCities,
  stations: seedStations,
};

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase();
}

function matchCountry(
  countryName: string,
  catalog?: CatalogData,
): CatalogCountry | undefined {
  if (!catalog) {
    return undefined;
  }

  const target = normalizeKey(countryName);
  return catalog.countries.find((country) => {
    return (
      normalizeKey(country.name) === target || normalizeKey(country.code) === target
    );
  });
}

export function buildCustomStation(
  draft: CustomStationDraft,
  catalog?: CatalogData,
): FmStation {
  const freqMhz = Number.parseFloat(draft.freqMhz);
  const safeName = draft.name.trim() || `Custom FM ${freqMhz.toFixed(1)}`;
  const countryName = draft.country.trim() || "Custom";
  const cityName = draft.city.trim() || "Local";
  const stamp = Date.now();
  const matchedCountry = matchCountry(countryName, catalog);
  const matchedRegion = matchedCountry
    ? catalog?.regions.find((region) => region.id === matchedCountry.regionId)
    : undefined;
  const regionName = matchedRegion?.name || "Custom";
  const regionId = matchedRegion?.id || "custom";
  const countryId =
    matchedCountry?.id || `custom-country-${slugify(countryName) || "local"}`;

  return {
    id: `custom-${slugify(countryName)}-${slugify(cityName)}-${slugify(safeName)}-${stamp}`,
    name: safeName,
    freqMhz,
    location: {
      regionId,
      regionName,
      countryId,
      countryName: matchedCountry?.name || countryName,
      countryCode: matchedCountry?.code || "XX",
      cityId: `${countryId}-${slugify(cityName) || "local"}-${stamp}`,
      cityName,
      label: `${cityName}, ${matchedCountry?.name || countryName}`,
    },
    description:
      draft.description.trim() ||
      "Local browser preset stored for offline use.",
    tags: ["custom"],
    source: "Browser local preset",
    verifiedAt: new Date().toISOString().slice(0, 10),
    curated: false,
  };
}
