# Development Guide

This page collects contributor-facing details that used to make the README too heavy.

## Local development

Use Node.js 24.x LTS with npm 11+; `.nvmrc` and `.node-version` are pinned to that baseline.

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

## Verification

Before sending changes, run the normal project checks:

```bash
npm ci
npm run check
npm run build
npm run check:bundle
npm run test:e2e
```

`npm run check` runs lint, a clean TypeScript check, the Node test suite, catalog validation, script syntax checks, both package audits and a package dry-run artifact check. `npm run build` still needs to run separately because it compiles native receivers and writes Next.js diagnostics for `npm run check:bundle`. `npm run test:e2e` builds the web bundle and runs the Playwright simulator/replay smoke suite with `HACKRF_WEBUI_SIMULATOR=1` and `HACKRF_WEBUI_REPLAY=1`, so it covers browser audio, AIS / ADS-B replay maps, release routes and runtime diagnostics without physical SDR hardware. `npm run test:e2e:auth` repeats the browser smoke path with API token auth enabled to verify protected runtime APIs and token injection.

The `/runtime` page shows the same redacted diagnostics returned by `/api/runtime/diagnostics` as a support-friendly health panel for paths, modes, service state and warnings.

Install the Playwright browser once on a fresh machine if `npm run test:e2e` reports a missing browser:

```bash
npx playwright install chromium
```

The FM catalog tooling has its own package boundary:

```bash
npm --prefix ./scripts/catalog ci
npm --prefix ./scripts/catalog audit --json
```

The root package also carries audit overrides for transitive dependencies that need a safe version forced while upstream packages catch up.

## Native receivers

The bundled native receivers are built from:

- [`native/hackrf_audio_stream.c`](../native/hackrf_audio_stream.c)
- [`native/hackrf_ais_stream.c`](../native/hackrf_ais_stream.c)

They are generated into ignored local binaries under `bin/` by:

```bash
npm run build:native
```

The managed ADS-B backend is built separately into:

- `bin/dump1090-fa`

Use this command if you only need to rebuild that backend manually:

```bash
node ./scripts/install-dump1090-fa.mjs
```

Release builds should use a full 40-character `DUMP1090_FA_REF`. If you have a published source-archive checksum, set `DUMP1090_FA_SHA256` so the installer verifies the archive before extraction.

## FM catalog

The FM runtime catalog is split into:

- [`src/data/catalog/manifest.json`](../src/data/catalog/manifest.json)
- [`public/catalog/manifest.json`](../public/catalog/manifest.json)
- `public/catalog/countries/*.json`

This keeps first load small and only fetches the active country shard.

Manual fallback data lives in:

- [`src/data/catalog/manual/countries.json`](../src/data/catalog/manual/countries.json)
- [`src/data/catalog/manual/cities.json`](../src/data/catalog/manual/cities.json)
- [`src/data/catalog/manual/fm-stations.json`](../src/data/catalog/manual/fm-stations.json)

That manual layer is intentionally small and only covers fallback cases that still lack a clean importer.

### Rebuilding the FM catalog

The FM catalog builder is for contributors, not for normal runtime use.

```bash
npm --prefix ./scripts/catalog ci
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

## PMR data

The PMR module does not use the FM coverage catalog.

Instead, it uses static channel packs defined in [`pmr-channels.ts`](../src/data/pmr-channels.ts) for license-free or common short-range voice bands. The runtime is designed around:

- narrowband FM audio
- built-in `PMR446`, `FRS`, `UHF CB` and `MURS` packs
- manual tuning
- automatic scanning with squelch, dwell, random/sequential modes and lock-on-activity behavior
- local activity log persistence in `SQLite`
- automatic activity capture while listening or scanning, with linked `WAV` and raw `IQ .cs8` files
- in-place retune of the active stream when possible

## AIRBAND data

The AIRBAND module uses static starter packs defined in [`airband-channels.ts`](../src/data/airband-channels.ts) plus browser-local saved presets. The runtime is designed around:

- civil VHF airband AM audio
- a global starter deck, not a country-specific airport database
- an `All` view that merges saved, common and guard channels
- quick local tuning rather than an airport database
- in-place retune of an active AM stream when possible
- shared HackRF audio ownership with FM and PMR
- browser-local preset storage and manual notes
- scan / lock / resume workflows on the active channel group

## MARITIME data

The MARITIME module uses static starter packs defined in [`maritime-channels.ts`](../src/data/maritime-channels.ts) plus browser-local saved presets. The runtime is designed around:

- marine VHF narrowband FM voice audio
- a global starter deck rather than a port-specific database
- an `All` view that merges saved, distress, port ops, working, regional and weather groups
- quick local tuning rather than a harbor directory
- in-place retune of an active NFM stream when possible
- shared HackRF audio ownership with FM, PMR and AIRBAND
- browser-local preset storage and manual notes
- scan / lock / resume workflows on the active channel group
- keeping AIS / DSC digital traffic out of this voice-focused module
- smart scan scoping for `All`, using the saved FM city / country when available
- curated regional packs for Spanish ports, UK MSI and selected U.S. VTS / Coast Guard channels

## Release workflow

Maintainers can publish a verified GitHub Release from the manual `Release` workflow on `main`. The workflow validates the version tag, installs the Node 24 toolchain, runs the full check/build/E2E suite including token-auth smoke coverage, creates the annotated tag and publishes the release notes supplied in the workflow input.

## Documentation map

- Product screenshots used by the README live under [`docs/screenshots`](screenshots).
- FM coverage planning and blocker notes live under [`docs/fm`](fm).
- Useful FM entry points:
  - [`docs/fm/global-fm-coverage-plan.md`](fm/global-fm-coverage-plan.md)
  - [`docs/fm/europe-coverage-status.md`](fm/europe-coverage-status.md)
  - [`docs/fm/uk-source-notes.md`](fm/uk-source-notes.md)
  - [`docs/fm/spain-source-notes.md`](fm/spain-source-notes.md)

PMR, AIRBAND and MARITIME are channel-pack based rather than station-registry based, so they do not need the same coverage-tracking model as FM.
