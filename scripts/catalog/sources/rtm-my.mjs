import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const RTM_STATIONS_URL = "https://radio.rtm.gov.my/api/frontend/stations";

const CITY_BY_STATION_TITLE = {
  "AIfm": "Kuala Lumpur",
  "ASYIKfm": "Kuala Lumpur",
  "BINTULUfm": "Bintulu",
  "JOHORfm": "Johor Bahru",
  "KEDAHfm": "Alor Setar",
  "KELANTANfm": "Kota Bharu",
  "KENINGAUfm": "Keningau",
  "KLfm": "Kuala Lumpur",
  "LABUANfm": "Labuan",
  "LANGKAWIfm": "Langkawi",
  "LIMBANGfm": "Limbang",
  "MELAKAfm": "Malacca City",
  "MINNALfm": "Kuala Lumpur",
  "MIRIfm": "Miri",
  "MUTIARAfm": "George Town",
  "NASIONALfm": "Kuala Lumpur",
  "NEGERIfm": "Seremban",
  "PAHANGfm": "Kuantan",
  "PERAKfm": "Ipoh",
  "PERLISfm": "Kangar",
  "Radio KLASIK": "Kuala Lumpur",
  "SANDAKANfm": "Sandakan",
  "SELANGORfm": "Shah Alam",
  "SIBUfm": "Sibu",
  "SRI AMANfm": "Sri Aman",
  "TAWAUfm": "Tawau",
  "TERENGGANUfm": "Kuala Terengganu",
  "TRAXXfm": "Kuala Lumpur",
};

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function extractFrequencyValues(value) {
  const matches = normalizeText(value).match(/\d{2,3}(?:\.\d+)?/g) ?? [];
  return matches
    .map((match) => normalizeFreqMhz(match))
    .filter((freqMhz) => Number.isFinite(freqMhz));
}

function buildDescription({ cityName, frequencyLabel, stationName, categoryLabel }) {
  return [
    `RTM station listed in the official station API for ${cityName}.`,
    categoryLabel ? `Category: ${categoryLabel}.` : "",
    frequencyLabel ? `Frequency listing: ${frequencyLabel}.` : "",
    `City grouping is inferred from the station service area name.`,
    `Station: ${stationName}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function loadRtmMyStations() {
  const res = await fetch(RTM_STATIONS_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download RTM station API: HTTP ${res.status}`);
  }

  const payload = await res.json();
  const rows = Array.isArray(payload?.stations) ? payload.stations : [];
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const row of rows) {
    const stationName = normalizeText(row.title);
    const cityName = CITY_BY_STATION_TITLE[stationName];
    const category = normalizeText(row.category);
    const categoryLabel = normalizeText(row.category_display);
    const frequencyLabel = normalizeText(row.frequency);
    const frequencies = extractFrequencyValues(frequencyLabel);

    if (
      !stationName ||
      !cityName ||
      category === "radio-online" ||
      !frequencies.length
    ) {
      continue;
    }

    for (const freqMhz of frequencies) {
      const dedupeKey = `${cityName}|${stationName}|${freqMhz.toFixed(3)}`;
      if (dedupe.has(dedupeKey)) {
        continue;
      }

      dedupe.set(dedupeKey, {
        cityName,
        countryCode: "MY",
        curated: false,
        description: buildDescription({
          categoryLabel,
          cityName,
          frequencyLabel,
          stationName,
        }),
        freqMhz,
        name: stationName,
        source: "RTM stations API",
        sourceUrl: RTM_STATIONS_URL,
        tags: [
          "fm",
          "official",
          "malaysia",
          category ? toTag(category) : "radio",
          toTag(stationName),
          "inferred-city",
        ],
        timezone: "Asia/Kuala_Lumpur",
        verifiedAt,
      });
    }
  }

  return [...dedupe.values()];
}
