import { toTag } from "../lib/utils.mjs";

const ANATEL_DATA_URL =
  "https://s3.mcom.gov.br/radcom/SCR_DADOS_RADIODIFUSAO_TV_GTVD_RTV_RTVD_FM_OM.csv";
const LATIN1_DECODER = new TextDecoder("iso-8859-1");

function normalizeText(value) {
  return String(value ?? "").trim();
}

function parseLocaleNumber(value) {
  let raw = normalizeText(value);
  if (!raw) {
    return NaN;
  }

  if (raw.includes(",") && raw.includes(".")) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if (raw.includes(",")) {
    raw = raw.replace(",", ".");
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function sanitizeCoordinate(value) {
  return Number.isFinite(value) && Math.abs(value) > 0.0001 ? value : undefined;
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ";" && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function parseCsv(text) {
  const normalized = text.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = splitCsvLine(lines.shift());
  const rows = lines.map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });

  return { headers, rows };
}

function pickFirstRowValue(row, keys) {
  for (const key of keys) {
    const value = normalizeText(row[key]);
    if (value) {
      return value;
    }
  }

  return "";
}

function buildDescription(row, cityName, stateCode, callsign, licensee) {
  const parts = [
    `FM service listed by the Brazilian federal radiodiffusion registry for ${cityName}${
      stateCode ? `, ${stateCode}` : ""
    }.`,
    licensee ? `Licensee: ${licensee}.` : "",
    callsign ? `Callsign: ${callsign}.` : "",
  ];

  return parts.filter(Boolean).join(" ");
}

async function downloadCsv() {
  const res = await fetch(ANATEL_DATA_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download ANATEL radiodiffusion CSV: HTTP ${res.status}`);
  }

  return LATIN1_DECODER.decode(await res.arrayBuffer());
}

export async function loadAnatelBrStations() {
  const text = await downloadCsv();
  const { rows } = parseCsv(text);
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const row of rows) {
    const service = normalizeText(row.SiglaServico || row.srd_planobasico_SiglaServico);
    if (service !== "FM") {
      continue;
    }

    const status = normalizeText(row.sitarwebStatus);
    if (status !== "L") {
      continue;
    }

    const cityName = pickFirstRowValue(row, [
      "licenca_srd_planobasico_NomeMunicipio",
      "NomeMunicipio",
      "srd_planobasico_NomeMunicipio",
      "licenca_endereco_estacaoprincipal_NomeMunicipio",
    ]);
    const stateCode = pickFirstRowValue(row, [
      "licenca_srd_planobasico_SiglaUF",
      "SiglaUF",
      "srd_planobasico_SiglaUF",
      "municipio_SiglaUF",
    ]).toUpperCase();
    const callsign = pickFirstRowValue(row, [
      "licenca_estacao_NomeIndicativo",
      "licenca_estacao_NumEstacao",
      "IdtEstacao",
    ]);
    const licensee = pickFirstRowValue(row, [
      "licenca_entidade_NomeEntidade",
      "licensee",
      "NomeInteressada",
    ]);

    let freqMhz = parseLocaleNumber(
      pickFirstRowValue(row, ["licenca_frequency", "frequency", "srd_planobasico_MedFrequencia"]),
    );
    if (!Number.isFinite(freqMhz)) {
      continue;
    }

    if (freqMhz < 64 || freqMhz > 108.5) {
      continue;
    }
    if (!cityName || !stateCode) {
      continue;
    }

    const latitude = sanitizeCoordinate(parseLocaleNumber(
      pickFirstRowValue(row, [
        "licenca_loctx_coordinates_1",
        "locpb_coordinates_1",
        "licenca_srd_planobasico_MedLatitudeDecimal",
        "srd_planobasico_MedLatitudeDecimal",
      ]),
    ));
    const longitude = sanitizeCoordinate(parseLocaleNumber(
      pickFirstRowValue(row, [
        "licenca_loctx_coordinates_0",
        "locpb_coordinates_0",
        "licenca_srd_planobasico_MedLongitudeDecimal",
        "srd_planobasico_MedLongitudeDecimal",
      ]),
    ));

    const uniqueKey = [
      stateCode,
      cityName.toLowerCase(),
      callsign.toLowerCase(),
      licensee.toLowerCase(),
      freqMhz.toFixed(3),
    ].join("|");
    if (dedupe.has(uniqueKey)) {
      continue;
    }

    dedupe.set(uniqueKey, {
      admin1Code: stateCode,
      cityName,
      countryCode: "BR",
      curated: false,
      description: buildDescription(row, cityName, stateCode, callsign, licensee),
      freqMhz,
      latitude,
      longitude,
      name: callsign || licensee || `FM ${freqMhz.toFixed(1)}`,
      source: "Brazilian federal radiodiffusion CSV",
      sourceUrl: ANATEL_DATA_URL,
      tags: ["fm", "official", "brazil", toTag(stateCode)],
      verifiedAt,
    });
  }

  return [...dedupe.values()];
}
