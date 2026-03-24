import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const ATT_FM_PAGE_URL = "https://www.att.gob.bo/operadores-de-radiodifusion-fm";
// ATT's public FM page currently resolves the working SINADI table through the /AM path.
const ATT_SINADI_FM_URL = "https://plataformas.att.gob.bo/index.php/sinadi/index/AM";

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&aacute;/gi, "a")
    .replace(/&eacute;/gi, "e")
    .replace(/&iacute;/gi, "i")
    .replace(/&oacute;/gi, "o")
    .replace(/&uacute;/gi, "u")
    .replace(/&Aacute;/g, "A")
    .replace(/&Eacute;/g, "E")
    .replace(/&Iacute;/g, "I")
    .replace(/&Oacute;/g, "O")
    .replace(/&Uacute;/g, "U")
    .replace(/&ntilde;/gi, "n")
    .replace(/&Ntilde;/g, "N");
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/[\u0091\u0092\u0093\u0094]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function parseFrequency(value) {
  const cleaned = String(value || "")
    .replace(/[^0-9,.-]/g, "")
    .replace(",", ".");
  const freqMhz = normalizeFreqMhz(cleaned);
  return Number.isFinite(freqMhz) ? freqMhz : NaN;
}

function extractTableRows(html) {
  const tableMatch = html.match(/<table[^>]+id="data-table"[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tableMatch) {
    throw new Error("ATT SINADI FM table body not found");
  }

  return [...tableMatch[1].matchAll(/<tr>\s*([\s\S]*?)\s*<\/tr>/gi)].map((match) => match[1]);
}

function parseRow(rowHtml) {
  const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) =>
    stripTags(match[1]),
  );

  if (cells.length < 4) {
    return null;
  }

  return {
    area: cells[1],
    department: cells[0],
    freqMhz: parseFrequency(cells[2]),
    holder: cells[3],
  };
}

function buildDescription(row) {
  return [
    `Bolivia FM operator listed by ATT for ${row.area}, ${row.department}.`,
    Number.isFinite(row.freqMhz) ? `Frequency: ${row.freqMhz.toFixed(1)} MHz.` : "",
    `Holder: ${row.holder}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function loadAttBoStations() {
  const res = await fetch(ATT_SINADI_FM_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download ATT SINADI FM page: HTTP ${res.status}`);
  }

  const html = await res.text();
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const rowHtml of extractTableRows(html)) {
    const row = parseRow(rowHtml);
    if (!row) {
      continue;
    }
    if (!row.department || !row.area || !row.holder) {
      continue;
    }
    if (!Number.isFinite(row.freqMhz) || row.freqMhz < 87 || row.freqMhz > 108.5) {
      continue;
    }

    const admin1Code = `BO-${toTag(row.department).toUpperCase()}`;
    const key = [
      admin1Code,
      normalizeText(row.area),
      normalizeText(row.holder),
      row.freqMhz.toFixed(3),
    ].join("|");

    if (dedupe.has(key)) {
      continue;
    }

    dedupe.set(key, {
      admin1Code,
      cityName: row.area,
      countryCode: "BO",
      curated: false,
      description: buildDescription(row),
      freqMhz: row.freqMhz,
      name: row.holder,
      source: "ATT SINADI FM operator list",
      sourceUrl: ATT_SINADI_FM_URL,
      tags: ["fm", "official", "att", "sinadi", "bolivia", toTag(row.department)],
      verifiedAt,
    });
  }

  return [...dedupe.values()].map((station) => ({
    ...station,
    description: `${station.description} Public page: ${ATT_FM_PAGE_URL}.`,
  }));
}
