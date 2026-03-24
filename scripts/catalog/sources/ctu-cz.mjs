import XLSX from "xlsx";

import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const CTU_DATASET_PAGE_URL = "https://data.ctu.gov.cz/dataset/rozhlasove-vysilace";
const CTU_CSV_URL =
  "https://data.ctu.gov.cz/sites/default/files/imports/import_rozhlas/prehled_rozhlasovych_kmitoctu.csv";

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function titleCase(value) {
  const normalized = normalizeText(value).toLocaleLowerCase("cs");
  if (!normalized) {
    return "";
  }

  return normalized
    .split(/(\s+|-)/)
    .map((part) => {
      if (!part || /^\s+$/.test(part) || part === "-") {
        return part;
      }
      return `${part[0].toLocaleUpperCase("cs")}${part.slice(1)}`;
    })
    .join("");
}

function parseSiteLabel(value) {
  const normalized = normalizeText(value).replace(/_/g, " ");
  if (!normalized) {
    return "";
  }

  const primary = normalized.split(/\s*-\s*/)[0] || normalized;
  return titleCase(primary);
}

function buildDescription(row, cityName) {
  const parts = [
    `Czech FM transmitter listed by CTU for ${cityName || row.Program}.`,
    row.Program ? `Program: ${row.Program}.` : "",
    row["PI KÓD RDS"] ? `RDS PI: ${row["PI KÓD RDS"]}.` : "",
    row.Polarizace ? `Polarization: ${row.Polarizace}.` : "",
    Number.isFinite(row["ERP W"])
      ? `ERP: ${Number(row["ERP W"]).toLocaleString("en-US")} W.`
      : "",
  ];

  return parts.filter(Boolean).join(" ");
}

export async function loadCtuCzStations() {
  const res = await fetch(CTU_CSV_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download CTU FM dataset: HTTP ${res.status}`);
  }

  const workbook = XLSX.read(await res.text(), { type: "string" });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
    defval: "",
  });
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const row of rows) {
    const type = normalizeText(row["Typ"]);
    const freqMhz = normalizeFreqMhz(row["Kmitočet MHz"]);
    if (!type.startsWith("FM") || !Number.isFinite(freqMhz)) {
      continue;
    }

    const stationName = normalizeText(row["Program"]);
    const cityName = parseSiteLabel(row["Vysílač"]);
    const latitude = Number(row["Zeměpisná šířka"]);
    const longitude = Number(row["Zeměpisná délka"]);

    if (!stationName || !cityName) {
      continue;
    }

    const dedupeKey = `${cityName}|${stationName}|${freqMhz.toFixed(3)}`;
    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      cityName,
      countryCode: "CZ",
      curated: false,
      description: buildDescription(row, cityName),
      freqMhz,
      latitude,
      longitude,
      name: stationName,
      source: "CTU radio transmitters dataset",
      sourceUrl: CTU_DATASET_PAGE_URL,
      tags: [
        "fm",
        "official",
        "ctu",
        "czech-republic",
        row.Polarizace ? toTag(row.Polarizace) : "fm",
      ],
      timezone: "Europe/Prague",
      verifiedAt,
    });
  }

  return [...dedupe.values()];
}
