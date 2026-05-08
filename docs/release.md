# Release checklist

Use this checklist for tagged releases and GitHub release notes.

## 1. Prepare the tree

```bash
git status --short
npm ci
npm --prefix ./scripts/catalog ci
```

Confirm the version in `package.json` and update `CHANGELOG.md` before tagging.

## 2. Run local gates

```bash
npm run check
npm run build
npm run check:bundle
./start.sh --check --skip-system-deps --skip-maps --skip-adsb-runtime --skip-ai
```

For LAN-mode smoke checks, verify the token guard explicitly:

```bash
./start.sh --check --host 0.0.0.0 --skip-system-deps --skip-maps --skip-adsb-runtime --skip-ai
HACKRF_WEBUI_TOKEN="$(openssl rand -hex 32)" ./start.sh --check --host 0.0.0.0 --skip-system-deps --skip-maps --skip-adsb-runtime --skip-ai
```

The first command should fail with a missing-token error. The second should pass the auth guard and continue with the normal setup report.

## 3. Verify supply-chain inputs

The managed `dump1090-fa` backend is pinned by `DUMP1090_FA_REF`. Use a full 40-character Git SHA for release builds. Optional checksum guards are available for downloaded assets:

```bash
DUMP1090_FA_SHA256=<sha256> ./start.sh --reinstall-adsb-runtime
AI_MODEL_SHA256=<sha256> AI_LABELS_SHA256=<sha256> ./start.sh --reinstall-ai
UV_INSTALL_SCRIPT_SHA256=<sha256> ./start.sh --reinstall-ai
```

If an upstream asset is intentionally unpinned, document why in the release notes and require an explicit opt-out such as `DUMP1090_FA_ALLOW_UNPINNED_REF=1`.

## 4. Package dry-run

```bash
npm pack --dry-run
npm run check:package
```

Confirm the package does not include local runtime artifacts:

- `db/app.sqlite` and SQLite sidecar files
- `data/captures/`
- `runtime/`
- `assets/ai/`
- `public/tiles/osm/`
- `bin/`

## 5. Draft release notes

Include:

- highlights for user-visible modules
- setup or migration notes
- security notes for LAN exposure and token use
- known limitations
- verification commands that passed

## 6. Tag

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main --tags
```
