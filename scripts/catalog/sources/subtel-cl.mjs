import AdmZip from "adm-zip";

import { compareText, normalizeKey, toTag } from "../lib/utils.mjs";

const SUBTEL_FM_KMZ_URL =
  "https://www.subtel.gob.cl/wp-content/uploads/2026/01/FM_RCC_Vigentes_Enero_2026.zip";

const REGION_NAMES = {
  1: "Tarapaca",
  2: "Antofagasta",
  3: "Atacama",
  4: "Coquimbo",
  5: "Valparaiso",
  6: "O'Higgins",
  7: "Maule",
  8: "Biobio",
  9: "Araucania",
  10: "Los Lagos",
  11: "Aysen",
  12: "Magallanes",
  13: "Metropolitana de Santiago",
  14: "Los Rios",
  15: "Arica y Parinacota",
  16: "Nuble",
};

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLocaleNumber(value) {
  let raw = normalizeText(value);
  if (!raw) {
    return NaN;
  }

  if (raw.includes(",") && raw.includes(".")) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if (raw.includes(",")) {
    raw = raw.replace(",", ".");
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseChileCoordinate(value) {
  const digits = normalizeText(value).replace(/\D/g, "");
  if (!digits) {
    return NaN;
  }

  const degreeWidth = 2;
  if (digits.length < degreeWidth + 4) {
    const parsed = Number(digits);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  const degrees = Number(digits.slice(0, degreeWidth));
  const minutes = Number(digits.slice(degreeWidth, degreeWidth + 2));
  const seconds = Number(digits.slice(degreeWidth + 2, degreeWidth + 4));

  if (![degrees, minutes, seconds].every(Number.isFinite)) {
    return NaN;
  }

  const decimal = degrees + minutes / 60 + seconds / 3600;
  return Number.isFinite(decimal) ? Number.parseFloat((-decimal).toFixed(6)) : NaN;
}

function sanitizeCoordinate(value) {
  return Number.isFinite(value) && Math.abs(value) > 0.000001 ? value : undefined;
}

function extractPrimaryLocality(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return "";
  }

  const parts = raw.split(/\s*(?:\/|;|\||-)\s*/);
  return normalizeText(parts[0] || raw);
}

function parseDescriptionFields(body) {
  const fields = {};
  const rowPattern = /<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>/gi;

  let match;
  while ((match = rowPattern.exec(body))) {
    const key = normalizeText(match[1]).toLowerCase();
    const value = normalizeText(match[2]);
    if (key) {
      fields[key] = value;
    }
  }

  return fields;
}

function buildDescription({ identifier, localityRaw, regionName, regionNumber }) {
  const locality = normalizeText(localityRaw);
  const regionLabel = regionName ? `Region ${regionNumber} (${regionName})` : `Region ${regionNumber}`;

  return [
    `FM station listed by SUBTEL in the official FM Vigentes KMZ for ${locality}.`,
    `${regionLabel}.`,
    identifier ? `Identifier: ${identifier}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function parsePlacemarkBody(body) {
  const name = normalizeText(body.match(/<name>([^<]+)<\/name>/i)?.[1]);
  const fields = parseDescriptionFields(body);
  const identifier = normalizeText(fields.identificador || name);
  const regionNumber = Number.parseInt(fields.reg || "", 10);
  const localityRaw = normalizeText(fields.localidad);
  const cityName = extractPrimaryLocality(localityRaw);
  const serviceType = normalizeText(fields.tipo_servicio).toUpperCase();
  const freqMhz = parseLocaleNumber(fields.frecuencia);

  if (serviceType !== "FM") {
    return null;
  }
  if (!identifier || !cityName || !Number.isFinite(regionNumber) || !Number.isFinite(freqMhz)) {
    return null;
  }

  const regionName = REGION_NAMES[regionNumber] || `Region ${regionNumber}`;
  const latitude = sanitizeCoordinate(parseChileCoordinate(fields.lat_ptx));
  const longitude = sanitizeCoordinate(parseChileCoordinate(fields.long_ptx));

  return {
    admin1Code: `CL-${String(regionNumber).padStart(2, "0")}`,
    cityName,
    countryCode: "CL",
    curated: false,
    description: buildDescription({
      identifier,
      localityRaw: localityRaw || cityName,
      regionName,
      regionNumber,
    }),
    freqMhz,
    latitude,
    longitude,
    name: identifier,
    source: "SUBTEL FM Vigentes KMZ",
    sourceUrl: SUBTEL_FM_KMZ_URL,
    tags: [
      "fm",
      "official",
      "subtel",
      "chile",
      toTag(regionName),
      `region-${regionNumber}`,
    ],
  };
}

function extractKmlFromArchive(buffer) {
  const outerZip = new AdmZip(buffer);
  const kmzEntry = outerZip
    .getEntries()
    .find((item) => item.entryName.toLowerCase().endsWith(".kmz"));
  if (!kmzEntry) {
    throw new Error("SUBTEL ZIP archive does not contain a KMZ file");
  }

  const innerZip = new AdmZip(kmzEntry.getData());
  const kmlEntry = innerZip
    .getEntries()
    .find((item) => item.entryName.toLowerCase().endsWith(".kml"));
  if (!kmlEntry) {
    throw new Error("SUBTEL KMZ archive does not contain a KML file");
  }

  return innerZip.readAsText(kmlEntry, "utf8");
}

async function downloadKmz() {
  const res = await fetch(SUBTEL_FM_KMZ_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download SUBTEL FM KMZ: HTTP ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

export async function loadSubtelClStations() {
  const kmzBuffer = await downloadKmz();
  const kml = extractKmlFromArchive(kmzBuffer);
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();
  const placemarkPattern = /<Placemark[^>]*>([\s\S]*?)<\/Placemark>/g;

  let match;
  while ((match = placemarkPattern.exec(kml))) {
    const station = parsePlacemarkBody(match[1]);
    if (!station) {
      continue;
    }

    const dedupeKey = [
      station.admin1Code,
      normalizeKey(station.cityName),
      normalizeKey(station.name),
      station.freqMhz.toFixed(3),
    ].join("|");

    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      ...station,
      verifiedAt,
    });
  }

  return [...dedupe.values()].sort((left, right) => {
    const stateDiff = compareText(left.admin1Code || "", right.admin1Code || "");
    if (stateDiff !== 0) {
      return stateDiff;
    }

    const cityDiff = compareText(left.cityName || "", right.cityName || "");
    if (cityDiff !== 0) {
      return cityDiff;
    }

    if (left.freqMhz !== right.freqMhz) {
      return left.freqMhz - right.freqMhz;
    }

    return compareText(left.name || "", right.name || "");
  });
}
