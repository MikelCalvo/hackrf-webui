import XLSX from "xlsx";

import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const UKE_PAGE_URL =
  "https://bip.uke.gov.pl/rezerwacje-czestotliwosci/rezerwacje-radiofoniczne-tresci/87-5-108-mhz%2C2%2C50.html";
const UKE_XLSX_URL =
  "https://bip.uke.gov.pl/download/gfx/bip/pl/defaultaktualnosci/152/2/50/rezerwacje_ukf-fm_2021-10-27.xlsx";

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseDmsCoordinate(value, axis) {
  const normalized = normalizeText(value);
  const match =
    axis === "lon"
      ? normalized.match(/^(\d{1,3})([EW])(\d{2})'(\d{2})"$/)
      : normalized.match(/^(\d{1,2})([NS])(\d{2})'(\d{2})"$/);
  if (!match) {
    return NaN;
  }

  const degrees = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[3], 10);
  const seconds = Number.parseInt(match[4], 10);
  const sign =
    match[2] === "W" || match[2] === "S"
      ? -1
      : 1;

  return sign * (degrees + minutes / 60 + seconds / 3600);
}

function buildDescription(row) {
  const parts = [
    `Polish FM assignment listed by UKE for ${normalizeText(row["Lokalizacja stacji"])}.`,
    row.Program ? `Program: ${normalizeText(row.Program)}.` : "",
    row["Województwo"] ? `Voivodeship: ${normalizeText(row["Województwo"])}.` : "",
    row["Nr Koncesji"] ? `Concession: ${normalizeText(row["Nr Koncesji"])}.` : "",
    Number.isFinite(row["ERP[kW]"])
      ? `ERP: ${Number(row["ERP[kW]"]).toFixed(3).replace(/\.?0+$/, "")} kW.`
      : "",
  ];

  return parts.filter(Boolean).join(" ");
}

export async function loadUkePlStations() {
  const res = await fetch(UKE_XLSX_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download UKE FM workbook: HTTP ${res.status}`);
  }

  const workbook = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
  const sheet = workbook.Sheets["UKF FM - aktualne rezerwacje"] ??
    workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const row of rows) {
    const stationName = normalizeText(row["Program"]);
    const cityName = normalizeText(row["Lokalizacja stacji"]);
    const freqMhz = normalizeFreqMhz(String(row["F [MHz]"] || "").replace(",", "."));
    const latitude = parseDmsCoordinate(row["Sz.geogr."], "lat");
    const longitude = parseDmsCoordinate(row["Dł.geogr."], "lon");

    if (!stationName || !cityName || !Number.isFinite(freqMhz)) {
      continue;
    }

    const voivodeship = normalizeText(row["Województwo"]);
    const dedupeKey = `${cityName}|${stationName}|${freqMhz.toFixed(3)}`;

    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      cityName,
      countryCode: "PL",
      curated: false,
      description: buildDescription(row),
      freqMhz,
      latitude,
      longitude,
      name: stationName,
      source: "UKE FM reservations workbook",
      sourceUrl: UKE_PAGE_URL,
      tags: [
        "fm",
        "official",
        "uke",
        "poland",
        voivodeship ? toTag(voivodeship) : "poland",
      ],
      timezone: "Europe/Warsaw",
      verifiedAt,
    });
  }

  return [...dedupe.values()];
}
