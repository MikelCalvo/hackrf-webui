# hackrf-webui

`hackrf-webui` is a local-first web interface for `HackRF`.

It runs on the user's own machine, works offline at runtime, exposes radio controls in a browser UI, and currently ships with four real modules:

- `FM`: browser listening with a large country-sharded station catalog
- `PMR`: narrowband channel presets with manual listen and automatic scanning
- `AIS`: native dual-channel HackRF decoding with a live vessel map and offline-capable basemaps
- `ADS-B`: live aircraft tracking with a managed `dump1090-fa` backend, a local aircraft map and offline-capable basemaps

There is no cloud layer, no account system, and no remote device bridge.

## Current Scope

### FM

- `WFM` listening through the browser
- region / country / city / text filtering
- on-demand country shard loading to keep the UI responsive
- global coverage metadata with a dedicated coverage page
- custom presets stored locally in the browser

### PMR

- `NFM` listening through the browser
- built-in channel packs for:
  - `PMR446`
  - `FRS`
  - `UHF CB`
  - `MURS`
- manual channel tuning
- automatic scanning with:
  - sequential or random scan mode
  - squelch threshold
  - dwell time
  - lock-on-activity behavior
  - activity log
- in-place retune of the active PMR stream without restarting the browser audio pipeline

### AIS

- live AIS decoding from the HackRF across channels A and B at `161.975 MHz` / `162.025 MHz`
- native demodulation and message parsing inside `hackrf-webui`, without `SDRangel`
- vessel map with offline-capable dark basemaps
- managed PMTiles layers, plus a default worldwide Protomaps dark extract served from `public/tiles/osm`

### ADS-B

- live ADS-B / Mode S decoding at `1090 MHz`
- managed `dump1090-fa` backend driven by `hackrf-webui`
- aircraft map with the same offline-capable basemap system used by AIS
- local start / stop control, receiver stats and aircraft detail inside the dashboard

### Planned / Not Landed Yet

- `Airband`

That module already exists in the dashboard structure, but it is not implemented yet.

## Quick Start

```bash
git clone git@github.com:MikelCalvo/hackrf-webui.git
cd hackrf-webui
./start.sh
```

By default, `start.sh`:

- installs missing system dependencies on common Linux distributions
- installs Node dependencies
- ensures a managed offline map stack unless `--skip-maps` is used
- installs a dark global basemap capped near `4 GB` by default
- optionally adds one high-detail country overlay when `--map-country` is set
- prompts for a country overlay in interactive terminals if none is configured yet
- installs or updates the local `dump1090-fa` ADS-B backend unless `--skip-adsb-runtime` is used
- builds the native `HackRF` receiver binaries
- builds the Next.js app
- starts the web UI in production mode

Default address:

- `http://127.0.0.1:3000`

Module routes:

- `/fm`
- `/pmr`
- `/ais`
- `/adsb`

The root route `/` redirects to the last module used in the browser when available, and otherwise falls back to `/fm`.

Useful options:

```bash
./start.sh --check
./start.sh --host 0.0.0.0 --port 4000
./start.sh --skip-system-deps
./start.sh --skip-npm --skip-build
./start.sh --map-global-budget 4G
./start.sh --map-global-zoom 10
./start.sh --map-country ES
./start.sh --map-country ES --map-country-zoom 14
./start.sh --skip-adsb-runtime
./start.sh --reinstall-adsb-runtime
./start.sh --rebuild
```

What they do:

- `--check` validates the local setup and prints a status report without changing the machine
- `--host` and `--port` override the bind address
- `--skip-system-deps` avoids package-manager changes
- `--skip-npm` and `--skip-build` reuse existing local artifacts
- `--map-global-budget` controls the target size of the shared global basemap layer
- `--map-global-zoom` forces the shared global basemap max zoom
- `--map-country` installs or refreshes one high-detail country overlay on top of the shared world layer
- `--map-country-zoom` controls the overlay max zoom for that country
- `--skip-maps` keeps AIS and ADS-B in live-tile mode
- `--skip-adsb-runtime` keeps the existing ADS-B backend untouched or skips it entirely
- `--reinstall-adsb-runtime` rebuilds the pinned local `dump1090-fa` backend
- `--rebuild` forces a fresh `npm ci` and production rebuild

Environment overrides also work:

```bash
HOST=0.0.0.0 PORT=4000 ./start.sh
MAP_GLOBAL_BUDGET=4G ./start.sh
MAP_GLOBAL_MAX_ZOOM=10 ./start.sh
MAP_COUNTRY=ES MAP_COUNTRY_MAX_ZOOM=14 ./start.sh
DUMP1090_FA_REINSTALL=1 ./start.sh
```

If the default port is busy and you did not explicitly force a port, the script automatically falls forward to the next free one it can find.

Managed map model:

- the global layer is chosen from a size budget, not a hardcoded profile
- the default `4 GB` budget currently lands on a world extract up to `z10`
- country overlays start at the first zoom above the global layer and extend to the configured country zoom
- maps are stored under `public/tiles/osm/global` and `public/tiles/osm/countries`

## Supported Package Managers In `start.sh`

- `apt` for Debian / Ubuntu
- `dnf` for Fedora / RHEL-like systems
- `pacman` for Arch-based systems
- `zypper` for openSUSE

If your distribution does not expose one of the required packages in its enabled repositories, the script stops with a clear error so you can install that package manually and rerun it.

## Manual Production Start

If you prefer to handle dependencies yourself:

```bash
npm ci
node ./scripts/install-dump1090-fa.mjs
npm run build
npm run start -- --hostname 127.0.0.1 --port 3000
```

Optional offline maps can also be prepared manually:

```bash
./manage_maps.sh ensure
./manage_maps.sh add-country ES
./manage_maps.sh status
```

You can also validate the environment without starting the server:

```bash
./start.sh --check
```

## Runtime Requirements

For normal usage, the app needs:

- `HackRF` userspace tools, including `hackrf_info`
- `libhackrf` development headers so the bundled native binary can be built
- `ffmpeg`
- `cc`
- `pkg-config`
- `ncurses` development headers
- `Node.js` `20+`
- `npm`

The bundled native receivers are built from:

- [`native/hackrf_audio_stream.c`](native/hackrf_audio_stream.c)
- [`native/hackrf_ais_stream.c`](native/hackrf_ais_stream.c)

The managed ADS-B backend is built separately into:

- [`bin/dump1090-fa`](bin/dump1090-fa)

## AIS Runtime Notes

The AIS module tunes the HackRF directly, demodulates AIS in the native binary, validates frames, parses AIS messages in the backend and renders decoded vessels on the map in real time.

Offline basemaps are served from `public/tiles/osm`. By default, `./start.sh` ensures a managed PMTiles stack made of:

- one shared dark world layer sized by `--map-global-budget` or `--map-global-zoom`
- zero or more country overlays managed by `./manage_maps.sh`

The AIS map behavior is:

- if FM already has a saved city in browser local storage, AIS starts centered near that city
- otherwise it falls back to decoded AIS bounds when traffic exists
- if there is still no traffic, it falls back to the installed basemap bounds

## ADS-B Runtime Notes

The ADS-B module uses the same local-first dashboard model as AIS, but the decoder backend is `dump1090-fa` compiled locally and managed by `hackrf-webui`.

The runtime:

- claims the `HackRF` exclusively while ADS-B is active
- starts `dump1090-fa` with `HackRF` input at `1090 MHz`
- reads `receiver.json`, `aircraft.json` and `stats.json` from `.cache/adsb-runtime/json`
- normalizes those files into the app's own ADS-B snapshot and UI state
- reuses the same offline basemap pipeline as AIS

The ADS-B map behavior is:

- if FM already has a saved city in browser local storage, ADS-B starts centered near that city
- otherwise it falls back to live aircraft bounds when traffic exists
- if there is still no aircraft position, it falls back to receiver coordinates if configured
- if there is still no location hint, it falls back to the installed basemap bounds

## Offline Map Management

The map stack is managed by [`manage_maps.sh`](manage_maps.sh), which wraps [`scripts/manage-maps.mjs`](scripts/manage-maps.mjs).

Useful commands:

```bash
./manage_maps.sh status
./manage_maps.sh ensure
./manage_maps.sh ensure --global-budget 4G
./manage_maps.sh add-country ES
./manage_maps.sh add-country ES --country-max-zoom 14
./manage_maps.sh remove-country ES
./manage_maps.sh list-countries
./manage_maps.sh clean
```

Upgrade examples:

```bash
./manage_maps.sh install-global --global-max-zoom 11 --reinstall
./manage_maps.sh add-country ES --country-max-zoom 14 --reinstall
./manage_maps.sh ensure --global-max-zoom 11 --country ES --country-max-zoom 14 --reinstall
```

Behavior:

- if a layer already exists at the same or higher zoom, the manager keeps it
- use `--reinstall` when you want to force a rebuild or move to a higher target zoom
- with the current Protomaps `v4.pmtiles` source, the practical hard limit is `z15`

The managed manifest lives at `public/tiles/osm/manifest.json` and uses a single clean layered schema:

- `version: 1`
- one global PMTiles layer
- zero or more country PMTiles overlays

There is no legacy compatibility layer for earlier map manifest formats in the current tree.

Useful environment overrides for the ADS-B backend:

```bash
ADSB_SAMPLE_RATE=2400000 ./start.sh
ADSB_LNA_GAIN=32 ADSB_VGA_GAIN=50 ./start.sh
ADSB_ENABLE_AMP=1 ./start.sh
ADSB_ENABLE_ANTENNA_POWER=1 ./start.sh
ADSB_RECEIVER_LAT=40.4168 ADSB_RECEIVER_LON=-3.7038 ./start.sh
```

If you prefer to build only the ADS-B backend manually:

```bash
node ./scripts/install-dump1090-fa.mjs
```

To remove local generated artifacts and leave the repo close to a fresh clone:

```bash
./clean.sh
./clean.sh --dry-run
```

`./clean.sh` asks for confirmation by default. Use `./clean.sh --yes` in non-interactive environments.

## Development

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

`npm run dev` uses `webpack` by default because it has been more stable than `Turbopack` in synchronized folders. If you want to test `Turbopack`, use:

```bash
npm run dev:turbo
```

If you only want to clear the Next.js build output:

```bash
npm run clean
```

## FM Catalog

The FM runtime catalog is split into:

- [`src/data/catalog/manifest.json`](src/data/catalog/manifest.json)
- [`public/catalog/manifest.json`](public/catalog/manifest.json)
- `public/catalog/countries/*.json`

This keeps first load small and only fetches the active country shard.

Manual fallback data lives in:

- [`src/data/catalog/manual/countries.json`](src/data/catalog/manual/countries.json)
- [`src/data/catalog/manual/cities.json`](src/data/catalog/manual/cities.json)
- [`src/data/catalog/manual/fm-stations.json`](src/data/catalog/manual/fm-stations.json)

That manual layer is intentionally small now and only covers true fallback cases that still lack a clean importer.

### Rebuilding The FM Catalog

The FM catalog builder is for contributors, not for normal runtime use.

```bash
npm run catalog:build
```

Optional extra tools for some catalog importers:

- `pdftotext`
- `pdftohtml`

The builder currently combines:

- `GeoNames` for geographic normalization
- a large set of official regulator / public-sector FM sources
- a small manual fallback layer where no reproducible official importer is available yet
- cached shard fallback when a previously landed source is temporarily unavailable

Country coverage metadata is embedded in the manifest, including:

- `coverageStatus`
- `coverageTier`
- `coverageScope`
- `sourceQuality`
- `sourceCount`
- `notesPath`

## PMR Data

The PMR module does not use the FM coverage catalog.

Instead, it uses static channel packs defined in [`pmr-channels.ts`](src/data/pmr-channels.ts) for license-free or common short-range voice bands. The current PMR runtime is designed around:

- narrowband FM audio
- fast retune of an existing stream
- scan / lock / resume workflows
- per-user local scan preferences stored in the browser

## Documentation

FM coverage planning and blocker notes live under [`docs/fm`](docs/fm).

Useful entry points:

- [`docs/fm/global-fm-coverage-plan.md`](docs/fm/global-fm-coverage-plan.md)
- [`docs/fm/europe-coverage-status.md`](docs/fm/europe-coverage-status.md)
- [`docs/fm/uk-source-notes.md`](docs/fm/uk-source-notes.md)
- [`docs/fm/spain-source-notes.md`](docs/fm/spain-source-notes.md)

At the moment, those docs are FM-specific. PMR does not need the same coverage-tracking model because it is channel-pack based rather than station-registry based.

## Notes

- Runtime use is local and offline-friendly.
- The app does not depend on remote frontend assets.
- The current radio runtime is focused on `HackRF`.
- FM, PMR, AIS and ADS-B are the landed modules today.
- The catalog and band modules are intended to keep growing through importer work and targeted PRs.
