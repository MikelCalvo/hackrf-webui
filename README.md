# hackrf-webui

`hackrf-webui` is a local web interface for `HackRF`, built as a more visual successor to the `MKSpec` workflow with a much tighter scope:

- local only
- fully offline runtime
- built-in FM catalog that can grow through PRs
- custom presets stored in the browser
- audio streaming from `HackRF` to the browser through a local backend

There is no cloud, no accounts, and no remote bridge. Everything runs on the user's own machine.

## Current MVP

- Web dashboard with region, country, city, and text filters
- On-demand FM catalog loading by country shard
- Local custom presets
- Detection for `HackRF`, `ffmpeg`, and the native binary
- FM (`WFM`) listening in the browser

## System Dependencies

You need the following installed:

- `hackrf_info` and the `libhackrf` runtime
- `ffmpeg`
- a C compiler (`cc`)
- `libhackrf` development headers to build the bundled native binary
- `pdftotext` and `pdftohtml` if you want to rebuild the FM catalog from all official sources

In this repo, the SDR binary is built from [`native/hackrf_audio_stream.c`](native/hackrf_audio_stream.c).

## Quick Start

```bash
git clone git@github.com:MikelCalvo/hackrf-webui.git
cd hackrf-webui
npm install
npm run build:native
npm run dev
```

Open `http://localhost:3000`.

`npm run dev` uses `webpack` by default to avoid `Turbopack` persistence failures in folders synchronized by `Syncthing`. If you still want to test `Turbopack`, use `npm run dev:turbo`. If the cache ever gets corrupted, clear `.next` with `npm run clean`.

## Usage

- Connect the `HackRF`
- Select an FM station from the catalog or create a custom preset
- Adjust `LNA`, `VGA`, and `audio gain`
- Click `Listen`

## Catalog And PRs

The generated runtime catalog now ships as:

- [`src/data/catalog/manifest.json`](src/data/catalog/manifest.json)
- [`public/catalog/manifest.json`](public/catalog/manifest.json)
- `public/catalog/countries/*.json`

Manual seed data lives in:

- [`src/data/catalog/manual/countries.json`](src/data/catalog/manual/countries.json)
- [`src/data/catalog/manual/cities.json`](src/data/catalog/manual/cities.json)
- [`src/data/catalog/manual/fm-stations.json`](src/data/catalog/manual/fm-stations.json)

That manual layer is intentionally kept small now:

- true manual fallback countries that still lack a clean official importer
- curated supplemental presets that still add real coverage while they are being migrated into dedicated importers

The idea is to keep it simple:

- the repo ships with a reasonable global baseline
- people can send PRs to expand regions, countries, cities, and frequencies
- every user can add local presets without changing the repo
- the UI keeps first load fast by only fetching the selected country shard

## Catalog Pipeline

The FM catalog can now be regenerated with:

```bash
npm run catalog:build
```

Current pipeline layers:

- manual curated fallback data from `src/data/catalog/manual`
- `GeoNames` for country, city, timezone, and coordinates
- official `ACMA` FM transmitter data for Australia
- official Brazilian federal radiodiffusion CSV for Brazil
- official `ANE` national FM technical plan appendix for Colombia
- official `Arcom` FM station directory pages for France
- official `ARCOTEL` national concession register workbook for Ecuador
- official `ATT` SINADI FM operator list for Bolivia
- official `BAKOM` FM coordination archive for Switzerland
- official Bundesnetzagentur UKW sender data for Germany
- official `CONATEL` commercial and community FM registers for Paraguay
- official `CTU` radio transmitters dataset for the Czech Republic
- official `FCC` LMS public database data for the United States and U.S. territories
- official `HAKOM` FM concession table for Croatia
- official `IFT` FM station workbook for Mexico
- official `MIB` operational private FM channels PDF and `Prasar Bharati` Akashvani stations PDF for India
- official `ISED` broadcasting data for Canada
- official `MTC` open-data FM authorization dataset for Peru
- official `RDI` FM licence PDFs for the Netherlands, with `Staatscourant` technical fallback for missing annexes
- official Vietnamese provincial FM frequency appendix for Vietnam
- official `NCC` FM transmitter workbook for Taiwan
- official `NMHH` FM station tables for Hungary
- official Flemish local FM package PDF for partial Belgium coverage
- official Andalusia, Extremadura, Castilla y Leon, Catalonia, and RTVE FM sources for regional Spain coverage
- official `NTC Region VII` FM station table for partial Philippines coverage
- official `2RN` FM network table for public-service coverage in Ireland
- official `IMDA` Spectrum Management Handbook for Singapore
- official `RTM` stations API for Malaysia
- official `RTR` MedienFrequenzbuch API for Austria
- official `RTUK` terrestrial radio portal for Turkey
- official `RRT` analogue radio frequency list for Lithuania
- curated Spain city presets from official broadcaster/network sources
- official `SUBTEL` FM Vigentes archive for Chile
- official `AKOS` RA and TV frequencies register for Slovenia
- official `Teleoff` FM decision PDF corpus for Slovakia
- official `UKE` FM reservation workbook for Poland
- official `URSEC` technical FM data workbook for Uruguay

This keeps the public repo on sources that are usable for an open project. Directory sites such as `World Radio Map`, `Radiomap.eu`, `RadioVolna`, `FMLIST`, and `FMSCAN` may be useful for manual verification, but they are not a safe primary source for bulk import into a public catalog.

`npm run catalog:build` now produces a lightweight manifest for the app shell and static country shards under `public/catalog`, so the browser only loads the active country instead of bundling the full FM catalog up front.
The builder also falls back to the last generated country shard when a previously landed official source is temporarily unavailable, and each source now has a hard timeout, which keeps rebuilds reproducible through transient regulator CDN failures.
The manifest now also carries country-level coverage metadata such as `coverageStatus`, `coverageTier`, `sourceQuality`, `sourceCount`, and top-level catalog stats, so the UI can distinguish official, partial, and manual coverage without hardcoding that logic.

## Coverage Roadmap

The staged global coverage plan lives in [`docs/fm/global-fm-coverage-plan.md`](docs/fm/global-fm-coverage-plan.md).
The current UK source blocker is documented in [`docs/fm/uk-source-notes.md`](docs/fm/uk-source-notes.md).
Additional blocker notes currently exist for [`Argentina`](docs/fm/argentina-source-notes.md), [`Italy`](docs/fm/italy-source-notes.md), [`Portugal`](docs/fm/portugal-source-notes.md), [`New Zealand`](docs/fm/new-zealand-source-notes.md), [`Japan`](docs/fm/japan-source-notes.md), and [`South Africa`](docs/fm/south-africa-source-notes.md). [`Spain`](docs/fm/spain-source-notes.md) still applies as a national-source blocker, but regional, public-broadcaster, and curated city coverage is now landed. India coverage details live in [`docs/fm/india-source-notes.md`](docs/fm/india-source-notes.md), and Netherlands coverage details now live in [`docs/fm/netherlands-source-notes.md`](docs/fm/netherlands-source-notes.md).
Indonesia and Thailand remain blocked from this environment; South Korea is still degraded to KBS/API-key-limited paths, and the Philippines now has official Region VII partial coverage even though the national NTC feed remains Cloudflare-blocked.

## Notes

- The web runtime does not use remote assets.
- If the native binary is missing, the UI will tell you and you can build it with `npm run build:native`.
- This MVP is focused on `WFM`.
- The next natural step is to bring the `MKSpec` scan and review flow into this base.
