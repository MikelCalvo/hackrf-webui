import XLSX from "xlsx";

import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const NCC_DATASET_PAGE_URL = "https://data.gov.tw/en/datasets/6445";
const NCC_XLS_URL =
  "https://api.ncc.gov.tw/uploaddowndoc?file=datagov/1458367347562647552.xls&filedisplay=%E8%A1%A8%E4%BE%8B-1_%E8%AA%BF%E9%A0%BBFM%E5%BB%A3%E6%92%AD%E9%9B%BB%E8%87%BA%E9%A0%BB%E7%8E%87%E3%80%81%E7%99%BC%E5%B0%84%E6%A9%9F%E5%9C%B0%E5%9D%80%E5%8F%8A%E5%BA%A7%E6%A8%99%E8%B3%87%E6%96%99%E8%A1%A8.xls&flag=doc";

const CATEGORY_LABELS = {
  學校: "school",
  甲: "class-a",
  乙: "class-b",
  丙: "class-c",
  其他: "other",
};

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function extractLocality(address) {
  const normalized = normalizeText(address).replace(/^台/u, "臺");
  const match = normalized.match(/^(.{2}[市縣])/u);
  return match ? match[1] : normalized.slice(0, 3);
}

function buildDescription(row, locality, categoryLabel) {
  const parts = [
    `Taiwan FM station listed by NCC for ${locality}.`,
    row[" FM 電臺名稱"] ? `Station: ${normalizeText(row[" FM 電臺名稱"])}.` : "",
    categoryLabel ? `Category: ${categoryLabel}.` : "",
    row["發射機地址"] ? `Transmitter address: ${normalizeText(row["發射機地址"])}.` : "",
  ];

  return parts.filter(Boolean).join(" ");
}

export async function loadNccTwStations() {
  const res = await fetch(NCC_XLS_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download NCC FM dataset: HTTP ${res.status}`);
  }

  const workbook = XLSX.read(Buffer.from(await res.arrayBuffer()), {
    type: "buffer",
    codepage: 950,
  });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
    defval: "",
  });
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const row of rows) {
    const stationName = normalizeText(row[" FM 電臺名稱"]);
    const freqMhz = normalizeFreqMhz(row["頻率\n(MHz)"]);
    const address = normalizeText(row["發射機地址"]);
    const locality = extractLocality(address);
    const latitude = Number(row["北緯"]);
    const longitude = Number(row["東經"]);

    if (!stationName || !Number.isFinite(freqMhz) || !locality) {
      continue;
    }

    const category = normalizeText(row["電臺\n類別"]);
    const categoryLabel = CATEGORY_LABELS[category] || "other";
    const dedupeKey = `${locality}|${stationName}|${freqMhz.toFixed(3)}`;

    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      cityName: locality,
      countryCode: "TW",
      curated: false,
      description: buildDescription(row, locality, categoryLabel),
      freqMhz,
      latitude,
      longitude,
      name: stationName,
      source: "NCC FM transmitter dataset",
      sourceUrl: NCC_DATASET_PAGE_URL,
      tags: ["fm", "official", "ncc", "taiwan", toTag(categoryLabel)],
      timezone: "Asia/Taipei",
      verifiedAt,
    });
  }

  return [...dedupe.values()];
}
