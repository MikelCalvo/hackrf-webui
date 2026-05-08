# Security Policy

`hackrf-webui` is a local-first HackRF control surface. It can start receivers, tune radios, stream audio, persist captures and write a local SQLite database, so treat it as an operator console rather than a public web app.

## Supported versions

Security fixes target the current `main` branch and the latest tagged release.

## Network exposure

The default bind address is local-only:

```bash
./start.sh
# http://127.0.0.1:3000
```

Binding to a non-loopback host exposes hardware-control APIs. `start.sh` refuses that mode unless a token is configured:

```bash
HACKRF_WEBUI_TOKEN="$(openssl rand -hex 32)" ./start.sh --host 0.0.0.0 --port 4000
```

When `HACKRF_WEBUI_TOKEN` is set, the server accepts either:

- `Authorization: Bearer <token>`
- `X-HackRF-WebUI-Token: <token>`
- `apiToken=<token>` query parameter for browser-only transports that cannot set headers, such as `EventSource` and `<audio>` streams

For browser sessions, `start.sh` mirrors `HACKRF_WEBUI_TOKEN` into `NEXT_PUBLIC_HACKRF_WEBUI_TOKEN` before the production build so the UI can call protected APIs. That means the token is visible to anyone who can load the app. It is a CSRF / drive-by protection mechanism for a trusted LAN, not multi-user authentication.

Do not expose `hackrf-webui` directly to the internet. If remote access is needed, put it behind a VPN, SSH tunnel or authenticated reverse proxy, and use HTTPS at that boundary.

Optional cross-origin allow-list:

```bash
HACKRF_WEBUI_ALLOWED_ORIGINS="https://radio.example.net" ./start.sh
```

Without an allow-list, unsafe cross-origin API requests are rejected unless they come from the same origin.

## Sensitive local data

The app stores local evidence and runtime state under the repository tree:

- `db/app.sqlite`
- `data/captures/`
- `assets/ai/`
- `runtime/`
- `public/tiles/osm/`

Do not commit those paths. Captures can contain sensitive RF activity, audio and location metadata.

## Reporting a vulnerability

Please do not file public issues for security-sensitive reports. Use GitHub private vulnerability reporting if available for the repository, or contact the maintainer privately with:

- affected version / commit
- reproduction steps
- expected impact
- whether any exploit code or captured data is included

Keep reports free of real API tokens, private captures and precise operating locations unless they are necessary and redacted.
