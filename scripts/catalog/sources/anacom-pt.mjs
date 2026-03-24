import {
  compareText,
  normalizeFreqMhz,
  normalizeKey,
  toTag,
} from "../lib/utils.mjs";

const ERC_REGISTRY_PAGE_URL =
  "https://www.erc.pt/pt/fs/listagem-de-registos-na-erc/";
const USER_AGENT =
  "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)";
const SNAPSHOT_DATE = "2022-01-03";

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_, decimal) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&aacute;/giu, "á")
    .replace(/&eacute;/giu, "é")
    .replace(/&iacute;/giu, "í")
    .replace(/&oacute;/giu, "ó")
    .replace(/&uacute;/giu, "ú")
    .replace(/&atilde;/giu, "ã")
    .replace(/&otilde;/giu, "õ")
    .replace(/&ccedil;/giu, "ç")
    .replace(/&ordm;/giu, "º");
}

function stripTags(value) {
  return decodeHtmlEntities(String(value ?? "").replace(/<[^>]+>/gu, " "));
}

function extractRadioSheetUrl(html) {
  for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/giu)) {
    const href = normalizeText(decodeHtmlEntities(match[1]));
    const label = normalizeKey(stripTags(match[2]));
    if (label === "operadores de radio" && href.includes("docs.google.com/spreadsheets/d/")) {
      return href;
    }
  }

  throw new Error("Failed to discover the ERC radio register spreadsheet");
}

function buildGvizUrl(sheetUrl) {
  const match = String(sheetUrl).match(/\/spreadsheets\/d\/([^/]+)/u);
  if (!match) {
    throw new Error("Failed to extract the ERC spreadsheet id");
  }

  return `https://docs.google.com/spreadsheets/d/${match[1]}/gviz/tq?tqx=out:json`;
}

function parseGvizResponse(text) {
  const payload = String(text ?? "").trim().replace(/^\uFEFF/u, "");
  const prefix = "google.visualization.Query.setResponse(";
  const start = payload.indexOf(prefix);
  const end = payload.lastIndexOf(");");
  if (start === -1 || end === -1) {
    throw new Error("Failed to parse the ERC gviz response wrapper");
  }

  return JSON.parse(payload.slice(start + prefix.length, end));
}

function getCellText(cell) {
  if (!cell) {
    return "";
  }
  if (typeof cell.f === "string" && normalizeText(cell.f)) {
    return normalizeText(cell.f);
  }
  if (typeof cell.v === "string") {
    return normalizeText(cell.v);
  }
  if (cell.v == null) {
    return "";
  }
  return normalizeText(String(cell.v));
}

function findMatchingIndices(headers, predicate) {
  return headers.flatMap((header, index) =>
    predicate(normalizeKey(header))
      ? [index]
      : []);
}

function formatFreq(freqMhz) {
  return freqMhz.toFixed(3).replace(/\.?0+$/u, "");
}

function parseFrequencyLabels(value) {
  const cleaned = normalizeText(value)
    .replace(/mhz/giu, "")
    .replace(/fm$/giu, "")
    .trim();
  if (!cleaned) {
    return [];
  }

  return cleaned
    .split(/\s*\/\s*|\s*;\s*|\s+\be\b\s+/giu)
    .map((part) => normalizeText(part))
    .filter(Boolean);
}

function parseFrequencyMhz(value) {
  const cleaned = normalizeText(value)
    .replace(/mhz/giu, "")
    .replace(/fm$/giu, "")
    .replace(/\s+/gu, "")
    .replace(",", ".");
  const freqMhz = normalizeFreqMhz(cleaned);
  if (!Number.isFinite(freqMhz) || freqMhz < 87 || freqMhz > 108.5) {
    return NaN;
  }

  return freqMhz;
}

function extractCoverageTags(coverage) {
  const normalized = normalizeKey(coverage);
  const tags = [];
  if (normalized.includes("local")) {
    tags.push("local");
  }
  if (normalized.includes("regional")) {
    tags.push("regional");
  }
  if (normalized.includes("nacional")) {
    tags.push("national");
  }
  if (normalized.includes("internacional")) {
    tags.push("international");
  }
  return tags;
}

function inferTimezone(region) {
  const normalized = normalizeKey(region);
  if (normalized.includes("acores")) {
    return "Atlantic/Azores";
  }
  if (normalized.includes("madeira")) {
    return "Atlantic/Madeira";
  }
  return "Europe/Lisbon";
}

function isPublicRadio(operatorName) {
  const normalized = normalizeKey(operatorName);
  return normalized.includes("radio e televisao de portugal");
}

function buildDescription({
  channelPs,
  cityName,
  contentType,
  coverage,
  district,
  freqMhz,
  licensingDistrict,
  licensingMunicipality,
  operatorName,
  recordNumber,
  registrationDate,
  region,
  serviceName,
}) {
  const localityBits = [cityName, district, region].filter(Boolean);
  const licensingBits = [licensingMunicipality, licensingDistrict].filter(Boolean);

  return [
    `Portuguese FM radio service listed in the ERC public radio-register export (active services as of ${SNAPSHOT_DATE}).`,
    `Station: ${serviceName}.`,
    `Frequency: ${formatFreq(freqMhz)} MHz.`,
    operatorName ? `Operator: ${operatorName}.` : "",
    localityBits.length > 0 ? `Locality: ${localityBits.join(", ")}.` : "",
    coverage ? `Coverage: ${coverage}.` : "",
    contentType ? `Format: ${contentType}.` : "",
    licensingBits.length > 0 ? `Licensing area: ${licensingBits.join(", ")}.` : "",
    recordNumber
      ? `ERC register: ${recordNumber}${registrationDate ? ` (registered ${registrationDate})` : ""}.`
      : "",
    channelPs ? `PS: ${channelPs}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildTags({
  channelPs,
  cityName,
  contentType,
  coverage,
  district,
  operatorName,
  region,
}) {
  const tags = new Set(["fm", "official", "erc", "portugal"]);

  for (const part of [cityName, district, region, channelPs, contentType]) {
    const tag = toTag(part);
    if (tag) {
      tags.add(tag);
    }
  }

  for (const coverageTag of extractCoverageTags(coverage)) {
    tags.add(coverageTag);
  }

  if (isPublicRadio(operatorName)) {
    tags.add("public-radio");
    tags.add("rtp");
  }

  return [...tags];
}

function stationDedupKey({ cityName, freqMhz, operatorName, recordNumber, serviceName }) {
  return [
    normalizeKey(recordNumber),
    normalizeKey(serviceName),
    normalizeKey(operatorName),
    normalizeKey(cityName),
    freqMhz.toFixed(3),
  ].join("|");
}

export async function loadAnacomPtStations({ signal } = {}) {
  const pageRes = await fetch(ERC_REGISTRY_PAGE_URL, {
    signal,
    headers: {
      "user-agent": USER_AGENT,
    },
  });
  if (!pageRes.ok) {
    throw new Error(`Failed to download the ERC registry page: HTTP ${pageRes.status}`);
  }

  const sheetUrl = extractRadioSheetUrl(await pageRes.text());
  const dataUrl = buildGvizUrl(sheetUrl);
  const dataRes = await fetch(dataUrl, {
    signal,
    headers: {
      "user-agent": USER_AGENT,
    },
  });
  if (!dataRes.ok) {
    throw new Error(`Failed to download the ERC radio register export: HTTP ${dataRes.status}`);
  }

  const payload = parseGvizResponse(await dataRes.text());
  const table = payload?.table;
  const headers = Array.isArray(table?.cols)
    ? table.cols.map((col) => normalizeText(col?.label))
    : [];
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const verifiedAt = new Date().toISOString().slice(0, 10);

  const recordNumberIndex = findMatchingIndices(headers, (header) =>
    header.includes("numero de registo"))[0] ?? -1;
  const registrationDateIndex = findMatchingIndices(headers, (header) =>
    header === "data de inscricao")[0] ?? -1;
  const operatorNameIndex = findMatchingIndices(headers, (header) =>
    header === "designacao social do operador")[0] ?? -1;
  const serviceNameIndex = findMatchingIndices(headers, (header) =>
    header === "servico de programas de radio")[0] ?? -1;
  const frequencyIndex = findMatchingIndices(headers, (header) =>
    header === "frequencia")[0] ?? -1;
  const contentTypeIndex = findMatchingIndices(headers, (header) =>
    header === "conteudo tipo programacao")[0] ?? -1;
  const coverageIndex = findMatchingIndices(headers, (header) =>
    header === "area de cobertura")[0] ?? -1;
  const licensingDistrictIndex = findMatchingIndices(headers, (header) =>
    header === "distrito de licenciamento")[0] ?? -1;
  const licensingMunicipalityIndex = findMatchingIndices(headers, (header) =>
    header === "concelho de licenciamento")[0] ?? -1;
  const channelPsIndex = findMatchingIndices(headers, (header) =>
    header === "nome canal programas ps")[0] ?? -1;

  const localityIndices = findMatchingIndices(headers, (header) => header === "localidade");
  const districtIndices = findMatchingIndices(headers, (header) => header === "distrito");
  const regionIndices = findMatchingIndices(headers, (header) =>
    header.startsWith("regiao autonoma"));

  const operatorLocalityIndex = localityIndices[0] ?? -1;
  const cityIndex = localityIndices[1] ?? operatorLocalityIndex;
  const operatorDistrictIndex = districtIndices[0] ?? -1;
  const districtIndex = districtIndices[1] ?? operatorDistrictIndex;
  const operatorRegionIndex = regionIndices[0] ?? -1;
  const regionIndex = regionIndices[1] ?? operatorRegionIndex;

  const dedupe = new Map();

  for (const row of rows) {
    const cells = Array.isArray(row?.c) ? row.c : [];
    const serviceName = getCellText(cells[serviceNameIndex]);
    const operatorName = getCellText(cells[operatorNameIndex]);
    const cityName =
      getCellText(cells[cityIndex]) ||
      getCellText(cells[licensingMunicipalityIndex]) ||
      getCellText(cells[operatorLocalityIndex]);
    const district =
      getCellText(cells[districtIndex]) ||
      getCellText(cells[licensingDistrictIndex]) ||
      getCellText(cells[operatorDistrictIndex]);
    const region = getCellText(cells[regionIndex]) || getCellText(cells[operatorRegionIndex]);
    const coverage = getCellText(cells[coverageIndex]);
    const contentType = getCellText(cells[contentTypeIndex]);
    const recordNumber = getCellText(cells[recordNumberIndex]);
    const registrationDate = getCellText(cells[registrationDateIndex]);
    const licensingDistrict = getCellText(cells[licensingDistrictIndex]);
    const licensingMunicipality = getCellText(cells[licensingMunicipalityIndex]);
    const channelPs = getCellText(cells[channelPsIndex]);
    const frequencyLabels = parseFrequencyLabels(getCellText(cells[frequencyIndex]));

    if (!serviceName || !operatorName || !cityName || frequencyLabels.length === 0) {
      continue;
    }

    const seenFrequencies = new Set();
    for (const frequencyLabel of frequencyLabels) {
      const freqMhz = parseFrequencyMhz(frequencyLabel);
      if (!Number.isFinite(freqMhz)) {
        continue;
      }

      const freqKey = freqMhz.toFixed(3);
      if (seenFrequencies.has(freqKey)) {
        continue;
      }
      seenFrequencies.add(freqKey);

      const station = {
        cityName,
        countryCode: "PT",
        curated: false,
        description: buildDescription({
          channelPs,
          cityName,
          contentType,
          coverage,
          district,
          freqMhz,
          licensingDistrict,
          licensingMunicipality,
          operatorName,
          recordNumber,
          registrationDate,
          region,
          serviceName,
        }),
        freqMhz,
        name: serviceName,
        source: "ERC Operadores de Rádio register list",
        sourceUrl: ERC_REGISTRY_PAGE_URL,
        tags: buildTags({
          channelPs,
          cityName,
          contentType,
          coverage,
          district,
          operatorName,
          region,
        }),
        timezone: inferTimezone(region),
        verifiedAt,
      };

      const dedupeKey = stationDedupKey({
        cityName,
        freqMhz,
        operatorName,
        recordNumber,
        serviceName,
      });
      if (!dedupe.has(dedupeKey)) {
        dedupe.set(dedupeKey, station);
      }
    }
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
