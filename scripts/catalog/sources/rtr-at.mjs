import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const RTR_PAGE_URL = "https://www.rtr.at/medien/service/frequenzbuecher/FrequenzbuchRF.de.html";
const RTR_JSON_URL = "https://data.rtr.at/api/v1/tables/MedienFrequenzbuch.json";

const AUSTRIAN_STATE_NAMES = {
  B: "Burgenland",
  K: "Carinthia",
  "NÖ": "Lower Austria",
  "OÖ": "Upper Austria",
  S: "Salzburg",
  ST: "Styria",
  T: "Tyrol",
  V: "Vorarlberg",
  W: "Vienna",
};

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function decodeRtrCoordinate(raw, axis) {
  const value = normalizeText(raw);
  if (!value) {
    return NaN;
  }

  const match =
    axis === "lon"
      ? value.match(/^(\d{2,3})([EW])(\d{2})\s*(\d{2})$/)
      : value.match(/^(\d{2})([NS])(\d{2})\s*(\d{2})$/);
  if (!match) {
    return NaN;
  }

  const degrees = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[3], 10);
  const seconds = Number.parseInt(match[4], 10);
  const sign =
    match[2] === "W" || match[2] === "S"
      ? -1
      : 1;

  return sign * (degrees + minutes / 60 + seconds / 3600);
}

function deriveCityName(siteName, areaName) {
  const normalizedSite = normalizeText(siteName);
  if (normalizedSite) {
    return normalizedSite.replace(/\s+\d+$/u, "");
  }

  return normalizeText(areaName);
}

function buildDescription(row, stateName) {
  const parts = [
    `Austrian FM transmitter listed by RTR for ${deriveCityName(row.funkst_name, row.gebiet_name)}.`,
    row.veranstalter_name ? `Operator: ${normalizeText(row.veranstalter_name)}.` : "",
    stateName ? `Federal state: ${stateName}.` : "",
    row.gebiet_name ? `Coverage area: ${normalizeText(row.gebiet_name)}.` : "",
    row.funkst_standort ? `Site: ${normalizeText(row.funkst_standort)}.` : "",
    Number.isFinite(row.funkst_leistung_kw)
      ? `ERP: ${Number(row.funkst_leistung_kw).toFixed(3).replace(/\.?0+$/, "")} kW.`
      : "",
  ];

  return parts.filter(Boolean).join(" ");
}

export async function loadRtrAtStations() {
  const res = await fetch(RTR_JSON_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download RTR dataset: HTTP ${res.status}`);
  }

  const payload = await res.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const row of rows) {
    const freqMhz = normalizeFreqMhz(row.funkst_frequenz);
    if (normalizeText(row.programm_typ) !== "Hörfunk" || !Number.isFinite(freqMhz)) {
      continue;
    }

    const stationName = normalizeText(row.programm_liste);
    const cityName = deriveCityName(row.funkst_name, row.gebiet_name);
    if (!stationName || !cityName) {
      continue;
    }

    const stateCode = normalizeText(row.funkst_bundesland);
    const stateName = AUSTRIAN_STATE_NAMES[stateCode] || stateCode;
    const latitude = decodeRtrCoordinate(row.funkst_nord, "lat");
    const longitude = decodeRtrCoordinate(row.funkst_ost, "lon");
    const dedupeKey = `${cityName}|${stationName}|${freqMhz.toFixed(3)}`;

    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      cityName,
      countryCode: "AT",
      curated: false,
      description: buildDescription(row, stateName),
      freqMhz,
      latitude,
      longitude,
      name: stationName,
      source: "RTR MedienFrequenzbuch",
      sourceUrl: RTR_PAGE_URL,
      tags: [
        "fm",
        "official",
        "rtr",
        "austria",
        stateName ? toTag(stateName) : "austria",
        row.funkst_polarisation ? toTag(row.funkst_polarisation) : "fm",
      ],
      timezone: "Europe/Vienna",
      verifiedAt,
    });
  }

  return [...dedupe.values()];
}
