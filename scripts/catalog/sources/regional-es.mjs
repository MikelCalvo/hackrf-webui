import XLSX from "xlsx";

import { compareText, normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const USER_AGENT = "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)";
const LATIN1_DECODER = new TextDecoder("latin1");

const SOURCES = {
  andalusiaMunicipal:
    "https://www.juntadeandalucia.es/datosabiertos/portal/dataset/32f9d19e-86a9-45d0-8a91-1b3a4e7e447a/resource/f0856ba5-a364-4ae0-8a13-fa171ceb6c59/download/20210628_fm_municipales_web.xls",
  andalusiaPrivate:
    "https://www.juntadeandalucia.es/datosabiertos/portal/dataset/db069ed9-7d73-4cdc-8981-1badc6d5911c/resource/cbfbde8f-9400-4546-bb3a-eab280fd093e/download/20240318_fm-comerciales_web_0.xls",
  cataloniaPublic:
    "https://analisi.transparenciacatalunya.cat/api/views/pf4t-gv87/rows.csv?accessType=DOWNLOAD",
  castileLeonMunicipal:
    "https://datosabiertos.jcyl.es/web/jcyl/risp/es/ciencia-tecnologia/emisoras-municipales-fm/1284843873946.csv",
  castileLeonPrivate:
    "https://datosabiertos.jcyl.es/web/jcyl/risp/es/ciencia-tecnologia/emisoras-fm-titularidad-privada/1284843864772.csv",
  extremadura:
    "https://www.juntaex.es/documents/77055/5801338/Emisoras_y_TDTL.xls",
  rtveRne:
    "https://www.rtve.es/radio/frecuencias-rne/",
};

const CATALONIA_NETWORKS = [
  ["CAT. RADIO", "Catalunya Radio"],
  ["CAT. INFO.", "Catalunya Informacio"],
  ["CAT. MÚSICA", "Catalunya Musica"],
  ["ICAT", "iCat"],
];

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function titleCase(value) {
  const lower = normalizeText(value).toLocaleLowerCase("es");
  if (!lower) {
    return "";
  }

  return lower
    .split(/(\s+|-|\/|')/u)
    .map((part) => {
      if (!part || /^(\s+|-|\/|')$/u.test(part)) {
        return part;
      }
      return `${part[0].toLocaleUpperCase("es")}${part.slice(1)}`;
    })
    .join("");
}

function normalizeSpanishLocationName(value) {
  const text = normalizeText(value);
  const reordered = text.replace(
    /^(.+?),\s*(EL|LA|LOS|LAS|DEL|DE LA|DE LOS|DE LAS)$/iu,
    "$2 $1",
  );
  return titleCase(reordered);
}

function decodeLatin1(buffer) {
  return LATIN1_DECODER.decode(buffer);
}

async function fetchBuffer(url, signal) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function parseFrequency(value) {
  const match = normalizeText(value).match(/\d{1,3}(?:[.,]\d+)?/u);
  if (!match) {
    return NaN;
  }

  return normalizeFreqMhz(match[0].replace(",", "."));
}

function parseSemicolonLine(line) {
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

    if (char === ";" && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells.map((cell) => normalizeText(cell));
}

function sortStations(stations) {
  return stations.sort((left, right) => {
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

function dedupeStations(stations) {
  const dedupe = new Map();

  for (const station of stations) {
    const key = [
      station.cityName.toUpperCase(),
      station.name.toUpperCase(),
      station.freqMhz.toFixed(3),
      station.source,
    ].join("|");
    if (!dedupe.has(key)) {
      dedupe.set(key, station);
    }
  }

  return sortStations([...dedupe.values()]);
}

function buildDescription(parts) {
  return parts.filter(Boolean).join(" ");
}

function buildBaseStation({
  cityName,
  description,
  freqMhz,
  latitude,
  longitude,
  name,
  source,
  sourceUrl,
  tags,
  verifiedAt,
}) {
  return {
    cityName,
    countryCode: "ES",
    curated: false,
    description,
    freqMhz,
    latitude,
    longitude,
    name,
    source,
    sourceUrl,
    tags,
    timezone: "Europe/Madrid",
    verifiedAt,
  };
}

function parseAndalusiaWorkbook(buffer, sheetName, sourceUrl, mode, verifiedAt) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[sheetName || workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const stations = [];
  let currentProvince = "";

  for (const row of rows.slice(1)) {
    const province = titleCase(row[0] || currentProvince);
    const cityName = titleCase(row[1]);
    const freqMhz = parseFrequency(row[2]);
    currentProvince = province || currentProvince;

    if (!cityName || !Number.isFinite(freqMhz)) {
      continue;
    }

    if (mode === "municipal") {
      stations.push(
        buildBaseStation({
          cityName,
          description: buildDescription([
            `Spanish municipal FM assignment listed by Junta de Andalucia for ${cityName}, ${currentProvince}.`,
            "Licensee: local municipality.",
          ]),
          freqMhz,
          name: `Radio Municipal ${cityName}`,
          source: "Junta de Andalucia municipal FM workbook",
          sourceUrl,
          tags: ["fm", "official", "spain", "andalusia", "municipal", toTag(cityName)],
          verifiedAt,
        }),
      );
      continue;
    }

    const licensee = normalizeText(row[3]);
    stations.push(
      buildBaseStation({
        cityName,
        description: buildDescription([
          `Spanish private FM assignment listed by Junta de Andalucia for ${cityName}, ${currentProvince}.`,
          licensee ? `Licensee: ${licensee}.` : "",
        ]),
        freqMhz,
        name: licensee || `FM ${cityName}`,
        source: "Junta de Andalucia private FM workbook",
        sourceUrl,
        tags: ["fm", "official", "spain", "andalusia", "private", toTag(cityName)],
        verifiedAt,
      }),
    );
  }

  return stations;
}

function parseExtremaduraWorkbook(buffer, sourceUrl, verifiedAt) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const stations = [];

  for (const row of rows.slice(1)) {
    const serviceType = normalizeText(row[4]).toUpperCase();
    if (!serviceType.startsWith("RADIOFONICO")) {
      continue;
    }

    const cityName = titleCase(row[1]);
    const freqMhz = parseFrequency(row[5]);
    const province = titleCase(row[3]);
    const licensee = normalizeText(row[6]);

    if (!cityName || !Number.isFinite(freqMhz)) {
      continue;
    }

    stations.push(
      buildBaseStation({
        cityName,
        description: buildDescription([
          `Spanish FM assignment listed by Junta de Extremadura for ${cityName}, ${province}.`,
          serviceType ? `Service type: ${serviceType}.` : "",
          licensee ? `Licensee: ${licensee}.` : "",
        ]),
        freqMhz,
        name: licensee || `FM ${cityName}`,
        source: "Junta de Extremadura FM workbook",
        sourceUrl,
        tags: [
          "fm",
          "official",
          "spain",
          "extremadura",
          serviceType.includes("MUNICIPAL") ? "municipal" : "commercial",
          toTag(cityName),
        ],
        verifiedAt,
      }),
    );
  }

  return stations;
}

function parseCastileLeonCsv(text, sourceUrl, mode, verifiedAt) {
  const lines = String(text ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const stations = [];
  let startIndex = 0;

  while (startIndex < lines.length && !lines[startIndex].includes("PROVINCIA;")) {
    startIndex += 1;
  }

  for (const line of lines.slice(startIndex + 1)) {
    const row = parseSemicolonLine(line);
    const province = titleCase(row[0]);
    const cityName = titleCase(row[1]);
    const freqMhz = parseFrequency(row[2]);

    if (!cityName || !Number.isFinite(freqMhz)) {
      continue;
    }

    if (mode === "municipal") {
      stations.push(
        buildBaseStation({
          cityName,
          description: buildDescription([
            `Spanish municipal FM assignment listed by Junta de Castilla y Leon for ${cityName}, ${province}.`,
            "Licensee: local municipality.",
          ]),
          freqMhz,
          name: `Radio Municipal ${cityName}`,
          source: "Junta de Castilla y Leon municipal FM CSV",
          sourceUrl,
          tags: [
            "fm",
            "official",
            "spain",
            "castile-leon",
            "municipal",
            toTag(cityName),
          ],
          verifiedAt,
        }),
      );
      continue;
    }

    const licensee = normalizeText(row[3]);
    stations.push(
      buildBaseStation({
        cityName,
        description: buildDescription([
          `Spanish private FM assignment listed by Junta de Castilla y Leon for ${cityName}, ${province}.`,
          licensee ? `Licensee: ${licensee}.` : "",
        ]),
        freqMhz,
        name: licensee || `FM ${cityName}`,
        source: "Junta de Castilla y Leon private FM CSV",
        sourceUrl,
        tags: [
          "fm",
          "official",
          "spain",
          "castile-leon",
          "private",
          toTag(cityName),
        ],
        verifiedAt,
      }),
    );
  }

  return stations;
}

function parseCataloniaCsv(text, sourceUrl, verifiedAt) {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const header = lines[0]?.split(",").map((cell) => normalizeText(cell)) ?? [];
  const headerIndex = new Map(header.map((name, index) => [name, index]));
  const stations = [];

  for (const line of lines.slice(1)) {
    const row = line.split(",").map((cell) => normalizeText(cell));
    const siteName = titleCase(row[headerIndex.get("CENTRE EMISSOR")] || "");
    const latitude = Number(row[headerIndex.get("LATITUD")] || "");
    const longitude = Number(row[headerIndex.get("LONGITUD")] || "");

    for (const [columnName, stationName] of CATALONIA_NETWORKS) {
      const freqMhz = parseFrequency(row[headerIndex.get(columnName)]);
      if (!siteName || !Number.isFinite(freqMhz)) {
        continue;
      }

      stations.push(
        buildBaseStation({
          cityName: siteName,
          description: buildDescription([
            `Catalan public-radio transmitter centre listed by Generalitat de Catalunya for ${siteName}.`,
            `Service: ${stationName}.`,
          ]),
          freqMhz,
          latitude: Number.isFinite(latitude) ? latitude : undefined,
          longitude: Number.isFinite(longitude) ? longitude : undefined,
          name: stationName,
          source: "Generalitat de Catalunya public radio transmitter CSV",
          sourceUrl,
          tags: [
            "fm",
            "official",
            "spain",
            "catalonia",
            "public-network",
            toTag(stationName),
          ],
          verifiedAt,
        }),
      );
    }
  }

  return stations;
}

function decodeHtmlEntities(text) {
  return String(text ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&uuml;/g, "ü")
    .replace(/&Aacute;/g, "Á")
    .replace(/&Eacute;/g, "É")
    .replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó")
    .replace(/&Uacute;/g, "Ú")
    .replace(/&Ntilde;/g, "Ñ")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&amp;/g, "&");
}

function parseRtveRnePage(html, sourceUrl, verifiedAt) {
  const lines = decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style[\s\S]*?<\/style>/gi, "\n")
      .replace(/<[^>]+>/g, "\n"),
  )
    .split(/\r?\n/u)
    .map((line) => normalizeText(line))
    .filter(Boolean);

  const programNames = new Map([
    ["Radio Nacional", "RNE"],
    ["Radio Clásica", "Radio Clásica"],
    ["Radio 3", "Radio 3"],
    ["Ràdio 4", "Ràdio 4"],
    ["Radio 5", "Radio 5"],
  ]);
  const stations = [];
  let currentProvince = "";
  let currentProgram = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] ?? "";

    if (programNames.has(line)) {
      currentProgram = programNames.get(line) ?? "";
      currentProvince = "";
      continue;
    }

    if (/^Elige la provincia en que estás y$/iu.test(line)) {
      continue;
    }

    if (/^[A-ZÁÉÍÓÚÑÜ0-9'().,\-/ ]{3,}$/u.test(line) && !/MHz/i.test(line)) {
      if (/^[A-ZÁÉÍÓÚÑÜ0-9'().,\-/ ]{3,}$/u.test(next) && !/MHz/i.test(next)) {
        currentProvince = normalizeSpanishLocationName(line);
        continue;
      }
    }

    if (!/^\d{1,3}(?:[.,]\d+)?\s*MHz$/iu.test(next)) {
      continue;
    }

    if (!currentProgram) {
      continue;
    }

    const cityName = normalizeSpanishLocationName(line);
    const freqMhz = parseFrequency(next);
    if (!cityName || !Number.isFinite(freqMhz)) {
      continue;
    }

    stations.push(
      buildBaseStation({
        cityName,
        description: buildDescription([
          `Spanish public FM assignment listed by RTVE for ${cityName}${currentProvince ? `, ${currentProvince}` : ""}.`,
          `Service: ${currentProgram}.`,
        ]),
        freqMhz,
        name: currentProgram,
        source: "RTVE RNE frequency map",
        sourceUrl,
        tags: [
          "fm",
          "official",
          "spain",
          "rtve",
          "rne",
          toTag(currentProgram),
          toTag(cityName),
        ],
        verifiedAt,
      }),
    );
    index += 1;
  }

  return stations;
}

async function loadSource(label, loader) {
  try {
    return await loader();
  } catch (error) {
    console.warn(`[regional-es] ${label} failed: ${error.message}`);
    return [];
  }
}

export async function loadRegionalEsStations({ signal } = {}) {
  const verifiedAt = new Date().toISOString().slice(0, 10);

  const [
    andalusiaPrivate,
    andalusiaMunicipal,
    extremadura,
    castileLeonPrivate,
    castileLeonMunicipal,
    catalonia,
    rtveRne,
  ] = await Promise.all([
    loadSource("andalusia private", async () =>
      parseAndalusiaWorkbook(
        await fetchBuffer(SOURCES.andalusiaPrivate, signal),
        "PRIVADOS_FM",
        SOURCES.andalusiaPrivate,
        "private",
        verifiedAt,
      ),
    ),
    loadSource("andalusia municipal", async () =>
      parseAndalusiaWorkbook(
        await fetchBuffer(SOURCES.andalusiaMunicipal, signal),
        "LISTADO MUNICIPALES FM",
        SOURCES.andalusiaMunicipal,
        "municipal",
        verifiedAt,
      ),
    ),
    loadSource("extremadura", async () =>
      parseExtremaduraWorkbook(
        await fetchBuffer(SOURCES.extremadura, signal),
        SOURCES.extremadura,
        verifiedAt,
      ),
    ),
    loadSource("castile leon private", async () =>
      parseCastileLeonCsv(
        decodeLatin1(await fetchBuffer(SOURCES.castileLeonPrivate, signal)),
        SOURCES.castileLeonPrivate,
        "private",
        verifiedAt,
      ),
    ),
    loadSource("castile leon municipal", async () =>
      parseCastileLeonCsv(
        decodeLatin1(await fetchBuffer(SOURCES.castileLeonMunicipal, signal)),
        SOURCES.castileLeonMunicipal,
        "municipal",
        verifiedAt,
      ),
    ),
    loadSource("catalonia public", async () =>
      parseCataloniaCsv(
        Buffer.from(await fetchBuffer(SOURCES.cataloniaPublic, signal)).toString("utf8"),
        SOURCES.cataloniaPublic,
        verifiedAt,
      ),
    ),
    loadSource("rtve rne", async () =>
      parseRtveRnePage(
        decodeLatin1(await fetchBuffer(SOURCES.rtveRne, signal)),
        SOURCES.rtveRne,
        verifiedAt,
      ),
    ),
  ]);

  const stations = dedupeStations([
    ...andalusiaPrivate,
    ...andalusiaMunicipal,
    ...extremadura,
    ...castileLeonPrivate,
    ...castileLeonMunicipal,
    ...catalonia,
    ...rtveRne,
  ]);

  if (!stations.length) {
    throw new Error("All Spain regional FM sources failed");
  }

  return stations;
}
