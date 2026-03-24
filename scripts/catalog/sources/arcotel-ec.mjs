import XLSX from "xlsx";

import { compareText, normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const ARCOTEL_XLS_URL =
  "https://www.arcotel.gob.ec/wp-content/uploads/2021/12/8.1.3.-Listado_RTV-Noviembre-2021.xls";

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeProvinceCode(provinceName) {
  return `EC-${toTag(provinceName).toUpperCase()}`;
}

function extractPrimaryCity(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return "";
  }

  const cleaned = raw.replace(/\([^)]*\)/g, "").trim();
  const parts = cleaned.split(/\s*(?:\/|;|\||,|\+|-)\s*/);
  return normalizeText(parts[0] || cleaned);
}

function buildDescription(row, cityName, provinceName, freqMhz) {
  const concessionaire = normalizeText(row[2]);
  const representative = normalizeText(row[3]);
  const stationName = normalizeText(row[5]);
  const serviceType = normalizeText(row[8]);
  const areaServed = normalizeText(row[9]);
  const indicativo = normalizeText(row[11]);
  const studyCity = normalizeText(row[12]);
  const className = normalizeText(row[13]);

  const parts = [
    `FM station listed by ARCOTEL in the national concession register for ${cityName}, ${provinceName}.`,
    `Frequency: ${freqMhz.toFixed(1)} MHz.`,
    stationName ? `Station: ${stationName}.` : "",
    concessionaire ? `Concessionaire: ${concessionaire}.` : "",
    representative ? `Legal representative: ${representative}.` : "",
    serviceType ? `Service type: ${serviceType}.` : "",
    areaServed ? `Area served: ${areaServed}.` : "",
    indicativo ? `Indicativo: ${indicativo}.` : "",
    studyCity ? `Study city: ${studyCity}.` : "",
    className ? `Class: ${className}.` : "",
  ];

  return parts.filter(Boolean).join(" ");
}

function sheetToStations(sheet, verifiedAt) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const dedupe = new Map();

  for (let index = 6; index < rows.length; index += 1) {
    const row = rows[index];
    const provinceName = normalizeText(row[0]);
    const category = normalizeText(row[1]);
    const stationName = normalizeText(row[5]);
    const freqMhz = normalizeFreqMhz(row[6]);
    const serviceType = normalizeText(row[8]).toUpperCase();

    if (!provinceName || !category.startsWith("FM")) {
      continue;
    }
    if (!stationName || !Number.isFinite(freqMhz)) {
      continue;
    }
    if (!serviceType) {
      continue;
    }

    const cityName =
      extractPrimaryCity(row[12]) || extractPrimaryCity(row[9]) || provinceName;
    const provinceCode = normalizeProvinceCode(provinceName);
    const uniqueKey = row
      .slice(0, 15)
      .map((value) => normalizeText(value).toUpperCase())
      .join("|");

    if (dedupe.has(uniqueKey)) {
      continue;
    }

    dedupe.set(uniqueKey, {
      admin1Code: provinceCode,
      cityName,
      countryCode: "EC",
      curated: false,
      description: buildDescription(row, cityName, provinceName, freqMhz),
      freqMhz,
      name: stationName,
      source: "ARCOTEL national concession register workbook",
      sourceUrl: ARCOTEL_XLS_URL,
      tags: [
        "fm",
        "official",
        "arcotel",
        "ecuador",
        toTag(provinceName),
        toTag(serviceType),
        toTag(normalizeText(row[13]) || "unknown"),
      ],
      verifiedAt,
    });
  }

  return [...dedupe.values()].sort((left, right) => {
    const provinceDiff = compareText(left.admin1Code || "", right.admin1Code || "");
    if (provinceDiff !== 0) {
      return provinceDiff;
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

async function downloadWorkbook() {
  const response = await fetch(ARCOTEL_XLS_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download ARCOTEL workbook: HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function loadArcotelEcStations() {
  const workbook = XLSX.read(await downloadWorkbook(), { type: "buffer" });
  const sheet = workbook.Sheets["LISTADO"];

  if (!sheet) {
    throw new Error("ARCOTEL workbook is missing the LISTADO sheet");
  }

  const verifiedAt = new Date().toISOString().slice(0, 10);
  return sheetToStations(sheet, verifiedAt);
}
