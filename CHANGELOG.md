# Changelog

All notable changes to `hackrf-webui` are tracked here.

## Unreleased

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

## 1.0.0

- Initial public local-first HackRF web UI release with FM, PMR, AIRBAND, MARITIME, AIS, ADS-B and SIGINT workspaces.
