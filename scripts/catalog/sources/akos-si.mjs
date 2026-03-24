import { compareText, normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const AKOS_REGISTER_URL = "https://www.akos-rs.si/en/registers/registers-list/ra-and-tv-frequencies";
const AKOS_DATA_URL = "https://www.akos-rs.si/en/?type=1452982642&o=RAInTVFrekvence&no_cache=1";
const PAGE_SIZE = 100;

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLocationToCity(value) {
  return normalizeText(value).replace(/\s+\d+$/u, "");
}

function buildDescription({ cityName, holderName, programmeName }) {
  return [
    `Slovenian FM register entry listed by AKOS for ${cityName}.`,
    `Programme: ${programmeName}.`,
    holderName ? `Holder: ${holderName}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

async function fetchPage(start) {
  const response = await fetch(AKOS_DATA_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
      "x-requested-with": "XMLHttpRequest",
    },
    body: new URLSearchParams({
      draw: "1",
      length: String(PAGE_SIZE),
      start: String(start),
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch AKOS FM register: HTTP ${response.status}`);
  }

  return response.json();
}

export async function loadAkosSiStations() {
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  let start = 0;
  let recordsTotal = Infinity;
  while (start < recordsTotal) {
    const payload = await fetchPage(start);
    recordsTotal = Number(payload.recordsTotal || 0);
    const rows = Array.isArray(payload.data) ? payload.data : [];
    if (!rows.length) {
      break;
    }

    for (const row of rows) {
      if (normalizeText(row.PodvrstaOdlocbe).toUpperCase() !== "FM") {
        continue;
      }

      const holderName = normalizeText(row.ImetnikNaziv);
      const programmeName = normalizeText(row.Programi);
      const siteName = normalizeText(row.NazivLokacije);
      const cityName = normalizeLocationToCity(siteName);
      const freqMhz = normalizeFreqMhz(Number(row.OddajnaFrekvenca));

      if (!cityName || !programmeName || !Number.isFinite(freqMhz)) {
        continue;
      }

      const dedupeKey = `${siteName}|${programmeName}|${freqMhz.toFixed(3)}`;
      if (dedupe.has(dedupeKey)) {
        continue;
      }

      dedupe.set(dedupeKey, {
        cityName,
        countryCode: "SI",
        curated: false,
        description: buildDescription({
          cityName,
          holderName,
          programmeName,
        }),
        freqMhz,
        name: programmeName,
        source: "AKOS RA and TV frequencies register",
        sourceUrl: AKOS_REGISTER_URL,
        tags: [
          "fm",
          "official",
          "slovenia",
          "akos",
          toTag(holderName),
          toTag(programmeName),
        ],
        timezone: "Europe/Ljubljana",
        verifiedAt,
      });
    }

    start += rows.length;
  }

  return [...dedupe.values()].sort((left, right) => {
    const cityDiff = compareText(left.cityName, right.cityName);
    if (cityDiff !== 0) {
      return cityDiff;
    }

    if (left.freqMhz !== right.freqMhz) {
      return left.freqMhz - right.freqMhz;
    }

    return compareText(left.name, right.name);
  });
}
