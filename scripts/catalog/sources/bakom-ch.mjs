import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const BAKOM_PAGE_URL = "https://www.bakom.admin.ch/en/location-of-radio-transmitters";
const BAKOM_ZIP_URL =
  "https://www.bakom.admin.ch/dam/en/sd-web/Ws8AaNy4muCH/ukw-koordinationsdaten.zip";
const TARGET_ENTRY = "BCSDR_CONCESSION_221208_CSV.CSV";

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseSwissCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const [headerLine, ...dataLines] = lines;
  const headers = headerLine.split("\t").map((column) => normalizeText(column));
  return dataLines.map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    );
  });
}

function parseNumber(value) {
  const normalized = normalizeText(value).replace(",", ".");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function buildDescription(row) {
  const parts = [
    `Swiss FM assignment listed by BAKOM for ${normalizeText(row.site_name)}.`,
    row["program.name"] ? `Program: ${normalizeText(row["program.name"])}.` : "",
    row.call_sign ? `Call sign: ${normalizeText(row.call_sign)}.` : "",
    row.province ? `Canton: ${normalizeText(row.province)}.` : "",
    Number.isFinite(parseNumber(row.erp_h_w))
      ? `Horizontal ERP: ${Math.round(parseNumber(row.erp_h_w))} W.`
      : "",
  ];

  return parts.filter(Boolean).join(" ");
}

async function downloadZipBuffer() {
  const res = await fetch(BAKOM_ZIP_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download BAKOM coordination ZIP: HTTP ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

async function readZipText(buffer) {
  const { default: AdmZip } = await import("adm-zip");
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry(TARGET_ENTRY);

  if (!entry) {
    throw new Error(`BAKOM ZIP is missing ${TARGET_ENTRY}`);
  }

  return zip.readAsText(entry, "utf8");
}

export async function loadBakomChStations() {
  const text = await readZipText(await downloadZipBuffer());
  const rows = parseSwissCsv(text);
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const row of rows) {
    const countryCode = normalizeText(row.adm);
    const stationName = normalizeText(row["program.name"]);
    const cityName = normalizeText(row.site_name);
    const freqMhz = normalizeFreqMhz(row.frq_assign);
    const latitude = parseNumber(row.Latitude);
    const longitude = parseNumber(row.Longitude);

    if (
      normalizeText(row.Statut) !== "O1" ||
      countryCode !== "SUI" ||
      !stationName ||
      !cityName ||
      !Number.isFinite(freqMhz)
    ) {
      continue;
    }
    if (freqMhz < 87.5 || freqMhz > 108) {
      continue;
    }

    const dedupeKey = [
      normalizeText(row.call_sign),
      cityName,
      stationName,
      freqMhz.toFixed(3),
    ].join("|");

    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      cityName,
      countryCode: "CH",
      curated: false,
      description: buildDescription(row),
      freqMhz,
      latitude,
      longitude,
      name: stationName,
      source: "BAKOM FM coordination archive",
      sourceUrl: BAKOM_PAGE_URL,
      tags: [
        "fm",
        "official",
        "bakom",
        "switzerland",
        row.province ? toTag(row.province) : "switzerland",
        row.call_sign ? toTag(row.call_sign) : "fm",
      ],
      timezone: "Europe/Zurich",
      verifiedAt,
    });
  }

  return [...dedupe.values()];
}
