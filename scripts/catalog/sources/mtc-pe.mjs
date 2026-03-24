import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const MTC_DATASET_PAGE_URL =
  "https://www.datosabiertos.gob.pe/dataset/autorizaciones-vigentes-de-radiodifusi%C3%B3n-sonora-al-i-semestre-2025-ministerio-de-transportes";
const MTC_PACKAGE_SHOW_URL =
  "https://www.datosabiertos.gob.pe/api/3/action/package_show?id=autorizaciones-vigentes-de-radiodifusi%C3%B3n-sonora-al-i-semestre-2025-ministerio-de-transportes";

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[\s._-]+/g, " ");
}

function sniffDelimiter(sampleLine) {
  const candidates = [",", ";", "\t", "|"];
  let bestDelimiter = ",";
  let bestScore = -1;

  for (const delimiter of candidates) {
    const score = sampleLine.split(delimiter).length;
    if (score > bestScore) {
      bestDelimiter = delimiter;
      bestScore = score;
    }
  }

  return bestDelimiter;
}

function parseDelimitedLine(line, delimiter) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseDelimitedTable(text) {
  const normalized = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [];
  }

  const delimiter = sniffDelimiter(lines[0]);
  const headers = parseDelimitedLine(lines[0], delimiter).map(normalizeHeader);
  const rows = [];

  for (const line of lines.slice(1)) {
    const values = parseDelimitedLine(line, delimiter);
    if (values.length === 0) {
      continue;
    }

    const row = {};
    for (let index = 0; index < headers.length; index += 1) {
      row[headers[index]] = values[index] ?? "";
    }
    rows.push(row);
  }

  return rows;
}

function pick(row, candidates) {
  for (const candidate of candidates) {
    const value = row[normalizeHeader(candidate)];
    if (value !== undefined && String(value).trim()) {
      return String(value).trim();
    }
  }

  return "";
}

function parseFreq(value) {
  const numeric = normalizeFreqMhz(String(value ?? "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : NaN;
}

function isFmBand(row, freqMhz) {
  const band = normalizeText(
    pick(row, ["banda", "band", "tipo de banda", "frecuencia modulada", "fm"]),
  );

  if (band.includes("frecuencia modulada") || band === "fm" || band.includes("fm")) {
    return true;
  }

  return Number.isFinite(freqMhz) && freqMhz >= 87.5 && freqMhz <= 108.5;
}

function buildDescription(row, freqMhz, locationParts) {
  const holder = pick(row, [
    "razon social",
    "razon_social",
    "titular",
    "empresa",
    "nombre comercial",
    "denominacion",
    "nombre",
  ]);
  const purpose = pick(row, ["finalidad", "tipo de servicio", "clasificacion", "tipo"]);
  const parts = [
    `Peru FM authorization listed by MTC for ${holder || "an unnamed holder"}.`,
    locationParts.filter(Boolean).join(", "),
    Number.isFinite(freqMhz) ? `Frequency: ${freqMhz.toFixed(1)} MHz.` : "",
    purpose ? `Purpose: ${purpose}.` : "",
  ];

  return parts.filter(Boolean).join(" ");
}

async function resolveDatasetResourceUrl() {
  const res = await fetch(MTC_PACKAGE_SHOW_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to load MTC metadata: HTTP ${res.status}`);
  }

  const payload = await res.json();
  const dataset = payload?.result?.[0];
  const resource = dataset?.resources?.find((item) => {
    const format = normalizeText(item?.format);
    const mimetype = normalizeText(item?.mimetype);
    return format === "csv" || mimetype === "text/csv";
  });

  if (!resource?.url) {
    throw new Error("MTC dataset does not expose a CSV resource");
  }

  return resource.url;
}

async function downloadCsvText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
      accept: "text/csv,text/plain;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download MTC CSV: HTTP ${res.status}`);
  }

  return res.text();
}

function buildAdmin1Code(department) {
  const tag = toTag(department || "peru");
  return `PE-${tag.toUpperCase()}`;
}

export async function loadMtcPeStations() {
  const resourceUrl = await resolveDatasetResourceUrl();
  const csvText = await downloadCsvText(resourceUrl);
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const rows = parseDelimitedTable(csvText);
  const dedupe = new Map();

  for (const row of rows) {
    const department = pick(row, ["departamento", "dpto", "region", "departamento/provincia"]);
    const province = pick(row, ["provincia", "provincia/distrito"]);
    const district = pick(row, ["distrito", "localidad", "ubicacion"]);
    const holder = pick(row, [
      "razon social",
      "razon_social",
      "titular",
      "empresa",
      "nombre comercial",
      "denominacion",
      "nombre",
    ]);
    const freqMhz = parseFreq(
      pick(row, ["frecuencia planta", "frecuencia", "freq", "frecuencia mhz"]),
    );

    if (!holder || !isFmBand(row, freqMhz)) {
      continue;
    }
    if (!Number.isFinite(freqMhz)) {
      continue;
    }

    const admin1Code = department ? buildAdmin1Code(department) : undefined;
    const cityName = district || province || department || "Peru";
    const cityKey = normalizeText(cityName);
    const name = holder;
    const key = [
      "PE",
      admin1Code || "",
      normalizeText(province),
      cityKey,
      normalizeText(name),
      freqMhz.toFixed(3),
    ].join("|");

    if (dedupe.has(key)) {
      continue;
    }

    const purpose = pick(row, ["finalidad", "tipo de servicio", "clasificacion", "tipo"]);
    const tags = ["fm", "official", "mtc", "peru"];

    if (department) {
      tags.push(toTag(department));
    }
    if (province && province !== department) {
      tags.push(toTag(province));
    }
    if (purpose) {
      tags.push(toTag(purpose));
    }

    dedupe.set(key, {
      admin1Code,
      cityName,
      countryCode: "PE",
      curated: false,
      description: buildDescription(row, freqMhz, [district, province, department]),
      freqMhz,
      name,
      source: "Ministerio de Transportes y Comunicaciones - MTC",
      sourceUrl: MTC_DATASET_PAGE_URL,
      tags,
      verifiedAt,
    });
  }

  return [...dedupe.values()];
}
