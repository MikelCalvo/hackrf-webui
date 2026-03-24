import XLSX from "xlsx";

import { compareText, normalizeFreqMhz, normalizeKey, toTag } from "../lib/utils.mjs";

const IFT_PAGE_URL =
  "https://www.ift.org.mx/secciones/espectro-radioelectrico";
const IFT_XLSX_URL =
  "https://www.ift.org.mx/sites/default/files/contenidogeneral/espectro-radioelectrico/anexo2-estacionesdefmalcierrede20241.xlsx";

const STATE_NAMES = {
  AGS: "Aguascalientes",
  BC: "Baja California",
  BCS: "Baja California Sur",
  CAM: "Campeche",
  CHIH: "Chihuahua",
  CHIS: "Chiapas",
  COAH: "Coahuila",
  COL: "Colima",
  CDMX: "Mexico City",
  DGO: "Durango",
  GTO: "Guanajuato",
  GRO: "Guerrero",
  HGO: "Hidalgo",
  JAL: "Jalisco",
  MEX: "Estado de Mexico",
  MICH: "Michoacan",
  MOR: "Morelos",
  NAY: "Nayarit",
  NL: "Nuevo Leon",
  OAX: "Oaxaca",
  PUE: "Puebla",
  QRO: "Queretaro",
  QROO: "Quintana Roo",
  SIN: "Sinaloa",
  SLP: "San Luis Potosi",
  SON: "Sonora",
  TAB: "Tabasco",
  TAMPS: "Tamaulipas",
  TLAX: "Tlaxcala",
  VER: "Veracruz",
  YUC: "Yucatan",
  ZAC: "Zacatecas",
};

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStateCode(value) {
  return normalizeText(value).toUpperCase();
}

function stateNameForCode(stateCode) {
  return STATE_NAMES[stateCode] || stateCode;
}

function extractPrimaryLocality(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return "";
  }

  const parts = raw.split(/\s*(?:\/|;|\|)\s*/);
  return normalizeText(parts[0] || raw);
}

function buildDescription({ localityRaw, stateName, stateCode, callsign, concessionType, sheetName }) {
  const locality = normalizeText(localityRaw);
  const stateLabel = stateName || stateCode;
  const parts = [
    `FM station listed by IFT for ${locality}, ${stateLabel}.`,
    concessionType ? `Concession type: ${concessionType}.` : "",
    callsign ? `Callsign: ${callsign}.` : "",
    `Source sheet: ${sheetName}.`,
  ];

  return parts.filter(Boolean).join(" ");
}

function sheetToStations(sheet, sheetName, dedupe, verifiedAt) {
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  const stations = [];

  for (const row of rows) {
    const numberKey = Object.keys(row)[0];
    const rowNo = row[numberKey];
    if (!Number.isFinite(Number(rowNo))) {
      continue;
    }

    const stateCode = normalizeStateCode(row.__EMPTY);
    const localityRaw = normalizeText(row.__EMPTY_1);
    const localityName = extractPrimaryLocality(localityRaw);
    const callsign = normalizeText(row.__EMPTY_2);
    const service = normalizeText(row.__EMPTY_3).toUpperCase();
    const freqMhz = normalizeFreqMhz(row.__EMPTY_4);
    const concessionType = normalizeText(row.__EMPTY_5).toUpperCase();

    if (!stateCode || !localityName || !callsign || !Number.isFinite(freqMhz)) {
      continue;
    }
    if (service && service !== "FM") {
      continue;
    }

    const stateName = stateNameForCode(stateCode);
    const dedupeKey = [
      stateCode,
      normalizeKey(localityName),
      normalizeKey(callsign),
      freqMhz.toFixed(3),
      concessionType,
    ].join("|");

    if (dedupe.has(dedupeKey)) {
      continue;
    }
    dedupe.add(dedupeKey);

    stations.push({
      admin1Code: stateCode,
      cityName: localityName,
      countryCode: "MX",
      curated: false,
      description: buildDescription({
        localityRaw: localityRaw || localityName,
        stateCode,
        stateName,
        callsign,
        concessionType,
        sheetName,
      }),
      freqMhz,
      name: callsign,
      source: "IFT FM station workbook",
      sourceUrl: IFT_PAGE_URL,
      tags: [
        "fm",
        "official",
        "ift",
        "mexico",
        toTag(stateName),
        concessionType ? toTag(concessionType) : "fm",
        sheetName === "Anexo II.1" ? "complementary" : "main",
      ],
      verifiedAt,
    });
  }

  return stations;
}

async function downloadWorkbook() {
  const res = await fetch(IFT_XLSX_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download IFT workbook: HTTP ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

export async function loadIftMxStations() {
  const workbook = XLSX.read(await downloadWorkbook(), { type: "buffer" });
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Set();

  const stations = [];
  for (const sheetName of ["Anexo II", "Anexo II.1"]) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      continue;
    }

    stations.push(...sheetToStations(sheet, sheetName, dedupe, verifiedAt));
  }

  return stations.sort((left, right) => {
    const stateDiff = compareText(left.admin1Code || "", right.admin1Code || "");
    if (stateDiff !== 0) {
      return stateDiff;
    }

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
