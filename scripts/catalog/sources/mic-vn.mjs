import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const execFileAsync = promisify(execFile);

const MIC_VN_PAGE_URL =
  "https://congbao.chinhphu.vn/van-ban/thong-tu-so-37-2017-tt-btttt-25303/20229.htm";
const MIC_VN_PDF_URL =
  "https://congbao.cdnchinhphu.vn/CongBaoCP/VanBan/2017/12/25303/20229-1-20171043-104437-2017-tt-btttt.pdf";

const PROVINCE_CAPITALS = {
  "An Giang": "Long Xuyên",
  "Bà Rịa - Vũng Tàu": "Bà Rịa",
  "Bạc Liêu": "Bạc Liêu",
  "Bắc Giang": "Bắc Giang",
  "Bắc Kạn": "Bắc Kạn",
  "Bắc Ninh": "Bắc Ninh",
  "Bến Tre": "Bến Tre",
  "Bình Dương": "Thủ Dầu Một",
  "Bình Định": "Quy Nhơn",
  "Bình Phước": "Đồng Xoài",
  "Bình Thuận": "Phan Thiết",
  "Cà Mau": "Cà Mau",
  "Cao Bằng": "Cao Bằng",
  "Cần Thơ": "Cần Thơ",
  "Cao Lãnh": "Cao Lãnh",
  "Đà Nẵng": "Đà Nẵng",
  "Đắk Lắk": "Buôn Ma Thuột",
  "Đắk Nông": "Gia Nghĩa",
  "Điện Biên": "Điện Biên Phủ",
  "Đồng Nai": "Biên Hòa",
  "Đồng Tháp": "Cao Lãnh",
  "Gia Lai": "Pleiku",
  "Hà Giang": "Hà Giang",
  "Hà Nam": "Phủ Lý",
  "Hà Nội": "Hà Nội",
  "Hà Tĩnh": "Hà Tĩnh",
  "Hải Dương": "Hải Dương",
  "Hải Phòng": "Hải Phòng",
  "Hậu Giang": "Vị Thanh",
  "Hòa Bình": "Hòa Bình",
  "Hồ Chí Minh": "Hồ Chí Minh City",
  "Hưng Yên": "Hưng Yên",
  "Khánh Hòa": "Nha Trang",
  "Kiên Giang": "Rạch Giá",
  "Kon Tum": "Kon Tum",
  "Lai Châu": "Lai Châu",
  "Lâm Đồng": "Đà Lạt",
  "Lạng Sơn": "Lạng Sơn",
  "Lào Cai": "Lào Cai",
  "Long An": "Tân An",
  "Nam Định": "Nam Định",
  "Nghệ An": "Vinh",
  "Ninh Bình": "Ninh Bình",
  "Ninh Thuận": "Phan Rang-Tháp Chàm",
  "Phú Thọ": "Việt Trì",
  "Phú Yên": "Tuy Hòa",
  "Quảng Bình": "Đồng Hới",
  "Quảng Nam": "Tam Kỳ",
  "Quảng Ngãi": "Quảng Ngãi",
  "Quảng Ninh": "Hạ Long",
  "Quảng Trị": "Đông Hà",
  "Sóc Trăng": "Sóc Trăng",
  "Sơn La": "Sơn La",
  "Tây Ninh": "Tây Ninh",
  "Thái Bình": "Thái Bình",
  "Thái Nguyên": "Thái Nguyên",
  "Thanh Hóa": "Thanh Hóa",
  "Thừa Thiên Huế": "Huế",
  "Tiền Giang": "Mỹ Tho",
  "TP. Hà Nội": "Hà Nội",
  "TP. Hồ Chí Minh": "Hồ Chí Minh City",
  "Trà Vinh": "Trà Vinh",
  "Tuyên Quang": "Tuyên Quang",
  "Vĩnh Long": "Vĩnh Long",
  "Vĩnh Phúc": "Vĩnh Yên",
  "Yên Bái": "Yên Bái",
};

const LEADING_CONTINUATION_FREQUENCIES = {
  "TP. Hà Nội": [90],
  "TP. Hồ Chí Minh": [99.9],
};

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeProvinceName(value) {
  const normalized = normalizeText(value).replace("ĐắkNông", "Đắk Nông");
  return normalized.replace(/^TP\.\s*/u, (prefix) =>
    prefix.includes("Hồ Chí Minh") ? prefix : "",
  );
}

function canonicalProvinceName(value) {
  const normalized = normalizeText(value).replace("ĐắkNông", "Đắk Nông");
  return normalized.replace(/^TP\.\s*/u, "");
}

function parseFrequency(value) {
  const normalized = normalizeText(value).replace(",", ".");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? normalizeFreqMhz(numeric) : NaN;
}

async function extractPdfText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download Vietnam FM plan PDF: HTTP ${res.status}`);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hackrf-webui-vn-"));
  const pdfPath = path.join(tempDir, "source.pdf");

  try {
    await fs.writeFile(pdfPath, Buffer.from(await res.arrayBuffer()));
    const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"]);
    return stdout;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function parseAppendixThree(text) {
  const startIndex = text.indexOf("PHỤ LỤC III");
  const endIndex = text.indexOf("PHỤ LỤC IV");
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    return [];
  }

  const section = text.slice(startIndex, endIndex);
  const lines = section.split(/\r?\n/);
  const rows = [];
  let currentProvinceName = "";
  let currentPowerKw = NaN;

  for (const rawLine of lines) {
    const line = normalizeText(rawLine.replace(/\f/g, ""));
    if (
      !line ||
      line.includes("CÔNG BÁO/") ||
      line.startsWith("PHỤ LỤC III") ||
      line.startsWith("BẢNG PHÂN BỔ") ||
      line.startsWith("KÊNH CHƯƠNG TRÌNH") ||
      line.startsWith("(Ban hành kèm") ||
      line.startsWith("Tên tỉnh") ||
      line.startsWith("STT") ||
      line.startsWith("Chú thích")
    ) {
      continue;
    }

    const rowMatch = line.match(
      /^(\d+)\s+(.+?)\s+(\d{2,3}(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)$/u,
    );
    if (rowMatch) {
      currentProvinceName = normalizeProvinceName(rowMatch[2]);
      currentPowerKw = Number(rowMatch[4].replace(",", "."));
      rows.push({
        provinceName: currentProvinceName,
        freqMhz: parseFrequency(rowMatch[3]),
        powerKw: Number.isFinite(currentPowerKw) ? currentPowerKw : NaN,
      });
      continue;
    }

    const continuationMatch = line.match(/^(\d{2,3}(?:[.,]\d+)?)$/u);
    if (continuationMatch && currentProvinceName) {
      rows.push({
        provinceName: currentProvinceName,
        freqMhz: parseFrequency(continuationMatch[1]),
        powerKw: Number.isFinite(currentPowerKw) ? currentPowerKw : NaN,
      });
    }
  }

  const filteredRows = rows.filter((row) => row.provinceName && Number.isFinite(row.freqMhz));
  const cleanedRows = filteredRows.filter((row) => {
    if (row.provinceName === "Bắc Ninh" && row.freqMhz === 90) {
      return false;
    }
    if (row.provinceName === "Bà Rịa - Vũng Tàu" && row.freqMhz === 99.9) {
      return false;
    }
    return true;
  });

  for (const [provinceName, frequencies] of Object.entries(LEADING_CONTINUATION_FREQUENCIES)) {
    for (const frequency of frequencies) {
      cleanedRows.push({
        freqMhz: normalizeFreqMhz(frequency),
        powerKw: provinceName === "TP. Hà Nội" ? 20 : 20,
        provinceName,
      });
    }
  }

  return cleanedRows;
}

function buildDescription({ cityName, freqMhz, powerKw, provinceName }) {
  return [
    `Provincial FM assignment listed by Vietnam's Ministry of Information and Communications for ${provinceName}.`,
    `City grouping: ${cityName}.`,
    `Frequency: ${freqMhz.toFixed(1)} MHz.`,
    Number.isFinite(powerKw) ? `Reference power: ${powerKw} kW.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function loadMicVnStations() {
  const text = await extractPdfText(MIC_VN_PDF_URL);
  const rows = parseAppendixThree(text);
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const row of rows) {
    const canonicalProvince = canonicalProvinceName(row.provinceName);
    const cityName = PROVINCE_CAPITALS[row.provinceName] || PROVINCE_CAPITALS[canonicalProvince];
    if (!cityName) {
      continue;
    }

    const stationName = `${cityName} Provincial FM ${row.freqMhz.toFixed(1)}`;
    const dedupeKey = `${cityName}|${stationName}|${row.freqMhz.toFixed(3)}`;
    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      cityName,
      countryCode: "VN",
      curated: false,
      description: buildDescription({
        cityName,
        freqMhz: row.freqMhz,
        powerKw: row.powerKw,
        provinceName: canonicalProvince,
      }),
      freqMhz: row.freqMhz,
      name: stationName,
      source: "Vietnam FM channel allocation plan",
      sourceUrl: MIC_VN_PAGE_URL,
      tags: [
        "fm",
        "official",
        "vietnam",
        "provincial-plan",
        toTag(canonicalProvince),
      ],
      timezone: "Asia/Ho_Chi_Minh",
      verifiedAt,
    });
  }

  return [...dedupe.values()];
}
