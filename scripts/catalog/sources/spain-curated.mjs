import { compareText } from "../lib/utils.mjs";

const SPAIN_CURATED_STATIONS = [
  {
    cityName: "Madrid",
    name: "Radio Nacional",
    freqMhz: 88.2,
    description:
      "RNE's national public-service station with news, culture, and general-interest programming.",
    tags: ["public", "news", "talk", "culture", "national"],
    source: "RTVE frequency map",
    sourceUrl: "https://www.rtve.es/radio/frecuencias-rne/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Madrid",
    name: "LOS40 Classic Madrid",
    freqMhz: 89,
    description: "Classic hits station from the LOS40 network.",
    tags: ["music", "classic-hits"],
    source: "Official LOS40 station list",
    sourceUrl: "https://los40.com/emisoras/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Madrid",
    name: "Europa FM Madrid",
    freqMhz: 91,
    description: "Contemporary hits and entertainment radio from Atresmedia.",
    tags: ["music", "chr", "hits", "pop", "entertainment"],
    source: "Atresmedia Publicidad 2025 Europa FM local stations PDF",
    sourceUrl:
      "https://www.atresmediapublicidad.com/documents/2024/12/11/6A10BC65-651C-4F39-9B02-41A823941ADA/07emisoras2025.pdf",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Madrid",
    name: "Cadena Dial Madrid",
    freqMhz: 91.7,
    description: "Spanish-language adult pop and mainstream music radio.",
    tags: ["music", "spanish-pop", "adult-contemporary", "national"],
    source: "Cadena Dial official station list",
    sourceUrl: "https://www.cadenadial.com/emisoras",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Madrid",
    name: "LOS40 Madrid",
    freqMhz: 93.9,
    description: "Mainstream chart-pop and hit radio for Madrid.",
    tags: ["music", "chr", "pop", "hits", "national"],
    source: "LOS40 official station list",
    sourceUrl: "https://los40.com/emisoras/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Madrid",
    name: "Onda Cero Madrid",
    freqMhz: 98,
    description:
      "National talk and news radio with Madrid local programming windows.",
    tags: ["talk", "news", "speech", "national", "local"],
    source: "Atresmedia Publicidad 2025 Onda Cero local stations PDF",
    sourceUrl:
      "https://www.atresmediapublicidad.com/documents/2024/12/11/6A10BC65-651C-4F39-9B02-41A823941ADA/07emisoras2025.pdf",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Madrid",
    name: "Melodia FM Madrid",
    freqMhz: 98.4,
    description:
      "Classic pop and soft rock focused on familiar hits from past decades.",
    tags: ["music", "classic-hits", "pop", "soft-rock", "gold"],
    source: "Atresmedia Publicidad 2025 Melodia FM local stations PDF",
    sourceUrl:
      "https://www.atresmediapublicidad.com/documents/2024/12/11/6A10BC65-651C-4F39-9B02-41A823941ADA/07emisoras2025.pdf",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Madrid",
    name: "esRadio Madrid",
    freqMhz: 99.1,
    description:
      "Opinion-led talk radio with news, politics, and current-affairs programming.",
    tags: ["talk", "news", "politics", "speech", "national"],
    source: "esRadio official how-to-listen page",
    sourceUrl: "https://esradio.libertaddigital.com/escuchenos.html",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Madrid",
    name: "KISS FM Madrid",
    freqMhz: 102.7,
    description:
      "Adult contemporary music with a strong 80s, 90s, and today format.",
    tags: ["music", "adult-contemporary", "classic-hits", "pop"],
    source: "KISS FM official station list",
    sourceUrl: "https://www.kissfm.es/emisoras/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Madrid",
    name: "LOS40 Urban Madrid",
    freqMhz: 103.9,
    description:
      "Urban, reggaeton, and hip-hop station from the LOS40 network.",
    tags: ["music", "urban", "hip-hop"],
    source: "LOS40 official station list",
    sourceUrl: "https://los40.com/emisoras/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Madrid",
    name: "SER+ Madrid",
    freqMhz: 104.3,
    description: "Cadena SER local Madrid opt-out with extra city coverage.",
    tags: ["news", "talk", "local"],
    source: "Cadena SER Radio Madrid contact page",
    sourceUrl: "https://cadenaser.com/radio-madrid/contacto/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Madrid",
    name: "Radio Madrid (Cadena SER)",
    freqMhz: 105.4,
    description:
      "Flagship SER station for Madrid with talk, news, and local information.",
    tags: ["talk", "news", "speech", "local", "national"],
    source: "Cadena SER Radio Madrid contact page",
    sourceUrl: "https://cadenaser.com/radio-madrid/contacto/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Madrid",
    name: "COPE Madrid",
    freqMhz: 106.3,
    description:
      "National talk and news radio with sports and Madrid-focused local segments.",
    tags: ["talk", "news", "sports", "speech", "national"],
    source: "COPE official station list",
    sourceUrl: "https://www.cope.es/emisoras",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Barcelona",
    name: "RAC1",
    freqMhz: 87.7,
    description: "Catalan-language news, talk, and sports flagship.",
    tags: ["news", "talk", "sports"],
    source: "Official RAC1 frequencies page",
    sourceUrl: "https://www.rac1.cat/frequencies.html",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Barcelona",
    name: "beteve radio",
    freqMhz: 91,
    description:
      "Barcelona public local radio with news, city service, and culture.",
    tags: ["local", "public", "news", "culture"],
    source: "Official beteve FAQ",
    sourceUrl: "https://beteve.cat/preguntes-frequents/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Barcelona",
    name: "ELS40",
    freqMhz: 93.9,
    description: "Mainstream hit radio and CHR music station.",
    tags: ["pop", "top40", "commercial"],
    source: "Official LOS40 frequencies page",
    sourceUrl: "https://los40.com/emisoras/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Barcelona",
    name: "SER Radio Barcelona",
    freqMhz: 96.9,
    description:
      "Generalist news, talk, and sports station from Cadena SER.",
    tags: ["news", "talk", "sports"],
    source: "Official SER Catalunya frequency page",
    sourceUrl:
      "https://cadenaser.com/emisora/2016/10/20/sercat/1476973407_000492.html",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Barcelona",
    name: "Radio 4",
    freqMhz: 100.8,
    description: "RTVE Catalan-language public talk and culture station.",
    tags: ["public", "talk", "culture"],
    source: "Official RTVE Radio 4 frequencies page",
    sourceUrl: "https://www.rtve.es/radio/20210304/frequeencies-radio-4/289629.shtml",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Barcelona",
    name: "COPE Barcelona",
    freqMhz: 102,
    description: "National talk, news, and sports network.",
    tags: ["news", "talk", "sports"],
    source: "Official COPE stations page",
    sourceUrl: "https://www.cope.es/emisoras",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Barcelona",
    name: "LOS40 Dance Barcelona",
    freqMhz: 104.2,
    description:
      "Dance and electronic music spinoff from the LOS40 network.",
    tags: ["dance", "electronic", "music"],
    source: "Official LOS40 frequencies page",
    sourceUrl: "https://los40.com/emisoras/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Barcelona",
    name: "RAC105",
    freqMhz: 105,
    description: "Catalan commercial music station focused on pop and rock.",
    tags: ["music", "pop", "rock"],
    source: "Official RAC105 frequencies page",
    sourceUrl: "https://www.rac105.cat/frequencies",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Barcelona",
    name: "Flaix FM",
    freqMhz: 105.7,
    description: "Catalan hit music and dance-oriented youth station.",
    tags: ["music", "dance", "pop", "youth"],
    source: "Official Flaix FM frequencies page",
    sourceUrl: "https://flaixfm.cat/frequencies/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Bilbao",
    name: "Radio Nervion",
    freqMhz: 88,
    description:
      "Bilbao local station mixing music, local information, traffic, and audience participation.",
    tags: ["music", "local", "variety"],
    source: "Radio Nervion frequencies page",
    sourceUrl: "https://www.radionervion.com/emisoras/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Bilbao",
    name: "Euskadi Irratia",
    freqMhz: 88.9,
    description: "EITB Basque-language public radio service.",
    tags: ["public", "talk", "basque"],
    source: "EITB frequencies page",
    sourceUrl:
      "https://www.eitb.eus/es/grupo-eitb/donde-encuentro-eitb/en-mi-radio/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Bilbao",
    name: "LOS40 Bilbao",
    freqMhz: 89.5,
    description: "Contemporary hit radio brand from PRISA for Bilbao.",
    tags: ["music", "pop", "hits"],
    source: "LOS40 station directory",
    sourceUrl: "https://los40.com/emisoras/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Bilbao",
    name: "Onda Vasca Bizkaia",
    freqMhz: 90.1,
    description:
      "Basque regional talk and current-affairs station based in Bilbao.",
    tags: ["news", "talk", "regional"],
    source: "Onda Vasca official site",
    sourceUrl: "https://www.ondavasca.com/quienes-somos/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Bilbao",
    name: "Radio Euskadi",
    freqMhz: 91.7,
    description:
      "EITB public-service talk and news station for the Basque Country.",
    tags: ["public", "news", "talk"],
    source: "EITB frequencies page",
    sourceUrl:
      "https://www.eitb.eus/es/grupo-eitb/donde-encuentro-eitb/en-mi-radio/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Bilbao",
    name: "Cadena Dial Bilbao",
    freqMhz: 92.7,
    description:
      "Spanish-language pop and adult contemporary station for Bilbao.",
    tags: ["music", "spanish-pop", "adult-contemporary"],
    source: "Cadena Dial station directory",
    sourceUrl: "https://www.cadenadial.com/emisoras",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Bilbao",
    name: "Radio Bilbao",
    freqMhz: 93.2,
    description:
      "Local Cadena SER news and talk station for Bilbao and Bizkaia.",
    tags: ["news", "talk", "local"],
    source: "Cadena SER / Radio Bilbao",
    sourceUrl:
      "https://cadenaser.com/euskadi/2024/08/19/radio-bilbao-sale-a-la-calle-durante-aste-nagusia-2024-radio-bilbao/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Bilbao",
    name: "Gaztea",
    freqMhz: 94.7,
    description: "EITB youth-focused music station.",
    tags: ["public", "music", "youth", "pop"],
    source: "EITB frequencies page",
    sourceUrl:
      "https://www.eitb.eus/es/grupo-eitb/donde-encuentro-eitb/en-mi-radio/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Bilbao",
    name: "COPE Bilbao",
    freqMhz: 95.1,
    description: "COPE talk and news station for Bilbao.",
    tags: ["news", "talk"],
    source: "Official COPE Bilbao page",
    sourceUrl: "https://www.cope.es/emisoras/pais-vasco/vizcaya/bilbao/contacto",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Bilbao",
    name: "COPE Mas Bilbao",
    freqMhz: 97.8,
    description:
      "Local COPE opt-out service with Bilbao-focused programming.",
    tags: ["news", "talk", "local"],
    source: "Official COPE Bilbao page",
    sourceUrl: "https://www.cope.es/emisoras/pais-vasco/vizcaya/bilbao/contacto",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Bilbao",
    name: "EITB Musika",
    freqMhz: 100.1,
    description: "EITB music radio service for broader music programming.",
    tags: ["public", "music"],
    source: "EITB frequencies page",
    sourceUrl:
      "https://www.eitb.eus/es/grupo-eitb/donde-encuentro-eitb/en-mi-radio/",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Bilbao",
    name: "Radio Popular de Bilbao",
    freqMhz: 100.4,
    description:
      "Bilbao generalist local station with talk, news, sports, and community coverage.",
    tags: ["talk", "news", "local", "community"],
    source: "Radio Popular frequencies page",
    sourceUrl: "https://radiopopular.com/frecuencias",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Bilbao",
    name: "Onda Cero Bilbao",
    freqMhz: 101.5,
    description:
      "National and local talk and news station from Atresmedia Radio.",
    tags: ["news", "talk"],
    source: "Onda Cero official article",
    sourceUrl:
      "https://www.ondacero.es/elecciones/pais-vasco/como-donde-escuchar-elecciones-pais-vasco-directo_2024042166252aba8e66020001f7fab5.html",
    verifiedAt: "2026-03-24",
  },
  {
    cityName: "Bilbao",
    name: "LOS40 Classic Bilbao",
    freqMhz: 105.6,
    description: "Classic hits music station from the LOS40 network.",
    tags: ["music", "classic-hits"],
    source: "LOS40 station directory",
    sourceUrl: "https://los40.com/emisoras/",
    verifiedAt: "2026-03-24",
  },
];

function sortStations(stations) {
  return [...stations].sort((left, right) => {
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

export async function loadSpainCuratedStations() {
  return sortStations(
    SPAIN_CURATED_STATIONS.map((station) => ({
      ...station,
      countryCode: "ES",
      curated: true,
      timezone: "Europe/Madrid",
    })),
  );
}
