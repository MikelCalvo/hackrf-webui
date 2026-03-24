import AdmZip from "adm-zip";
import XLSX from "xlsx";

import { toTag } from "../lib/utils.mjs";

const ACMA_PAGE_URL = "https://www.acma.gov.au/list-transmitters-licence-broadcast";
const ACMA_XLSX_URL = "https://www.acma.gov.au/sites/default/files/2026-02/BroadcastTransmitterExcel.zip";

function coerceFrequency(value) {
  if (typeof value === "number") {
    return value;
  }

  const parsed = Number.parseFloat(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : NaN;
}

export async function loadAcmaAuStations() {
  const res = await fetch(ACMA_XLSX_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download ACMA dataset: HTTP ${res.status}`);
  }

  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const xlsxEntry = zip.getEntries().find((entry) =>
    entry.entryName.endsWith(".xlsx"),
  );

  if (!xlsxEntry) {
    throw new Error("ACMA archive does not contain an xlsx workbook");
  }

  const workbook = XLSX.read(zip.readFile(xlsxEntry), { type: "buffer" });
  const sheet = workbook.Sheets.FM;
  if (!sheet) {
    throw new Error("ACMA workbook does not contain an FM sheet");
  }

  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: null,
    raw: true,
  });

  const dedupe = new Map();
  for (const row of rows) {
    const status = String(row.Status || "").trim();
    const cityName = String(row["Area Served"] || "").trim();
    const callsign = String(row.Callsign || "").trim();
    const freqMhz = coerceFrequency(row["Frequency(MHz)"]);

    if (status !== "Issued" || !cityName || !callsign || !Number.isFinite(freqMhz)) {
      continue;
    }

    const key = `${cityName}|${callsign}|${freqMhz.toFixed(1)}`;
    if (!dedupe.has(key)) {
      dedupe.set(key, row);
    }
  }

  const verifiedAt = new Date().toISOString().slice(0, 10);

  return [...dedupe.values()].map((row) => {
    const cityName = String(row["Area Served"]).trim();
    const callsign = String(row.Callsign).trim();
    const purpose = String(row.Purpose || "Broadcast").trim();
    const state = String(row.State || "").trim();
    const siteName = String(row["Site Name"] || "").trim();
    const freqMhz = coerceFrequency(row["Frequency(MHz)"]);

    const description = [
      `${purpose} FM service licensed by ACMA for ${cityName}${state ? `, ${state}` : ""}.`,
      siteName ? `Primary site: ${siteName}.` : "",
      `Callsign: ${callsign}.`,
    ]
      .filter(Boolean)
      .join(" ");

    return {
      cityName,
      countryCode: "AU",
      curated: false,
      description,
      freqMhz,
      name: callsign,
      source: "ACMA Broadcast Transmitter Excel",
      sourceUrl: ACMA_PAGE_URL,
      tags: ["fm", toTag(purpose), "official"],
      verifiedAt,
    };
  });
}
