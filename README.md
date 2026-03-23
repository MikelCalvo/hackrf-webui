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
- Global seed list of FM stations across multiple cities
- Local custom presets
- Detection for `HackRF`, `ffmpeg`, and the native binary
- FM (`WFM`) listening in the browser

## System Dependencies

You need the following installed:

- `hackrf_info` and the `libhackrf` runtime
- `ffmpeg`
- a C compiler (`cc`)
- `libhackrf` development headers to build the bundled native binary

In this repo, the SDR binary is built from [`hackrf_audio_stream.c`](/home/mk/SDR/hackrf-webui/native/hackrf_audio_stream.c).

## Quick Start

```bash
cd /home/mk/SDR/hackrf-webui
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

The initial seed is split into:

- [`regions.json`](/home/mk/SDR/hackrf-webui/src/data/catalog/regions.json)
- [`countries.json`](/home/mk/SDR/hackrf-webui/src/data/catalog/countries.json)
- [`cities.json`](/home/mk/SDR/hackrf-webui/src/data/catalog/cities.json)
- [`fm-stations.json`](/home/mk/SDR/hackrf-webui/src/data/catalog/fm-stations.json)

The idea is to keep it simple:

- the repo ships with a reasonable global baseline
- people can send PRs to expand regions, countries, cities, and frequencies
- every user can add local presets without changing the repo

## Notes

- The web runtime does not use remote assets.
- If the native binary is missing, the UI will tell you and you can build it with `npm run build:native`.
- This MVP is focused on `WFM`.
- The next natural step is to bring the `MKSpec` scan and review flow into this base.
