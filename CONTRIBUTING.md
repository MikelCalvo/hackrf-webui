# Contributing

Thanks for improving `hackrf-webui`. Keep changes small, reproducible and safe for local radio operation.

## Local setup

```bash
npm ci
npm run dev
```

Open `http://localhost:3000` for development.

## Verification before a PR

Run the full local gate before sending changes:

```bash
npm run check
npm run build
npm run check:bundle
npm run test:e2e
./start.sh --check --skip-system-deps --skip-maps --skip-adsb-runtime --skip-ai
```

`npm run check` covers:

- ESLint
- clean TypeScript check
- Node test suite
- FM catalog manifest/shard checks
- shell/Python syntax checks
- root and catalog package audits
- package dry-run checks for generated runtime artifacts
- Playwright simulator E2E smoke coverage (`npm run test:e2e`)

`npm run build` still matters because it compiles the native HackRF receiver and creates Next.js route/bundle diagnostics used by `npm run check:bundle`.

## Security expectations

- Do not commit runtime data, captures, databases, AI assets, map packs or generated binaries.
- Do not commit tokens, credentials, private hostnames or real operator locations.
- Keep remote/LAN access guarded. Non-loopback use should include `HACKRF_WEBUI_TOKEN` and, where needed, `HACKRF_WEBUI_ALLOWED_ORIGINS`.
- Treat RF captures and decoded route history as sensitive local evidence.

## Dependency and supply-chain changes

- Prefer pinned immutable refs for downloaded source archives.
- If a download has a published checksum, document and wire it through the relevant `*_SHA256` environment variable.
- Run both audits:

```bash
npm audit --audit-level=high
npm --prefix ./scripts/catalog audit --audit-level=high
```

## Commit hygiene

Group related work into logical commits. A good split is usually:

1. tooling / CI / tests
2. runtime or API behavior
3. docs / release metadata

Avoid noisy formatting-only churn in large UI files unless the change specifically needs it.
