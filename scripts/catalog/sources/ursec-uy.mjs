import AdmZip from "adm-zip";

import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const URSEC_PAGE_URL =
  "https://www.gub.uy/unidad-reguladora-servicios-comunicaciones/listados-de-operadores-de-radiodifusion";
const URSEC_TECHNICAL_DATA_URL =
  "https://www.gub.uy/unidad-reguladora-servicios-comunicaciones/datos-y-estadisticas/datos/listado-datos-tecnicos";
const URSEC_ODS_URL =
  "https://www.gub.uy/unidad-reguladora-servicios-comunicaciones/sites/unidad-reguladora-servicios-comunicaciones/files/2019-03/DATOS%20TECNICOS%20AM-FM-TV%200001.ods";

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function stripTags(value) {
  return decodeXml(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseFrequency(value) {
  const cleaned = String(value || "")
    .replace(/mhz/gi, "")
    .replace(/[^0-9,.-]/g, "")
    .replace(",", ".");
  const freqMhz = normalizeFreqMhz(cleaned);
  return Number.isFinite(freqMhz) ? freqMhz : NaN;
}

function parseCoordinateText(value) {
  const cleaned = String(value || "")
    .replace(/[^0-9,.-]/g, "")
    .replace(",", ".");
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function parseCellText(innerXml) {
  const paragraphs = [...String(innerXml || "").matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)]
    .map((match) => stripTags(match[1]))
    .filter(Boolean);

  if (paragraphs.length > 0) {
    return paragraphs.join(" ").trim();
  }

  return stripTags(innerXml);
}

function expandRowCells(rowXml, maxCells = 10) {
  const cells = [];
  const cellPattern =
    /<(table:(?:table-cell|covered-table-cell))\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;

  for (const match of rowXml.matchAll(cellPattern)) {
    if (cells.length >= maxCells) {
      break;
    }

    const tagName = match[1];
    const attrs = match[2] || "";
    const innerXml = match[3] || "";
    const repeatMatch = attrs.match(/table:number-columns-repeated="(\d+)"/);
    const repeatCount = repeatMatch ? Number.parseInt(repeatMatch[1], 10) : 1;
    const officeValueMatch = attrs.match(/office:value="([^"]+)"/);
    const officeValue = officeValueMatch ? officeValueMatch[1] : "";
    const text = tagName.endsWith("covered-table-cell") ? "" : parseCellText(innerXml);

    for (let index = 0; index < repeatCount && cells.length < maxCells; index += 1) {
      cells.push({
        officeValue,
        text,
      });
    }
  }

  return cells;
}

function buildDescription(callsign, type, cityName, department, power, antennaHeight) {
  const parts = [
    `Uruguay FM service listed by URSEC for ${cityName}, ${department}.`,
    `Callsign: ${callsign}.`,
    type ? `Type: ${type}.` : "",
    power ? `ERP: ${power}.` : "",
    antennaHeight ? `Antenna height: ${antennaHeight}.` : "",
  ];

  return parts.filter(Boolean).join(" ");
}

function extractFmTable(contentXml) {
  const match = contentXml.match(
    /<table:table table:name="FM"[\s\S]*?>([\s\S]*?)<\/table:table>/,
  );

  if (!match) {
    throw new Error("URSEC ODS does not contain an FM sheet");
  }

  return match[1];
}

async function downloadOdsContentXml() {
  let lastError;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(URSEC_ODS_URL, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
        },
      });

      if (!res.ok) {
        throw new Error(`Failed to download URSEC ODS: HTTP ${res.status}`);
      }

      const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
      const entry = zip.getEntry("content.xml");
      if (!entry) {
        throw new Error("URSEC ODS is missing content.xml");
      }

      return zip.readAsText(entry, "utf8");
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

export async function loadUrsecUyStations() {
  const contentXml = await downloadOdsContentXml();
  const fmTableXml = extractFmTable(contentXml);
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const rows = [...fmTableXml.matchAll(/<table:table-row\b[\s\S]*?<\/table:table-row>/g)];
  const stations = [];
  let seenHeader = false;

  for (const match of rows) {
    const cells = expandRowCells(match[0], 10);
    if (cells.length === 0) {
      continue;
    }

    const values = cells.map((cell) => cell.text.trim());
    const first = normalizeText(values[0]);
    const second = normalizeText(values[1]);

    if (!seenHeader) {
      if (first === "carac" && second === "frec") {
        seenHeader = true;
      }
      continue;
    }

    if (values.every((value) => !value)) {
      continue;
    }

    const callsign = values[0];
    const freqMhz = parseFrequency(values[1]);
    const type = values[2];
    const name = values[3];
    const cityName = values[4];
    const department = values[5];
    const power = values[6];
    const antennaHeight = values[7];
    const latitude = parseCoordinateText(cells[8]?.officeValue || values[8]);
    const longitude = parseCoordinateText(cells[9]?.officeValue || values[9]);

    if (!callsign || !name || !cityName || !department) {
      continue;
    }
    if (!Number.isFinite(freqMhz) || freqMhz < 87 || freqMhz > 108.5) {
      continue;
    }

    stations.push({
      admin1Code: `UY-${toTag(department).toUpperCase()}`,
      callsign,
      cityName,
      countryCode: "UY",
      curated: false,
      description: buildDescription(callsign, type, cityName, department, power, antennaHeight),
      freqMhz,
      latitude,
      longitude,
      name,
      source: "URSEC technical data list",
      sourceUrl: URSEC_TECHNICAL_DATA_URL,
      tags: [
        "fm",
        "official",
        "uruguay",
        "ursec",
        toTag(department),
        type ? toTag(type) : "fm",
      ],
      verifiedAt,
    });
  }

  const dedupe = new Map();
  for (const station of stations) {
    const key = [
      station.admin1Code,
      normalizeText(station.cityName),
      normalizeText(station.name),
      normalizeText(station.callsign),
      station.freqMhz.toFixed(3),
    ].join("|");

    if (!dedupe.has(key)) {
      dedupe.set(key, station);
    }
  }

  return [...dedupe.values()].map((station) => ({
    ...station,
    description: `${station.description} Page: ${URSEC_PAGE_URL}.`,
  }));
}
