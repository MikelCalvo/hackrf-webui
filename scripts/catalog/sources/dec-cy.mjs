import XLSX from "xlsx";

import { compareText, normalizeFreqMhz, normalizeKey, toTag } from "../lib/utils.mjs";

const DEC_PAGE_URL =
  "https://dec.dmrid.gov.cy/dmrid/dec/ws_dec.nsf/radioplan_en/radioplan_en?OpenDocument";
const DEC_XLSX_URL =
  "https://dec.dmrid.gov.cy/dmrid/dec/ws_dec.nsf/E4C0AC3AA87839BAC22584FF0047A52E/$file/%CE%A3%CF%87%CE%AD%CE%B4%CE%B9%CE%BF%20%CE%A1%CE%B1%CE%B4%CE%B9%CE%BF%CF%86%CF%89%CE%BD%CE%B9%CE%BA%CE%AE%CF%82%20%CE%9A%CE%AC%CE%BB%CF%85%CF%88%CE%B7%CF%82%2017_10_2017.xlsx";

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseFreqMhz(value) {
  let raw = normalizeText(value);
  if (!raw) {
    return NaN;
  }

  raw = raw.replace(/mhz$/i, "").replace(",", ".");
  return normalizeFreqMhz(raw);
}

function buildDescription(row, cityName) {
  const operatorName = normalizeText(row["Όνομα Εξουσιοδοτημένης Eταιρείας"]);
  const outputPower = normalizeText(row["Ισχύς Eξόδου"]);
  const maxErp = normalizeText(row["Μέγιστη Ακτινοβολούμενη Ισχύς"]);
  const powerType = normalizeText(row["Τύπος Ισχύος"]);
  const areaElevation = normalizeText(row["Υψόμετρο Περιοχής"]);
  const bandwidth = normalizeText(row["Εύρος Zώνης"]);
  const emissionType = normalizeText(row["Τύπος Εκπομπής"]);

  return [
    `Cyprus FM transmitter listed by DEC for ${cityName}.`,
    operatorName ? `Licensee: ${operatorName}.` : "",
    areaElevation ? `Site elevation: ${areaElevation}.` : "",
    bandwidth ? `Bandwidth: ${bandwidth}.` : "",
    outputPower ? `Output power: ${outputPower}.` : "",
    maxErp ? `Maximum radiated power: ${maxErp}${powerType ? ` ${powerType}` : ""}.` : "",
    emissionType ? `Emission: ${emissionType}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function loadDecCyStations({ signal } = {}) {
  const res = await fetch(DEC_XLSX_URL, {
    signal,
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download DEC FM workbook: HTTP ${res.status}`);
  }

  const workbook = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const row of rows) {
    const stationName = normalizeText(row["Όνομα Σταθμού"]);
    const cityName = normalizeText(row["Σημείο Εκπομπής"]);
    const freqMhz = parseFreqMhz(row["Συχνότητα"]);
    const powerType = normalizeText(row["Τύπος Ισχύος"]);

    if (!stationName || !cityName || !Number.isFinite(freqMhz)) {
      continue;
    }

    const dedupeKey = [
      normalizeKey(stationName),
      normalizeKey(cityName),
      freqMhz.toFixed(3),
    ].join("|");
    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      cityName,
      countryCode: "CY",
      curated: false,
      description: buildDescription(row, cityName),
      freqMhz,
      name: stationName,
      source: "DEC national radio broadcasting coverage plan",
      sourceUrl: DEC_PAGE_URL,
      tags: [
        "fm",
        "official",
        "dec",
        "cyprus",
        toTag(cityName),
        powerType ? toTag(powerType) : "fm",
      ],
      timezone: "Asia/Nicosia",
      verifiedAt,
    });
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
