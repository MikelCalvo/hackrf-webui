# Runtime Guide

This page keeps the operational details out of the public README while preserving the commands and behavior needed by users who want to understand or customize the runtime.

## Start script

The recommended production-style start is:

```bash
./start.sh
```

By default, `start.sh`:

- installs missing system dependencies on common Linux distributions
- installs `gpsd` packages when the distribution exposes them, so live GPS positioning is ready when needed
- installs Node dependencies
- prepares the local `SQLite` runtime storage under `db/` and runs pending migrations automatically
- downloads the local AI model assets into `assets/ai/` if they are missing
- installs a local AI runtime under `runtime/` using `uv`, a managed `Python 3.13`, `ai-edge-litert` and `webrtcvad-wheels`
- ensures a managed offline map stack unless `--skip-maps` is used
- installs a dark global basemap capped near `4 GB` by default
- optionally adds one high-detail country overlay when `--map-country` is set
- prompts for a country overlay in interactive terminals if none is configured yet
- installs or updates the local `dump1090-fa` ADS-B backend unless `--skip-adsb-runtime` is used
- builds the native `HackRF` receiver binaries
- builds the Next.js app
- starts the web UI in production mode

Default address:

```text
http://127.0.0.1:3000
```

Module routes:

- `/sigint`
- `/fm`
- `/pmr`
- `/airband`
- `/maritime`
- `/ais`
- `/adsb`

The root route `/` redirects to the last module used in the browser when available, and otherwise falls back to `/fm`.

If the default port is busy and you did not explicitly force a port, the script automatically falls forward to the next free one it can find.

## Supported package managers

`start.sh` knows how to install common runtime dependencies through:

- `apt` for Debian / Ubuntu
- `dnf` for Fedora / RHEL-like systems
- `pacman` for Arch-based systems
- `zypper` for openSUSE

If your distribution does not expose one of the required packages in its enabled repositories, the script stops with a clear error so you can install that package manually and rerun it.

## Useful start options

```bash
./start.sh --check
HACKRF_WEBUI_TOKEN="$(openssl rand -hex 32)" ./start.sh --host 0.0.0.0 --port 4000
./start.sh --skip-system-deps
./start.sh --skip-npm --skip-build
./start.sh --skip-ai
./start.sh --map-global-budget 4G
./start.sh --map-global-zoom 10
./start.sh --map-country ES
./start.sh --map-country ES --map-country-zoom 14
./start.sh --skip-adsb-runtime
./start.sh --reinstall-adsb-runtime
HACKRF_WEBUI_SIMULATOR=1 HACKRF_WEBUI_REPLAY=1 ./start.sh --skip-system-deps --skip-maps --skip-adsb-runtime --skip-ai
./start.sh --rebuild
HACKRF_WEBUI_GPSD_HOST=127.0.0.1 HACKRF_WEBUI_GPSD_PORT=2947 ./start.sh
```

What they do:

- `--check` validates the local setup and prints a status report without changing the machine
- `--host` and `--port` override the bind address; non-loopback hosts require `HACKRF_WEBUI_TOKEN`
- `--skip-system-deps` avoids package-manager changes
- `--skip-npm` and `--skip-build` reuse existing local artifacts
- `--skip-ai` leaves the local SIGINT AI runtime untouched or absent
- `--map-global-budget` controls the target size of the shared global basemap layer
- `--map-global-zoom` forces the shared global basemap max zoom
- `--map-country` installs or refreshes one high-detail country overlay on top of the shared world layer
- `--map-country-zoom` controls the overlay max zoom for that country
- `--skip-maps` keeps AIS and ADS-B in live-tile mode
- `--skip-adsb-runtime` keeps the existing ADS-B backend untouched or skips it entirely
- `--reinstall-adsb-runtime` rebuilds the pinned local `dump1090-fa` backend
- `HACKRF_WEBUI_SIMULATOR=1` enables a virtual HackRF for browser-audio module development without physical SDR hardware
- `HACKRF_WEBUI_REPLAY=1` serves deterministic AIS / ADS-B map fixtures and history through the live APIs
- `--reinstall-ai` rebuilds the local SIGINT AI runtime and Python packages
- `--rebuild` forces a fresh `npm ci` and production rebuild
- `HACKRF_WEBUI_GPSD_HOST` and `HACKRF_WEBUI_GPSD_PORT` point the app at a non-default GPSD listener when needed

Environment overrides also work:

```bash
HOST=0.0.0.0 PORT=4000 HACKRF_WEBUI_TOKEN="$(openssl rand -hex 32)" ./start.sh
MAP_GLOBAL_BUDGET=4G ./start.sh
MAP_GLOBAL_MAX_ZOOM=10 ./start.sh
MAP_COUNTRY=ES MAP_COUNTRY_MAX_ZOOM=14 ./start.sh
DUMP1090_FA_REINSTALL=1 ./start.sh
AI_REINSTALL=1 ./start.sh
HACKRF_WEBUI_SIMULATOR=1 ./start.sh
HACKRF_WEBUI_REPLAY=1 ./start.sh
HACKRF_WEBUI_AI_PYTHON=3.13 ./start.sh
HACKRF_WEBUI_GPSD_PORT=2947 ./start.sh
```

## Development without a physical HackRF

Set `HACKRF_WEBUI_SIMULATOR=1` when you want to develop or smoke-test the web UI on a machine that does not have a HackRF attached:

```bash
HACKRF_WEBUI_SIMULATOR=1 HACKRF_WEBUI_REPLAY=1 ./start.sh --skip-system-deps --skip-maps --skip-adsb-runtime --skip-ai
```

Simulator mode affects the browser-audio modules: `FM`, `PMR`, `AIRBAND` and `MARITIME`. It reports a virtual connected HackRF, streams short MP3 audio chunks to the browser, and generates synthetic signal telemetry plus spectrum frames so tune, retune, scanner and status flows can be exercised without USB hardware. When launched through `start.sh`, simulator mode builds only the web bundle (`npm run build:web`) because the native HackRF binaries are not needed.

Replay mode is the matching map/feed fixture layer. Set `HACKRF_WEBUI_REPLAY=1` to serve deterministic `AIS` vessels and `ADS-B` aircraft through `/api/ais`, `/api/adsb` and their history endpoints without starting the live RF decoders or the managed `dump1090-fa` backend. This is intended for demos, UI development and CI smoke tests; leave it unset for real radio operation.

The redacted diagnostics endpoint is available at `/api/runtime/diagnostics`. It reports app version, simulator/replay mode, auth configuration status, path availability, hardware status, AIS/ADS-B runtime health and radio-session counters while redacting tokens, serials, bearer values and external paths.

Both simulator and replay modes are opt-in only. Leave `HACKRF_WEBUI_SIMULATOR` and `HACKRF_WEBUI_REPLAY` unset for real radio operation.

## API token and LAN mode

`hackrf-webui` controls local radio hardware, starts streams and writes captures. The default host is `127.0.0.1`; this needs no token for normal local use.

When you bind to a non-loopback host, `start.sh` requires `HACKRF_WEBUI_TOKEN`:

```bash
HACKRF_WEBUI_TOKEN="$(openssl rand -hex 32)" ./start.sh --host 0.0.0.0 --port 4000
```

The token is accepted through `Authorization: Bearer`, `X-HackRF-WebUI-Token`, or an `apiToken` query parameter for browser transports that cannot set headers. `start.sh` mirrors `HACKRF_WEBUI_TOKEN` into `NEXT_PUBLIC_HACKRF_WEBUI_TOKEN` so the browser UI can authenticate protected API, SSE and audio-stream requests.

This is intended for trusted LAN protection. Anyone who can load the UI can read the browser token, so do not treat it as multi-user auth and do not expose the service directly to the internet. For remote use, prefer VPN / SSH tunnel / authenticated reverse proxy and HTTPS.

If you embed the UI behind another origin, set an explicit unsafe-request allow-list:

```bash
HACKRF_WEBUI_ALLOWED_ORIGINS="https://radio.example.net" ./start.sh
```

## Runtime requirements

For normal usage, the app needs:

- `HackRF` userspace tools, including `hackrf_info`
- `libhackrf` development headers so the bundled native binary can be built
- `ffmpeg`
- `cc`
- `pkg-config`
- `ncurses` development headers
- `Node.js` `20.19+`, `22.13+` or any supported `24+` runtime
- `npm` `10+`
- `curl`

Optional but supported:

- `gpsd`
- a compatible GPS receiver, such as a USB `u-blox`, if you want live physical positioning

`start.sh` tries to install `gpsd` on the supported Linux package managers, but the app still runs without it if you only want fixed manual positions.

## Local runtime storage

`hackrf-webui` is local-first, so runtime evidence is stored on disk next to the project:

- `db/app.sqlite`
  - the local `SQLite` database
  - stores module activity events, route history for `AIS` / `ADS-B`, capture metadata for linked audio / IQ evidence, and `SIGINT` review / AI state
- `data/captures/`
  - stores activity-triggered `WAV` audio and raw `IQ .cs8` captures for `PMR`, `AIRBAND` and `MARITIME`
  - is organized per day and per stream session under the project tree
  - keeps large binaries on disk while `SQLite` stores the linkage and metadata
- `runtime/`
  - stores the local AI toolchain
  - includes the managed `uv` bootstrap, the pinned `Python 3.13` install, the AI virtualenv and its cache

What already persists today:

- `PMR`, `AIRBAND`, `MARITIME` activity logs
- `PMR`, `AIRBAND`, `MARITIME` activity-linked `WAV` and raw `IQ` captures
- local AI queue state, classifications and tags for `PMR`, `AIRBAND` and `MARITIME` captures
- `AIS` vessel position history
- `ADS-B` aircraft position history

The FM station catalog is intentionally not stored in the database. It remains a sharded static catalog under `public/catalog`.

## Global location

The top bar exposes a shared location button on every module. That dialog controls two separate things:

- `Catalog scope`
  - country and optional city
  - used by FM defaults and regional scan logic such as Maritime Smart Local
- `Exact position`
  - used by map-centric views and any feature that needs true operating coordinates
  - can come from:
    - the selected city centroid
    - an exact map pin you place manually
    - a live fix from local `gpsd`

This split matters:

- you can keep `Bilbao` as the catalog scope for FM and Maritime
- while using a more exact rooftop antenna pin for map centering
- or while letting `gpsd` drive the exact coordinates when operating mobile

The exact position picker uses the same offline-capable basemap stack as `AIS` and `ADS-B`, so it stays usable without internet once the local map pack is installed.

## Managed maps

The map stack is managed by [`manage_maps.sh`](../manage_maps.sh), which wraps [`scripts/manage-maps.mjs`](../scripts/manage-maps.mjs).

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

- the global layer is chosen from a size budget, not a hardcoded profile
- the default `4 GB` budget currently lands on a world extract up to `z10`
- country overlays start at the first zoom above the global layer and extend to the configured country zoom
- maps are stored under `public/tiles/osm/global` and `public/tiles/osm/countries`
- if a layer already exists at the same or higher zoom, the manager keeps it
- use `--reinstall` when you want to force a rebuild or move to a higher target zoom
- with the current Protomaps `v4.pmtiles` source, the practical hard limit is `z15`

The managed manifest lives at `public/tiles/osm/manifest.json` and uses a single clean layered schema:

- `version: 1`
- one global PMTiles layer
- zero or more country PMTiles overlays

There is no legacy compatibility layer for earlier map manifest formats in the current tree.

## Manual production start

If you prefer to handle dependencies yourself:

```bash
npm ci
npm run db:migrate
node ./scripts/install-dump1090-fa.mjs
npm run build
npm run start -- --hostname 127.0.0.1 --port 3000
```

If you also want the local SIGINT AI runtime without using `start.sh`, install it under the project tree:

```bash
export UV_UNMANAGED_INSTALL="$PWD/runtime/tools/uv"
curl -fsSL https://astral.sh/uv/install.sh | sh
runtime/tools/uv/uv python install --install-dir runtime/python 3.13
runtime/tools/uv/uv venv --python 3.13 runtime/ai-venv
runtime/tools/uv/uv pip install --python runtime/ai-venv/bin/python -r scripts/ai/requirements.txt
mkdir -p assets/ai
curl -fsSL https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/latest/yamnet.tflite -o assets/ai/yamnet.tflite
curl -fsSL https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv -o assets/ai/yamnet_class_map.csv
runtime/ai-venv/bin/python scripts/ai/audio_tagger.py --check --model assets/ai/yamnet.tflite --labels assets/ai/yamnet_class_map.csv
```

Optional offline maps can also be prepared manually:

```bash
./manage_maps.sh ensure
./manage_maps.sh add-country ES
./manage_maps.sh status
```

You can validate the environment without starting the server:

```bash
./start.sh --check
```

## AIS runtime notes

The AIS module tunes the HackRF directly, demodulates AIS in the native binary, validates frames, parses AIS messages in the backend and renders decoded vessels on the map in real time.

Offline basemaps are served from `public/tiles/osm`. By default, `./start.sh` ensures a managed PMTiles stack made of:

- one shared dark world layer sized by `--map-global-budget` or `--map-global-zoom`
- zero or more country overlays managed by `./manage_maps.sh`

The AIS map behavior is:

- if a global exact position is configured, AIS starts from that point
- otherwise it falls back to decoded AIS bounds when traffic exists
- if there is still no traffic, it falls back to the selected country overlay or the installed basemap bounds

## ADS-B runtime notes

The ADS-B module uses the same local-first dashboard model as AIS, but the decoder backend is `dump1090-fa` compiled locally and managed by `hackrf-webui`.

The runtime:

- claims the `HackRF` exclusively while ADS-B is active
- starts `dump1090-fa` with `HackRF` input at `1090 MHz`
- reads `receiver.json`, `aircraft.json` and `stats.json` from `.cache/adsb-runtime/json`
- normalizes those files into the app's own ADS-B snapshot and UI state
- reuses the same offline basemap pipeline as AIS

The ADS-B map behavior is:

- if a global exact position is configured, ADS-B starts from that point
- otherwise it falls back to live aircraft bounds when traffic exists
- if there is still no aircraft position, it falls back to receiver coordinates if configured
- if there is still no location hint, it falls back to the selected country overlay or the installed basemap bounds

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

## Cleaning generated artifacts

To remove local generated artifacts and leave the repo close to a fresh clone:

```bash
./clean.sh
./clean.sh --dry-run
```

`./clean.sh` asks for confirmation by default. Use `./clean.sh --yes` in non-interactive environments.
