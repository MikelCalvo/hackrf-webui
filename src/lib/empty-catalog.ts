import type { CatalogManifest } from "@/lib/types";

export const EMPTY_CATALOG_MANIFEST: CatalogManifest = {
  generatedAt: "",
  regions: [],
  countries: [],
  stats: {
    totalCountries: 0,
    totalCities: 0,
    totalStations: 0,
    byCoverageStatus: {},
  },
};
