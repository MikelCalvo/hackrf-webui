import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const RTUK_SEARCH_PAGE_URL = "https://yayinci.rtuk.gov.tr/izintahsisv2/web_giris_karasal.php";
const RTUK_RESULT_URL = "https://yayinci.rtuk.gov.tr/izintahsisv2/web_giris_sonuc.php";

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value) {
  return decodeHtmlEntities(String(value ?? "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitleOrText(cellHtml) {
  const titleMatch = String(cellHtml ?? "").match(/title="([^"]+)"/);
  if (titleMatch) {
    return decodeHtmlEntities(titleMatch[1]).trim();
  }
  return stripTags(cellHtml);
}

function extractProvinceOptions(html) {
  return [...html.matchAll(/<option value="(\d+)">([^<]+)<\/option>/g)]
    .map((match) => ({
      id: match[1],
      name: normalizeText(match[2]),
    }))
    .filter((option) => option.id !== "0");
}

function extractRows(html) {
  return [...String(html).matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((match) => match[1]);
}

function extractCells(rowHtml) {
  return [...String(rowHtml).matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((match) => ({
    attrs: match[1] || "",
    html: match[2] || "",
    text: stripTags(match[2] || ""),
  }));
}

function parseProvinceResults(html, province) {
  const rows = extractRows(html).slice(1);
  const stations = [];

  for (let index = 0; index < rows.length; index += 2) {
    const primaryCells = extractCells(rows[index]);
    if (primaryCells.length < 8) {
      continue;
    }

    const detailCells = rows[index + 1] ? extractCells(rows[index + 1]) : [];
    const band = normalizeText(primaryCells[4]?.text);
    const callsign = extractTitleOrText(primaryCells[3]?.html);
    const district = normalizeText(primaryCells[6]?.text);
    const licenseType = normalizeText(primaryCells[2]?.text);
    const operator = extractTitleOrText(primaryCells[1]?.html);
    const rebroadcast = extractTitleOrText(primaryCells[7]?.html);
    const frequencyText = normalizeText(primaryCells[5]?.text);
    const addressText = detailCells[0]
      ? normalizeText(
          stripTags(detailCells[0].html)
            .replace(/^Adres:\s*/i, ""),
        )
      : "";

    const freqMhz = normalizeFreqMhz(frequencyText);
    if (band !== "FM" || !callsign || !Number.isFinite(freqMhz)) {
      continue;
    }

    const cityName =
      district && district.toLocaleLowerCase("tr") !== "merkez"
        ? district
        : province.name;

    stations.push({
      admin1Code: province.id,
      cityName,
      countryCode: "TR",
      curated: false,
      description: [
        `Turkish FM terrestrial assignment listed by RTUK for ${cityName}, ${province.name}.`,
        operator ? `Operator: ${operator}.` : "",
        licenseType ? `License class: ${licenseType}.` : "",
        addressText ? `Address: ${addressText}.` : "",
        rebroadcast ? `Rebroadcast: ${rebroadcast}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      freqMhz,
      name: callsign,
      source: "RTUK terrestrial radio portal",
      sourceUrl: RTUK_SEARCH_PAGE_URL,
      tags: [
        "fm",
        "official",
        "rtuk",
        "turkey",
        toTag(province.name),
        licenseType ? toTag(licenseType) : "radio",
      ],
      timezone: "Europe/Istanbul",
      verifiedAt: new Date().toISOString().slice(0, 10),
    });
  }

  return stations;
}

async function fetchProvinceResults(province) {
  const body = new URLSearchParams({
    YayinTuru: "Karasal",
    VericiTipi: "RADYO",
    LisansTuru: "",
    SehirId: province.id,
    IlceId: "0",
  }).toString();

  const res = await fetch(RTUK_RESULT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch RTUK province ${province.id}: HTTP ${res.status}`);
  }

  return parseProvinceResults(await res.text(), province);
}

export async function loadRtukTrStations() {
  const pageRes = await fetch(RTUK_SEARCH_PAGE_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!pageRes.ok) {
    throw new Error(`Failed to download RTUK search page: HTTP ${pageRes.status}`);
  }

  const provinces = extractProvinceOptions(await pageRes.text());
  const dedupe = new Map();
  const concurrency = 6;

  for (let index = 0; index < provinces.length; index += concurrency) {
    const batch = provinces.slice(index, index + concurrency);
    const batchResults = await Promise.all(batch.map((province) => fetchProvinceResults(province)));

    for (const stations of batchResults) {
      for (const station of stations) {
        const dedupeKey = [
          station.admin1Code,
          station.cityName,
          station.name,
          station.freqMhz.toFixed(3),
        ].join("|");

        if (!dedupe.has(dedupeKey)) {
          dedupe.set(dedupeKey, station);
        }
      }
    }
  }

  return [...dedupe.values()];
}
