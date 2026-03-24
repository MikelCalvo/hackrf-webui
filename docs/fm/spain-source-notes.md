# Spain FM source notes

As of 2026-03-24, there is still no clean current nationwide official FM export
for Spain that can be used as a single importer source. The practical approach
in this repository is to aggregate official regional and public-broadcaster
datasets that publish tuneable FM frequencies.

## Official sources currently usable

- Andalusia private FM assignments:
  - https://www.juntadeandalucia.es/datosabiertos/portal/dataset/db069ed9-7d73-4cdc-8981-1badc6d5911c/resource/cbfbde8f-9400-4546-bb3a-eab280fd093e/download/20240318_fm-comerciales_web_0.xls
- Andalusia municipal FM assignments:
  - https://www.juntadeandalucia.es/datosabiertos/portal/dataset/32f9d19e-86a9-45d0-8a91-1b3a4e7e447a/resource/f0856ba5-a364-4ae0-8a13-fa171ceb6c59/download/20210628_fm_municipales_web.xls
- Extremadura radio/TDT local workbook:
  - https://www.juntaex.es/documents/77055/5801338/Emisoras_y_TDTL.xls
- Castilla y León private FM assignments:
  - https://datosabiertos.jcyl.es/web/jcyl/risp/es/ciencia-tecnologia/emisoras-fm-titularidad-privada/1284843864772.csv
- Castilla y León municipal FM assignments:
  - https://datosabiertos.jcyl.es/web/jcyl/risp/es/ciencia-tecnologia/emisoras-municipales-fm/1284843873946.csv
- Catalonia Radio transmitter centres:
  - https://analisi.transparenciacatalunya.cat/api/views/pf4t-gv87/rows.csv?accessType=DOWNLOAD
- RTVE public radio frequency map:
  - https://www.rtve.es/radio/frecuencias-rne/

## What each source contributes

- Andalusia private and municipal datasets provide locality plus FM frequency,
  split between commercial/private and municipal services.
- Extremadura provides locality/demarcation, province, service type,
  licensee/operator, and frequency in a single workbook.
- Castilla y León provides separate CSVs for municipal FM and private FM, with
  locality, province, frequency, and licensee for the private network.
- Catalonia provides transmitter-site rows with four tuneable public services
  per site:
  - Catalunya Ràdio
  - Catalunya Informació
  - Catalunya Música
  - iCat
  - It also includes latitude and longitude, which makes the source robust even
    when the site name is not itself a municipality name.
- RTVE provides the current public-radio FM frequency map by province and
  transmitter site. It is an official public-broadcaster source and fills in a
  large amount of national public-service coverage without relying on
  non-official mirrors.

## Current scope

- A smoke test of the combined regional importer on 2026-03-24 returned 1,937
  FM rows from these official sources.
- The current importer remains partial for Spain as a whole.
  - These datasets cover only the regions and networks listed above.
  - Catalonia's source covers the public Catalunya Ràdio network, not the full
    commercial/local FM landscape of Catalonia.
  - RTVE covers RNE, not every public and commercial Spanish broadcaster.

## Remaining blocker

The national-level blocker is unchanged:

- BOE publishes legal technical plans and annexes, for example:
  - https://www.boe.es/buscar/doc.php?id=BOE-A-1989-4070
- But I still did not verify a clean current national machine-readable FM
  registry from CNMC, the ministry, or BOE that exposes current station rows
  with frequency plus locality/site and station/licensee in one reproducible
  feed.

So the correct strategy for Spain remains:

- keep extending the regional importer with clean official regional/open-data
  sources when they exist, and
- avoid inventing a brittle pseudo-national parser from legal annexes or
  non-official aggregation sites.
