import path from "node:path";
import { fileURLToPath } from "node:url";

import { readJson } from "../lib/utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../..");

export async function loadManualSeed() {
  const manualDir = path.join(rootDir, "src/data/catalog/manual");

  const [countries, cities, stations] = await Promise.all([
    readJson(path.join(manualDir, "countries.json")),
    readJson(path.join(manualDir, "cities.json")),
    readJson(path.join(manualDir, "fm-stations.json")),
  ]);

  return { countries, cities, stations };
}
