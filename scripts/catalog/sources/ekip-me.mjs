import XLSX from "xlsx";

import { compareText, normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const AMU_REGISTRY_URL = "https://amu.me/registar/";
const USER_AGENT = "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)";
const FM_MIN_MHZ = 87.5;
const FM_MAX_MHZ = 108;

const RADIO_CATEGORY_EXPORTS = [
  {
    slug: "rtcg",
    label: "RTCG",
    workbookUrl: "https://amu.me/wp-json/api/v1/excel?select-emiter_kategorija=rtcg",
  },
  {
    slug: "lokalni-javni-radio-emiteri",
    label: "Lokalni javni radio emiteri",
    workbookUrl:
      "https://amu.me/wp-json/api/v1/excel?select-emiter_kategorija=lokalni-javni-radio-emiteri",
  },
  {
    slug: "komercijalni-radio-emiteri-2",
    label: "Komercijalni radio emiteri",
    workbookUrl:
      "https://amu.me/wp-json/api/v1/excel?select-emiter_kategorija=komercijalni-radio-emiteri-2",
  },
  {
    slug: "neprofitni-radio-emiteri",
    label: "Neprofitni radio emiteri",
    workbookUrl:
      "https://amu.me/wp-json/api/v1/excel?select-emiter_kategorija=neprofitni-radio-emiteri",
  },
];

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanQuotedText(value) {
  return normalizeText(value).replace(/^"+|"+$/g, "");
}

function findRowKey(row, pattern) {
  return Object.keys(row).find((key) => pattern.test(normalizeText(key))) ?? "";
}

function splitLines(value) {
  return String(value ?? "")
    .split(/\r?\n/u)
    .map((line) => normalizeText(line))
    .filter(Boolean);
}

function splitCsvish(value) {
  return normalizeText(value)
    .split(/\s*[,/]\s*/u)
    .map((part) => normalizeText(part))
    .filter(Boolean);
}

function parseDecimal(value) {
  const match = normalizeText(value)
    .replace(/\./g, "")
    .replace(",", ".")
    .match(/-?\d+(?:\.\d+)?/u);
  if (!match) {
    return NaN;
  }

  const numeric = Number.parseFloat(match[0]);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function buildColumnMap(row) {
  const columns = {
    founder: findRowKey(row, /^Osnivač$|^Founder$/iu),
    serviceName: findRowKey(row, /^Naziv usluge$|^Name of service provider$/iu),
    category: findRowKey(row, /^Kategorija$|^Category$/iu),
    approvalNumber: findRowKey(row, /^Broj odobrenja$|^Approval number$/iu),
    issueDate: findRowKey(row, /^Datum izdavanja odobrenja$|^Date of issue$/iu),
    serviceType: findRowKey(row, /^Vrsta usluge$|^Type of service/i),
    platform: findRowKey(row, /^Platforma$|^Platform/i),
    coverageArea: findRowKey(row, /^Zona pokrivanja$|^Coverage area$/iu),
    language: findRowKey(row, /^Jezik emitovanja$|^Language of publication$/iu),
    pib: findRowKey(row, /^PIB$/iu),
    director: findRowKey(row, /^Direktor$|^Director$/iu),
    responsiblePerson: findRowKey(row, /^Odgovorna osoba$|^Responsible person$/iu),
    city: findRowKey(row, /^Grad$|^City$/iu),
    address: findRowKey(row, /^Adresa$|^Address$/iu),
    email: findRowKey(row, /^Email$/iu),
    telephone: findRowKey(row, /^Telefon$|^Telephone$/iu),
    website: findRowKey(row, /^Web sajt$|^Website$/iu),
    transmissions: findRowKey(row, /^FM:CH .*Opština.*Lokacija/i),
  };

  for (const [name, key] of Object.entries(columns)) {
    if (!key && name !== "language" && name !== "responsiblePerson" && name !== "website") {
      throw new Error(`AMU workbook is missing expected column ${name}`);
    }
  }

  return columns;
}

function parseTransmissionLine(rawLine) {
  const line = normalizeText(rawLine);
  if (!line) {
    return null;
  }

  const parts = line.split(/\s*\/\s*/u).map((part) => normalizeText(part));
  if (parts.length < 2) {
    return null;
  }

  const freqMhz = normalizeFreqMhz(parseDecimal(parts[0]));
  if (!Number.isFinite(freqMhz)) {
    return null;
  }

  return {
    freqMhz,
    municipality: parts[1] || "",
    location: normalizeText(parts.slice(2).join(" / ")),
  };
}

function buildDescription({
  approvalNumber,
  baseCity,
  categoryName,
  coverageArea,
  director,
  founder,
  issueDate,
  language,
  location,
  municipality,
  pib,
  serviceType,
  stationName,
}) {
  const parts = [
    `Montenegrin FM entry listed by AMU for ${stationName} in ${municipality}.`,
    founder ? `Founder: ${founder}.` : "",
    approvalNumber ? `Approval: ${approvalNumber}.` : "",
    issueDate ? `Issued: ${issueDate}.` : "",
    categoryName ? `Category: ${categoryName}.` : "",
    serviceType ? `Service type: ${serviceType}.` : "",
    coverageArea ? `Coverage: ${coverageArea}.` : "",
    location ? `Transmitter site: ${location}.` : "",
    baseCity && baseCity !== municipality ? `Provider city: ${baseCity}.` : "",
    language ? `Language: ${language}.` : "",
    director ? `Director: ${director}.` : "",
    pib ? `PIB: ${pib}.` : "",
  ];

  return parts.filter(Boolean).join(" ");
}

async function downloadWorkbook(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download AMU workbook ${url}: HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function workbookToRows(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    throw new Error("AMU workbook does not contain a readable worksheet");
  }

  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

function extractStationsFromRows(rows, categoryExport, verifiedAt, dedupe) {
  const sampleRow = rows.find((row) =>
    Object.values(row).some((value) => normalizeText(value)),
  );
  if (!sampleRow) {
    return;
  }

  const columns = buildColumnMap(sampleRow);

  for (const row of rows) {
    if (!Object.values(row).some((value) => normalizeText(value))) {
      continue;
    }

    const stationName = cleanQuotedText(row[columns.serviceName]);
    const founder = normalizeText(row[columns.founder]);
    const approvalNumber = normalizeText(row[columns.approvalNumber]);
    const issueDate = normalizeText(row[columns.issueDate]);
    const categoryName = normalizeText(row[columns.category]) || categoryExport.label;
    const serviceType = normalizeText(row[columns.serviceType]);
    const platform = normalizeText(row[columns.platform]).toUpperCase();
    const coverageArea = normalizeText(row[columns.coverageArea]);
    const language = normalizeText(row[columns.language]);
    const pib = normalizeText(row[columns.pib]);
    const director = normalizeText(row[columns.director]);
    const baseCity = normalizeText(row[columns.city]);
    const rawTransmissionLines = splitLines(row[columns.transmissions]);

    if (!stationName || !approvalNumber) {
      continue;
    }
    if (!/radij|radio/iu.test(serviceType)) {
      continue;
    }
    if (platform && !platform.includes("FM")) {
      continue;
    }

    let parsedCount = 0;

    for (const rawTransmissionLine of rawTransmissionLines) {
      const transmission = parseTransmissionLine(rawTransmissionLine);
      if (!transmission) {
        continue;
      }
      if (transmission.freqMhz < FM_MIN_MHZ || transmission.freqMhz > FM_MAX_MHZ) {
        continue;
      }

      parsedCount += 1;

      const municipality = transmission.municipality || baseCity || "Montenegro";
      const location = transmission.location || municipality;
      const dedupeKey = [
        approvalNumber,
        transmission.freqMhz.toFixed(3),
        municipality,
        location,
      ]
        .map((part) => normalizeText(part).toUpperCase())
        .join("|");

      if (dedupe.has(dedupeKey)) {
        continue;
      }

      const tags = new Set([
        "fm",
        "official",
        "amu",
        "montenegro",
        categoryExport.slug === "rtcg" ? "rtcg" : toTag(categoryName),
        coverageArea ? toTag(coverageArea) : "radio",
        municipality ? toTag(municipality) : "montenegro",
        approvalNumber ? toTag(approvalNumber) : "approval",
      ]);

      for (const languagePart of splitCsvish(language)) {
        tags.add(toTag(languagePart));
      }

      dedupe.set(dedupeKey, {
        cityName: municipality,
        countryCode: "ME",
        curated: false,
        description: buildDescription({
          approvalNumber,
          baseCity,
          categoryName,
          coverageArea,
          director,
          founder,
          issueDate,
          language,
          location,
          municipality,
          pib,
          serviceType,
          stationName,
        }),
        freqMhz: transmission.freqMhz,
        name: stationName,
        source: "AMU Montenegro media register export",
        sourceUrl: categoryExport.workbookUrl,
        tags: [...tags],
        timezone: "Europe/Podgorica",
        verifiedAt,
      });
    }

    if (!parsedCount) {
      throw new Error(
        `AMU row ${approvalNumber} (${stationName}) did not yield any FM transmissions`,
      );
    }
  }
}

export async function loadEkipMeStations() {
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const categoryExport of RADIO_CATEGORY_EXPORTS) {
    const rows = workbookToRows(await downloadWorkbook(categoryExport.workbookUrl));
    extractStationsFromRows(rows, categoryExport, verifiedAt, dedupe);
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

export const EKIP_ME_SOURCE_URL = AMU_REGISTRY_URL;
