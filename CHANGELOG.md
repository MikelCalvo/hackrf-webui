# Changelog

All notable changes to `hackrf-webui` are tracked here.

## Unreleased

## 1.1.0 - 2026-08-11

- Replaced the previous YAMNet/WebRTC audio-analysis pipeline with local SIGINT Audio v2: Silero VAD v6 detects bounded radio-voice regions and `Systran/faster-whisper-base` transcribes only those regions, with pinned model assets and revisions, benchmark tooling and the original WAV retained as the source of truth.
- Expanded the SIGINT review workspace with reusable saved views, richer filters and counts, active-filter chips, queue-aware review progression, persisted resizable panels, note autosave and race-safe review updates.
- Added persistent AIS and ADS-B contact views with search, live/history scope, operational filters and sorting, plus clearer runtime diagnostics and tracking summaries.
- Made AIS and ADS-B reception explicitly operator-controlled: opening either workspace no longer starts a decoder or claims the HackRF until `START SCANNING` is selected.
- Improved narrow-screen SIGINT usability with filter and evidence drawers instead of clipped fixed-width panels.
- Added byte-range streaming for stored WAV captures, including `Content-Length`, `Accept-Ranges`, `206 Partial Content` and `416 Range Not Satisfiable`, restoring reliable duration and seeking for recordings.
- Added accessible names and state semantics to SIGINT search, FM catalog filters and AIRBAND/MARITIME manual tuning and scan-mode controls.
- Hardened local browser hardware controls, API origin handling, runtime setup diagnostics, HackRF detection and GCC 16 ADS-B builds.
- Added focused unit and Playwright coverage for the AI pipeline, review workflows, filters, responsive layout, explicit decoder startup, accessible controls and WAV range responses.
- Kept downloaded faster-whisper model weights out of release package contents while preserving the small pinned Silero VAD asset required by the application.

## 1.0.2 - 2026-08-10

- Updated the application and catalog dependency sets, including Next.js 16.3, React 19.2.8, Playwright 1.62, Tailwind CSS 4.3 and better-sqlite3 13.
- Refreshed transitive security overrides and lockfiles; root and catalog dependency audits report zero vulnerabilities.
- Updated GitHub Actions workflows to `actions/checkout@v7` and `actions/setup-node@v7`.
- Kept the protected `/runtime` page out of the unauthenticated browser-console smoke suite while retaining dedicated token-auth E2E coverage.
- Simplified GitHub Release titles to use the version tag directly.

## 1.0.1 - 2026-05-11

- Moved the repository and CI baseline to Node.js 24 LTS / npm 11 with GitHub Actions using the pinned `.node-version`.
- Added token-auth Playwright smoke coverage so protected runtime APIs and browser token injection are verified in CI.
- Added `start.sh` runtime-gate tests, idempotent DB migration tests, SIGINT capture path-traversal coverage and offline-map fallback tests.
- Added a redacted `/runtime` diagnostics page backed by `/api/runtime/diagnostics` for support-friendly health checks.
- Added a manual GitHub Actions release workflow that verifies checks, build, bundle budget and E2E smoke before publishing a tag/release.
- Fixed the diagnostics map manifest path to match `public/tiles/osm/manifest.json` and hardened SIGINT capture summaries so unsafe paths are not exposed.

## 1.0.0 - 2026-05-06

- Initial public local-first HackRF web UI release with FM, PMR, AIRBAND, MARITIME, AIS, ADS-B and SIGINT workspaces.
- Added CI-oriented quality scripts for linting, clean typechecking, tests, audits, catalog checks, package dry-runs and script syntax checks.
- Added Node test coverage for catalog, location, scanner activity, API auth and radio-session validation logic.
- Hardened local API access with token enforcement for non-loopback hosts, origin checks for unsafe methods and browser helpers for protected API/SSE/audio calls.
- Added server-side validation for radio session create/update payloads, including channel deck limits, gain ranges, frequencies and location bounds.
- Added catalog and bundle budget checks for release hygiene.
- Added supply-chain guardrails for pinned ADS-B backend refs and optional SHA-256 checks for downloaded runtime assets.
- Added release, contribution and security documentation.
- Added an opt-in HackRF simulator for FM/PMR/AIRBAND/MARITIME development without physical SDR hardware.
- Added Playwright simulator smoke coverage for hardware status, FM audio, retune, spectrum and shutdown flows.
- Added `HACKRF_WEBUI_REPLAY=1` deterministic AIS / ADS-B map feeds with local history fixtures for hardware-free demos and CI.
- Added a redacted `/api/runtime/diagnostics` endpoint for release/support checks without leaking tokens, serials or external paths.
- Added Playwright replay-map and release smoke coverage across main routes, APIs and browser console errors.
