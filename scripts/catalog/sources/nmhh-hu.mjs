import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const NMHH_SOURCES = [
  {
    key: "local",
    label: "local FM",
    url: "https://nmhh.hu/cikk/183544/URHFM_radioallomasok__helyi",
  },
  {
    key: "regional",
    label: "regional FM",
    url: "https://nmhh.hu/cikk/185577/URHFM_radioallomasok__korzeti",
  },
  {
    key: "community",
    label: "small-community FM",
    url: "https://nmhh.hu/cikk/185576/URHFM_radioallomasok__kiskozossegi",
  },
  {
    key: "public",
    label: "public-service FM",
    url: "https://nmhh.hu/cikk/185578/URHFM_radioallomasok__orszagos_kozszolgalati_halozatok",
  },
  {
    key: "commercial",
    label: "national commercial FM",
    url: "https://nmhh.hu/cikk/196119/URHFM_radioallomasok__orszagos_kereskedelmi_halozat",
  },
];

function normalizeText(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value) {
  return normalizeText(
    String(value ?? "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function extractTables(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((match) => match[0]);
}

function parseHtmlTable(tableHtml) {
  const captionMatch = tableHtml.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
  const caption = stripHtml(captionMatch?.[1] ?? "");
  const rowHtmls = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const rows = rowHtmls.map((rowHtml) =>
    [...rowHtml.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((match) =>
      stripHtml(match[1]),
    ),
  );
  return { caption, rows: rows.filter((row) => row.length > 0) };
}

function parseFreq(value) {
  const normalized = normalizeText(value).replace(",", ".");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? normalizeFreqMhz(numeric) : NaN;
}

function normalizeStationName(value) {
  return normalizeText(value).replace(/^\d{2,3}(?:,\d+)?\s+/u, "");
}

function captionToStationName(caption) {
  return normalizeText(
    caption.replace(/^URH-FM rádióállomások\s*[-–]\s*országos kereskedelmi hálózat\s*[-–]\s*/iu, ""),
  );
}

function buildDescription({ cityName, piCode, polarity, stationName, sourceLabel }) {
  return [
    `Hungarian ${sourceLabel} listed by NMHH for ${cityName}.`,
    `Station: ${stationName}.`,
    polarity ? `Polarization: ${polarity}.` : "",
    piCode ? `RDS PI: ${piCode}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function loadNmhhHuStations() {
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const source of NMHH_SOURCES) {
    const res = await fetch(source.url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to download NMHH page ${source.key}: HTTP ${res.status}`);
    }

    const html = await res.text();
    for (const tableHtml of extractTables(html)) {
      const table = parseHtmlTable(tableHtml);
      const [headerRow, ...dataRows] = table.rows;
      if (!headerRow?.length) {
        continue;
      }

      const headerIndex = Object.fromEntries(
        headerRow.map((header, index) => [normalizeText(header), index]),
      );
      const cityIndex = headerIndex["Telephely"];
      const freqIndex = headerIndex["Fv. (MHz)"] ?? headerIndex["Frekvencia (MHz)"];
      const polarityIndex = headerIndex["Polarizáció"];
      const piIndex = headerIndex["PI-kód"];
      const stationIndex = headerIndex["Műsor neve"] ?? headerIndex["Program neve"];

      if (cityIndex == null || freqIndex == null) {
        continue;
      }

      for (const row of dataRows) {
        const cityName = normalizeText(row[cityIndex]);
        const freqMhz = parseFreq(row[freqIndex]);
        const stationName = stationIndex != null
          ? normalizeStationName(row[stationIndex])
          : captionToStationName(table.caption);
        const polarity = polarityIndex != null ? normalizeText(row[polarityIndex]) : "";
        const piCode = piIndex != null ? normalizeText(row[piIndex]) : "";

        if (!cityName || !stationName || !Number.isFinite(freqMhz)) {
          continue;
        }

        const dedupeKey = `${cityName}|${stationName}|${freqMhz.toFixed(3)}`;
        if (dedupe.has(dedupeKey)) {
          continue;
        }

        dedupe.set(dedupeKey, {
          cityName,
          countryCode: "HU",
          curated: false,
          description: buildDescription({
            cityName,
            piCode,
            polarity,
            sourceLabel: source.label,
            stationName,
          }),
          freqMhz,
          name: stationName,
          source: `NMHH ${source.label} table`,
          sourceUrl: source.url,
          tags: [
            "fm",
            "official",
            "hungary",
            "nmhh",
            toTag(source.key),
            toTag(stationName),
          ],
          timezone: "Europe/Budapest",
          verifiedAt,
        });
      }
    }
  }

  return [...dedupe.values()];
}
