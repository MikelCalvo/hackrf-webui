import http from "node:http";
import https from "node:https";

import XLSX from "xlsx";

import { compareText, normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const NRADA_REGISTER_PAGE_URL =
  "https://webportal.nrada.gov.ua/derzhavnyj-reyestr-sub-yektiv-informatsijnoyi-diyalnosti-u-sferi-telebachennya-i-radiomovlennya/";
const USER_AGENT = "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)";
const FM_MIN_MHZ = 87.5;
const FM_MAX_MHZ = 108;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 30000;

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanStationName(value) {
  return normalizeText(value)
    .replace(/[«»„“”]/gu, '"')
    .replace(/"{2,}/gu, '"')
    .replace(/^"+|"+$/gu, "");
}

function cleanLicenseeName(value) {
  return normalizeText(value).replace(/[«»„“”]/gu, '"').replace(/"{2,}/gu, '"');
}

function parseDecimal(value) {
  const match = normalizeText(value).replace(",", ".").match(/-?\d+(?:\.\d+)?/u);
  if (!match) {
    return NaN;
  }

  const numeric = Number.parseFloat(match[0]);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function cleanSettlementSource(value) {
  return normalizeText(value)
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickSettlement(rawSettlement, coverageArea, headquarterCity) {
  const direct = cleanSettlementSource(rawSettlement);
  if (direct) {
    return direct;
  }

  const coverageLead = cleanSettlementSource(coverageArea)
    .split(/\s*(?:,|;|\bта\b)\s*/u)[0]
    .trim();
  if (coverageLead) {
    return coverageLead;
  }

  return cleanSettlementSource(headquarterCity);
}

function extractCityName(rawSettlement) {
  const withoutPrefix = cleanSettlementSource(rawSettlement).replace(
    /^(?:м\.|місто|смт|с-ще|селище|сел\.|с\.|село)\s*/iu,
    "",
  );
  const withoutDistrict = withoutPrefix.split(
    /\s+(?=[\p{Lu}][\p{Letter}'’.-]+\s+(?:р-ну|району)\b)/u,
  )[0];
  return normalizeText(withoutDistrict);
}

function findHeaderIndex(headers, pattern) {
  return headers.findIndex((header) => pattern.test(normalizeText(header)));
}

function buildColumnMap(headers) {
  const columns = {
    licenseeName: findHeaderIndex(headers, /^Повне найменування$/iu),
    headquarterCity: findHeaderIndex(headers, /^Місцезнаходження \(місто\)$/iu),
    headquarterOblast: findHeaderIndex(headers, /^Місцезнаходження \(область\)$/iu),
    licenseeCode: findHeaderIndex(headers, /^Код ЄДРПОУ\/РНОКПП$/iu),
    activity: findHeaderIndex(headers, /^Вид діяльності\/Вид мовлення$/iu),
    mediaId: findHeaderIndex(headers, /^Ідентифікатор медіа$/iu),
    mediaName: findHeaderIndex(headers, /^Логотип\/Назва медіа$/iu),
    callsign: findHeaderIndex(headers, /^Позивні$/iu),
    settlement: findHeaderIndex(headers, /^Населений пункт$/iu),
    broadcastOblast: findHeaderIndex(headers, /^Область$/iu),
    technology: findHeaderIndex(headers, /^Вид медіа\/Технологія$/iu),
    channel: findHeaderIndex(headers, /^Канал$/iu),
    frequency: findHeaderIndex(headers, /^Частота$/iu),
    coverageArea: findHeaderIndex(
      headers,
      /^Територія розповсюдження\/територія надання сервісу$/iu,
    ),
    email: findHeaderIndex(headers, /^Адреса електронної пошти$/iu),
    notes: findHeaderIndex(headers, /^Примітки$/iu),
  };

  for (const [name, index] of Object.entries(columns)) {
    if (index < 0 && !["channel", "email", "mediaName", "notes"].includes(name)) {
      throw new Error(`Ukraine media register workbook is missing expected column ${name}`);
    }
  }

  return columns;
}

function getCell(row, index) {
  if (index < 0) {
    return "";
  }
  return normalizeText(row[index]);
}

function cleanSentenceValue(value) {
  return normalizeText(value).replace(/\s*[.,;:]+\s*$/u, "");
}

function buildDescription({
  broadcastOblast,
  coverageArea,
  frequencyLabel,
  headquarterCity,
  headquarterOblast,
  licenseeCode,
  licenseeName,
  mediaId,
  notes,
  rawSettlement,
  stationName,
}) {
  const parts = [
    `Ukrainian FM service listed in the National Council media register for ${stationName} in ${cleanSentenceValue(rawSettlement)}.`,
    licenseeName ? `Licensee: ${cleanSentenceValue(licenseeName)}.` : "",
    mediaId ? `Media ID: ${mediaId}.` : "",
    frequencyLabel ? `Frequency: ${frequencyLabel} MHz.` : "",
    broadcastOblast ? `Broadcast oblast: ${cleanSentenceValue(broadcastOblast)}.` : "",
    coverageArea ? `Coverage: ${cleanSentenceValue(coverageArea)}.` : "",
    headquarterCity
      ? `Headquarters: ${cleanSentenceValue(headquarterCity)}${
          headquarterOblast ? `, ${cleanSentenceValue(headquarterOblast)}` : ""
        }.`
      : "",
    licenseeCode ? `EDRPOU/RNOKPP: ${licenseeCode}.` : "",
    notes ? `Register note: ${cleanSentenceValue(notes)}.` : "",
  ];

  return parts.filter(Boolean).join(" ");
}

function requestBuffer(url, redirectCount = 0) {
  if (redirectCount > MAX_REDIRECTS) {
    return Promise.reject(new Error(`Too many redirects while fetching ${url}`));
  }

  return new Promise((resolve, reject) => {
    const targetUrl = new URL(url);
    const transport = targetUrl.protocol === "http:" ? http : https;
    const request = transport.request(
      targetUrl,
      {
        headers: {
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;q=0.9,*/*;q=0.8",
          "accept-encoding": "identity",
          "user-agent": USER_AGENT,
        },
        rejectUnauthorized: false,
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;
        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume();
          resolve(requestBuffer(new URL(location, url).toString(), redirectCount + 1));
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            reject(
              new Error(
                `Failed to fetch Ukrainian media register resource ${url}: HTTP ${statusCode}`,
              ),
            );
          });
          return;
        }

        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );

    request.on("error", reject);
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`Timed out after ${REQUEST_TIMEOUT_MS} ms while fetching ${url}`));
    });
    request.end();
  });
}

async function fetchText(url) {
  return (await requestBuffer(url)).toString("utf8");
}

function extractWorkbookUrl(pageHtml) {
  const workbookUrls = [...String(pageHtml).matchAll(/href="([^"]+\.xlsx)"/giu)]
    .map((match) => new URL(match[1], NRADA_REGISTER_PAGE_URL).toString())
    .filter((url) => /perelik-subyektiv-u-sferi-media/iu.test(url));

  const workbookUrl = workbookUrls[0];
  if (!workbookUrl) {
    throw new Error("National Council register page does not expose a media register XLSX link");
  }

  return workbookUrl;
}

function workbookToRows(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName =
    workbook.SheetNames.find((name) => /Ліцензіати|Реєстранти/iu.test(name)) ??
    workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) {
    throw new Error("Ukraine media register workbook does not contain a readable worksheet");
  }

  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
}

function extractRecords(rows) {
  const headerRowIndex = rows.findIndex(
    (row) =>
      row.some((cell) => /^Повне найменування$/iu.test(normalizeText(cell))) &&
      row.some((cell) => /^Частота$/iu.test(normalizeText(cell))) &&
      row.some((cell) => /^Населений пункт$/iu.test(normalizeText(cell))),
  );
  if (headerRowIndex < 0) {
    throw new Error("Ukraine media register workbook does not contain the expected header row");
  }

  const headers = rows[headerRowIndex].map((value) => normalizeText(value));
  const columns = buildColumnMap(headers);

  return rows
    .slice(headerRowIndex + 1)
    .filter((row) => row.some((cell) => normalizeText(cell)))
    .map((row) => ({
      activity: getCell(row, columns.activity),
      broadcastOblast: getCell(row, columns.broadcastOblast),
      channel: getCell(row, columns.channel),
      coverageArea: getCell(row, columns.coverageArea),
      frequencyLabel: getCell(row, columns.frequency),
      headquarterCity: getCell(row, columns.headquarterCity),
      headquarterOblast: getCell(row, columns.headquarterOblast),
      licenseeCode: getCell(row, columns.licenseeCode),
      licenseeName: cleanLicenseeName(getCell(row, columns.licenseeName)),
      mediaId: getCell(row, columns.mediaId),
      mediaName: cleanStationName(getCell(row, columns.mediaName)),
      notes: getCell(row, columns.notes),
      rawCallsign: cleanStationName(getCell(row, columns.callsign)),
      rawSettlement: getCell(row, columns.settlement),
      technology: getCell(row, columns.technology),
    }));
}

export async function loadNkrziUaStations() {
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const registerPageHtml = await fetchText(NRADA_REGISTER_PAGE_URL);
  const workbookUrl = extractWorkbookUrl(registerPageHtml);
  const rows = workbookToRows(await requestBuffer(workbookUrl));
  const records = extractRecords(rows);
  const dedupe = new Map();

  for (const record of records) {
    const stationName = record.rawCallsign || record.mediaName || record.licenseeName;
    const freqMhz = normalizeFreqMhz(parseDecimal(record.frequencyLabel));
    if (!stationName || !record.licenseeName || !record.mediaId) {
      continue;
    }
    if (!/радіомовлення/iu.test(record.activity)) {
      continue;
    }
    if (normalizeText(record.technology) !== "МГц") {
      continue;
    }
    if (!Number.isFinite(freqMhz) || freqMhz < FM_MIN_MHZ || freqMhz > FM_MAX_MHZ) {
      continue;
    }

    const rawSettlement = pickSettlement(
      record.rawSettlement,
      record.coverageArea,
      record.headquarterCity,
    );
    const cityName = extractCityName(rawSettlement) || extractCityName(record.headquarterCity);
    if (!cityName) {
      continue;
    }

    const dedupeKey = [
      record.mediaId,
      freqMhz.toFixed(3),
      rawSettlement || cityName,
      record.broadcastOblast,
    ]
      .map((part) => normalizeText(part).toUpperCase())
      .join("|");

    if (dedupe.has(dedupeKey)) {
      continue;
    }

    const tags = new Set([
      "fm",
      "official",
      "ukraine",
      "nrada",
      toTag(cityName),
      record.broadcastOblast ? toTag(record.broadcastOblast) : "ukraine",
      toTag(record.mediaId),
    ]);

    dedupe.set(dedupeKey, {
      cityName,
      countryCode: "UA",
      curated: false,
      description: buildDescription({
        broadcastOblast: record.broadcastOblast,
        coverageArea: record.coverageArea,
        frequencyLabel: freqMhz.toFixed(1),
        headquarterCity: record.headquarterCity,
        headquarterOblast: record.headquarterOblast,
        licenseeCode: record.licenseeCode,
        licenseeName: record.licenseeName,
        mediaId: record.mediaId,
        notes: record.notes,
        rawSettlement,
        stationName,
      }),
      freqMhz,
      name: stationName,
      source: "National Council of Ukraine media register export",
      sourceUrl: workbookUrl,
      tags: [...tags],
      timezone: "Europe/Kyiv",
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

export const NKRZI_UA_SOURCE_URL = NRADA_REGISTER_PAGE_URL;
