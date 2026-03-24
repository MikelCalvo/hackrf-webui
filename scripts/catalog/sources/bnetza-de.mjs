import AdmZip from "adm-zip";

import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const BNETZA_PAGE_URL =
  "https://www.bundesnetzagentur.de/EN/Areas/Telecommunications/FrequencyManagement/Broadcasting/start.html";
const BNETZA_UKW_URL =
  "https://www.bundesnetzagentur.de/DE/Fachthemen/Telekommunikation/Frequenzen/OeffentlicheNetze/Rundfunk/Senderdaten_DL/SendedatenUKW_zip.zip?__blob=publicationFile&v=122";

const GERMAN_STATE_NAMES = {
  BB: "Brandenburg",
  BE: "Berlin",
  BW: "Baden-Wurttemberg",
  BY: "Bavaria",
  HB: "Bremen",
  HE: "Hesse",
  HH: "Hamburg",
  MV: "Mecklenburg-Vorpommern",
  NI: "Lower Saxony",
  NW: "North Rhine-Westphalia",
  RP: "Rhineland-Palatinate",
  SH: "Schleswig-Holstein",
  SL: "Saarland",
  SN: "Saxony",
  ST: "Saxony-Anhalt",
  TH: "Thuringia",
};

const GERMAN_COUNTRY_CODES = new Set(["D", "DE", "DEU"]);

function decodeDmsCoordinate(raw, axis) {
  const value = String(raw || "").trim();
  if (!value) {
    return NaN;
  }

  if (axis === "lon") {
    const match = value.match(/^(\d{3})([EW])(\d{2})(\d{2})$/);
    if (!match) {
      return NaN;
    }

    const degrees = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[3], 10);
    const seconds = Number.parseInt(match[4], 10);
    const sign = match[2] === "W" ? -1 : 1;
    return sign * (degrees + minutes / 60 + seconds / 3600);
  }

  const match = value.match(/^(\d{2})([NS])(\d{2})(\d{2})$/);
  if (!match) {
    return NaN;
  }

  const degrees = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[3], 10);
  const seconds = Number.parseInt(match[4], 10);
  const sign = match[2] === "S" ? -1 : 1;
  return sign * (degrees + minutes / 60 + seconds / 3600);
}

function parseUkWRow(line) {
  return {
    recordId: line.slice(0, 4).trim(),
    senderName: line.slice(4, 34).trim(),
    freqMhz: normalizeFreqMhz(line.slice(34, 43)),
    status: line.slice(43, 46).trim(),
    lonPotsdam: line.slice(46, 54).trim(),
    latPotsdam: line.slice(54, 61).trim(),
    lonWgs84: line.slice(61, 69).trim(),
    latWgs84: line.slice(69, 76).trim(),
    countryCode: line.slice(76, 79).trim(),
    stateCode: line.slice(79, 81).trim(),
    altitude: line.slice(81, 86).trim(),
    antennaHeight: line.slice(86, 89).trim(),
    erpHorizontal: line.slice(89, 94).trim(),
    erpVertical: line.slice(94, 99).trim(),
    sfnKey: line.slice(99, 119).trim(),
    polarization: line.slice(119, 120).trim(),
    antennaPattern: line.slice(120, 121).trim(),
  };
}

function buildDescription(row, stateName, latitude, longitude) {
  const locationLabel = stateName || "Germany";
  const pieces = [
    `German FM transmitter entry listed by Bundesnetzagentur for ${row.senderName}, ${locationLabel}.`,
    row.status ? `Status: ${row.status}.` : "",
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? `Coordinates: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}.`
      : "",
  ];

  return pieces.filter(Boolean).join(" ");
}

export async function loadBnetzaDeStations() {
  const res = await fetch(BNETZA_UKW_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download BNetzA dataset: HTTP ${res.status}`);
  }

  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const entry = zip.getEntries().find((item) => item.entryName.endsWith(".txt"));
  if (!entry) {
    throw new Error("BNetzA archive does not contain a UKW text file");
  }

  const rawText = zip.readAsText(entry, "utf8");
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const line of rawText.split(/\r?\n/)) {
    if (!line || line.length < 80) {
      continue;
    }

    const row = parseUkWRow(line);
    if (!row.senderName || !Number.isFinite(row.freqMhz)) {
      continue;
    }
    if (!GERMAN_COUNTRY_CODES.has(row.countryCode)) {
      continue;
    }
    if (row.freqMhz < 87.5 || row.freqMhz > 108) {
      continue;
    }

    const latitude = decodeDmsCoordinate(row.latWgs84 || row.latPotsdam, "lat");
    const longitude = decodeDmsCoordinate(row.lonWgs84 || row.lonPotsdam, "lon");
    const stateName = GERMAN_STATE_NAMES[row.stateCode] || row.stateCode;
    const dedupeKey = `${row.stateCode}|${row.senderName}|${row.freqMhz.toFixed(3)}`;

    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      admin1Code: row.stateCode || undefined,
      cityName: row.senderName,
      countryCode: "DE",
      curated: false,
      description: buildDescription(row, stateName, latitude, longitude),
      freqMhz: row.freqMhz,
      latitude,
      longitude,
      name: row.senderName,
      source: "Bundesnetzagentur UKW Senderdaten",
      sourceUrl: BNETZA_PAGE_URL,
      tags: [
        "fm",
        "official",
        "bnetza",
        "ukw",
        row.stateCode ? toTag(stateName || row.stateCode) : "germany",
        row.status ? toTag(row.status) : "active",
      ],
      timezone: "Europe/Berlin",
      verifiedAt,
    });
  }

  return [...dedupe.values()];
}
