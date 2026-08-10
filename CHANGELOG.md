# Changelog

All notable changes to `hackrf-webui` are tracked here.

## Unreleased

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
