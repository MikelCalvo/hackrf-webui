#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_HOST="127.0.0.1"
DEFAULT_PORT=3000
MIN_NODE_MAJOR=24
MIN_NPM_MAJOR=11
GPSD_HOST="${HACKRF_WEBUI_GPSD_HOST:-127.0.0.1}"
GPSD_PORT="${HACKRF_WEBUI_GPSD_PORT:-2947}"
DB_DIR="${ROOT_DIR}/db"
DB_PATH="${HACKRF_WEBUI_DB_PATH:-${DB_DIR}/app.sqlite}"
CAPTURES_DIR="${ROOT_DIR}/data/captures"
RUNTIME_DIR="${ROOT_DIR}/runtime"
AI_TOOLS_DIR="${RUNTIME_DIR}/tools/uv"
AI_UV_BIN="${AI_TOOLS_DIR}/uv"
AI_PYTHON_DIR="${RUNTIME_DIR}/python"
AI_VENV_DIR="${RUNTIME_DIR}/ai-venv"
AI_CACHE_DIR="${RUNTIME_DIR}/uv-cache"
AI_PYTHON_VERSION="${HACKRF_WEBUI_AI_PYTHON:-3.13}"
AI_SCRIPT_PATH="${ROOT_DIR}/scripts/ai/audio_analyzer.py"
AI_REQUIREMENTS_PATH="${ROOT_DIR}/scripts/ai/requirements.txt"
AI_ASSETS_DIR="${ROOT_DIR}/assets/ai"
AI_VAD_MODEL_PATH="${ROOT_DIR}/assets/ai/silero_vad_v6.onnx"
AI_VAD_SHA256_PATH="${ROOT_DIR}/assets/ai/silero_vad_v6.onnx.sha256"
AI_MODEL_CACHE_DIR="${RUNTIME_DIR}/ai-models"
AI_ASR_MODEL="${HACKRF_WEBUI_AI_ASR_MODEL:-Systran/faster-whisper-base}"
AI_ASR_REVISION="${HACKRF_WEBUI_AI_ASR_REVISION:-ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66}"
AI_REINSTALL="${AI_REINSTALL:-0}"
SKIP_AI="${SKIP_AI:-0}"
UV_INSTALL_SCRIPT_URL="${UV_INSTALL_SCRIPT_URL:-https://astral.sh/uv/install.sh}"

HOST_WAS_SET=0
PORT_WAS_SET=0
if [[ -n "${HOST+x}" ]]; then
  HOST_WAS_SET=1
fi
if [[ -n "${PORT+x}" ]]; then
  PORT_WAS_SET=1
fi

HOST="${HOST:-$DEFAULT_HOST}"
PORT="${PORT:-$DEFAULT_PORT}"
SKIP_SYSTEM_DEPS="${SKIP_SYSTEM_DEPS:-0}"
SKIP_NPM="${SKIP_NPM:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_MAPS="${SKIP_MAPS:-0}"
SKIP_ADSB_RUNTIME="${SKIP_ADSB_RUNTIME:-0}"
FORCE_REBUILD="${REBUILD:-0}"
MAP_REINSTALL="${MAP_REINSTALL:-0}"
MAP_GLOBAL_BUDGET="${MAP_GLOBAL_BUDGET:-4G}"
MAP_GLOBAL_MAX_ZOOM="${MAP_GLOBAL_MAX_ZOOM:-}"
MAP_COUNTRY="${MAP_COUNTRY:-}"
MAP_COUNTRY_MAX_ZOOM="${MAP_COUNTRY_MAX_ZOOM:-14}"
DUMP1090_FA_REINSTALL="${DUMP1090_FA_REINSTALL:-0}"
DUMP1090_FA_REF="${DUMP1090_FA_REF:-4f47d12a18db24238ab2d91c8637dae25937fd98}"
CHECK_ONLY=0
DRY_RUN="${DRY_RUN:-0}"
NEXT_TELEMETRY_DISABLED="${NEXT_TELEMETRY_DISABLED:-1}"

log() {
  printf '[start] %s\n' "$*"
}

warn() {
  printf '[start] warning: %s\n' "$*" >&2
}

fail() {
  printf '[start] error: %s\n' "$*" >&2
  exit 1
}

is_loopback_host() {
  local host="${1,,}"
  host="${host#[}"
  host="${host%]}"

  [[ "$host" == "localhost" ]] \
    || [[ "$host" == *.localhost ]] \
    || [[ "$host" == "127."* ]] \
    || [[ "$host" == "::1" ]] \
    || [[ "$host" == "0:0:0:0:0:0:0:1" ]]
}

api_token_configured() {
  [[ -n "${HACKRF_WEBUI_TOKEN:-}" || -n "${NEXT_PUBLIC_HACKRF_WEBUI_TOKEN:-}" ]]
}

configure_api_security() {
  if [[ -z "${HACKRF_WEBUI_TOKEN:-}" && -n "${NEXT_PUBLIC_HACKRF_WEBUI_TOKEN:-}" ]]; then
    export HACKRF_WEBUI_TOKEN="$NEXT_PUBLIC_HACKRF_WEBUI_TOKEN"
  fi

  if [[ -n "${HACKRF_WEBUI_TOKEN:-}" && -z "${NEXT_PUBLIC_HACKRF_WEBUI_TOKEN:-}" ]]; then
    export NEXT_PUBLIC_HACKRF_WEBUI_TOKEN="$HACKRF_WEBUI_TOKEN"
  fi

  if ! is_loopback_host "$HOST" && ! api_token_configured; then
    fail "Binding to ${HOST} exposes hardware-control APIs; set HACKRF_WEBUI_TOKEN before using --host ${HOST}."
  fi
}

api_auth_status() {
  if api_token_configured; then
    if is_loopback_host "$HOST"; then
      printf '%s\n' "token enabled"
    else
      printf '%s\n' "token required for ${HOST}"
    fi
    return
  fi

  if is_loopback_host "$HOST"; then
    printf '%s\n' "loopback-only without token"
  else
    printf '%s\n' "missing token for ${HOST}"
  fi
}

simulator_enabled() {
  case "${HACKRF_WEBUI_SIMULATOR:-}" in
    1|true|TRUE|yes|YES|y|Y|on|ON|sim|SIM|simulator|SIMULATOR) return 0 ;;
    *) return 1 ;;
  esac
}

simulator_status() {
  if simulator_enabled; then
    printf '%s\n' "enabled"
  else
    printf '%s\n' "disabled"
  fi
}

replay_enabled() {
  case "${HACKRF_WEBUI_REPLAY:-}" in
    1|true|TRUE|yes|YES|y|Y|on|ON|replay|REPLAY) return 0 ;;
    *) return 1 ;;
  esac
}

replay_status() {
  if replay_enabled; then
    printf '%s\n' "enabled"
  else
    printf '%s\n' "disabled"
  fi
}

usage() {
  cat <<'EOF'
Usage: ./start.sh [options]

Options:
  --check              Validate the local setup and print a status report.
  --host <host>        Bind host for the production server.
  --port <port>        Bind port for the production server.
  --skip-system-deps   Do not install system packages.
  --skip-npm           Do not run npm ci.
  --skip-build         Do not run the production build.
  --skip-maps          Do not install or update local offline maps.
  --skip-adsb-runtime  Do not install or update the ADS-B decoder backend.
  --skip-ai            Do not install or update the local SIGINT AI runtime.
  --reinstall-maps     Rebuild the managed offline maps.
  --reinstall-adsb-runtime
                       Rebuild the local dump1090-fa backend.
  --reinstall-ai       Rebuild the local AI runtime and packages.
  --map-global-budget <size>
                       Set the target budget for the global basemap layer. Default: 4G
  --map-global-zoom <z>
                       Force the global basemap max zoom.
  --map-country <value>
                       Add or refresh one high-detail country overlay by id, ISO code or exact name.
  --map-country-zoom <z>
                       Set the country overlay max zoom. Default: 14
  --rebuild            Force npm ci and a fresh production build.
  --dry-run            Print the actions without executing them.
  -h, --help           Show this help text.

Environment overrides:
  HOST, PORT, SKIP_SYSTEM_DEPS, SKIP_NPM, SKIP_BUILD, SKIP_MAPS,
  SKIP_ADSB_RUNTIME, SKIP_AI, REBUILD,
  MAP_REINSTALL, MAP_GLOBAL_BUDGET, MAP_GLOBAL_MAX_ZOOM,
  MAP_COUNTRY, MAP_COUNTRY_MAX_ZOOM,
  DUMP1090_FA_REF, DUMP1090_FA_REINSTALL, DUMP1090_FA_SHA256,
  DUMP1090_FA_ALLOW_UNPINNED_REF, AI_REINSTALL, HACKRF_WEBUI_AI_ASR_MODEL, HACKRF_WEBUI_AI_ASR_REVISION,
  HACKRF_WEBUI_AI_CPU_THREADS, HACKRF_WEBUI_AI_HOTWORDS, HACKRF_WEBUI_AI_PYTHON, UV_INSTALL_SCRIPT_URL,
  UV_INSTALL_SCRIPT_SHA256, DRY_RUN,
  HACKRF_WEBUI_GPSD_HOST, HACKRF_WEBUI_GPSD_PORT,
  HACKRF_WEBUI_DB_PATH, HACKRF_WEBUI_SIMULATOR, HACKRF_WEBUI_REPLAY,
  HACKRF_WEBUI_TOKEN, NEXT_PUBLIC_HACKRF_WEBUI_TOKEN,
  HACKRF_WEBUI_ALLOWED_ORIGINS

Default map behavior:
  start.sh ensures a managed offline map stack based on the latest Protomaps
  world archive. By default it installs a dark global basemap capped near 4 GB.
  If --map-country is provided, it also installs a high-detail overlay for that
  country on top of the shared global layer. In an interactive terminal, if no
  country overlay is installed yet, start.sh offers to configure one.

Security:
  Bind to 127.0.0.1 for local-only use. Binding to a non-loopback host requires
  HACKRF_WEBUI_TOKEN; start.sh mirrors it to NEXT_PUBLIC_HACKRF_WEBUI_TOKEN so
  the browser can authenticate API, SSE and audio-stream requests.

Runtime:
  Requires Node.js 24+ and npm 11+.

Simulator:
  Set HACKRF_WEBUI_SIMULATOR=1 to run FM/PMR/AIRBAND/MARITIME flows without
  a physical HackRF. The app reports a virtual HackRF and generates synthetic
  telemetry, spectrum frames and browser audio for development smoke tests.

Replay:
  Set HACKRF_WEBUI_REPLAY=1 to serve deterministic AIS and ADS-B map feeds
  through the live APIs without starting live RF decoders.
EOF
}

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '+'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi

  "$@"
}

run_root() {
  if [[ "$EUID" -eq 0 ]]; then
    run "$@"
    return
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    fail "sudo is required to install system dependencies."
  fi

  run sudo "$@"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

sha256_file() {
  local path="$1"
  if have sha256sum; then
    sha256sum "$path" | cut -d' ' -f1
    return
  fi

  if have shasum; then
    shasum -a 256 "$path" | cut -d' ' -f1
    return
  fi

  fail "sha256sum or shasum is required to verify downloaded assets."
}

verify_file_sha256() {
  local path="$1"
  local expected="${2,,}"
  local label="$3"
  local actual

  if [[ -z "$expected" ]]; then
    return
  fi

  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || fail "${label} checksum must be a 64-character SHA-256 hex digest."
  actual="$(sha256_file "$path")"
  actual="${actual,,}"
  [[ "$actual" == "$expected" ]] || fail "${label} checksum mismatch: expected ${expected}, got ${actual}."
}

command_path() {
  command -v "$1" 2>/dev/null || true
}

command_display() {
  local resolved
  resolved="$(command_path "$1")"
  if [[ -n "$resolved" ]]; then
    printf '%s\n' "$resolved"
    return
  fi

  printf '%s\n' "missing"
}

node_major() {
  if ! have node; then
    echo 0
    return
  fi

  node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0
}

node_version() {
  if ! have node; then
    echo "missing"
    return
  fi

  node -v
}

npm_version() {
  if ! have npm; then
    echo "missing"
    return
  fi

  npm -v
}

npm_major() {
  if ! have npm; then
    echo 0
    return
  fi

  npm -v | cut -d. -f1 2>/dev/null || echo 0
}

node_ok() {
  have node && have npm && [[ "$(node_major)" -ge "$MIN_NODE_MAJOR" ]] && [[ "$(npm_major)" -ge "$MIN_NPM_MAJOR" ]]
}

hackrf_pkgconfig_ok() {
  have pkg-config && pkg-config --exists libhackrf 2>/dev/null
}

ncurses_build_ok() {
  if ! have cc; then
    return 1
  fi

  local tmpdir
  tmpdir="$(mktemp -d)"
  cat >"$tmpdir/test.c" <<'EOF'
#include <curses.h>
int main(void) { return 0; }
EOF

  if cc "$tmpdir/test.c" -lncurses -o "$tmpdir/test" >/dev/null 2>&1; then
    rm -rf "$tmpdir"
    return 0
  fi

  rm -rf "$tmpdir"
  return 1
}

native_binary_path() {
  printf '%s\n' "$ROOT_DIR/bin/hackrf_audio_stream"
}

ai_python_path() {
  printf '%s\n' "$AI_VENV_DIR/bin/python"
}

native_binary_ready() {
  [[ -x "$(native_binary_path)" ]]
}

adsb_decoder_binary_path() {
  printf '%s\n' "$ROOT_DIR/bin/dump1090-fa"
}

adsb_decoder_ready() {
  [[ -x "$(adsb_decoder_binary_path)" ]]
}

prod_bundle_ready() {
  [[ -f "$ROOT_DIR/.next/BUILD_ID" ]]
}

db_ready() {
  [[ -f "$DB_PATH" ]]
}

ai_runtime_code_ready() {
  [[ -f "$AI_SCRIPT_PATH" && -f "$AI_REQUIREMENTS_PATH" ]]
}

ai_assets_ready() {
  [[ -f "$AI_VAD_MODEL_PATH" && -f "$AI_VAD_SHA256_PATH" ]]
}

uv_ready() {
  [[ -x "$AI_UV_BIN" ]]
}

ai_runtime_ready() {
  [[ -x "$(ai_python_path)" ]] || return 1
  ai_runtime_code_ready || return 1
  ai_assets_ready || return 1

  env PYTHONNOUSERSITE=1 "$(ai_python_path)" "$AI_SCRIPT_PATH" \
    --check \
    --vad-model "$AI_VAD_MODEL_PATH" \
    --model-cache "$AI_MODEL_CACHE_DIR" \
    --asr-model "$AI_ASR_MODEL" \
    --asr-revision "$AI_ASR_REVISION" >/dev/null 2>&1
}

maps_manifest_path() {
  printf '%s\n' "$ROOT_DIR/public/tiles/osm/manifest.json"
}

maps_ready() {
  [[ -f "$(maps_manifest_path)" ]]
}

node_modules_ready() {
  [[ -d "$ROOT_DIR/node_modules" && -f "$ROOT_DIR/node_modules/.package-lock.json" ]]
}

sqlite_addon_probe() {
  (
    cd "$ROOT_DIR"
    node -e 'require("better-sqlite3")'
  ) >/dev/null 2>&1
}

repair_native_node_modules_if_needed() {
  if [[ "$DRY_RUN" == "1" ]]; then
    log "Dry run: native Node addon compatibility check skipped."
    return
  fi

  if ! node_modules_ready; then
    return
  fi

  if sqlite_addon_probe; then
    return
  fi

  if [[ "$SKIP_NPM" == "1" ]]; then
    fail "Native Node modules need a rebuild for Node.js $(node_version), but --skip-npm was requested."
  fi

  log "Detected a native Node addon mismatch for Node.js $(node_version). Rebuilding better-sqlite3."
  if (cd "$ROOT_DIR" && npm rebuild better-sqlite3 >/dev/null); then
    if sqlite_addon_probe; then
      log "Native Node modules rebuilt for the current Node.js runtime."
      return
    fi

    warn "better-sqlite3 rebuilt cleanly but still does not load. Reinstalling Node dependencies."
  else
    warn "better-sqlite3 rebuild failed. Reinstalling Node dependencies."
  fi

  log "Reinstalling Node dependencies for the current Node.js runtime."
  run npm ci

  if sqlite_addon_probe; then
    log "Node dependencies reinstalled for the current Node.js runtime."
    return
  fi

  fail "Node dependencies were reinstalled, but better-sqlite3 still does not load on Node.js $(node_version)."
}

interactive_terminal() {
  [[ -t 0 && -t 1 ]]
}

validate_map_zoom() {
  [[ "$1" =~ ^[0-9]+$ ]] || return 1
  (( "$1" >= 0 && "$1" <= 15 ))
}

maps_have_country_overlays() {
  local manifest_path
  manifest_path="$(maps_manifest_path)"

  if [[ ! -f "$manifest_path" ]]; then
    return 1
  fi

  node - "$manifest_path" <<'EOF' >/dev/null 2>&1
const fs = require("node:fs");

const manifestPath = process.argv[2];
try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const layers = Array.isArray(manifest.layers) ? manifest.layers : [];
  const hasCountry = layers.some((layer) => layer && layer.role === "country");
  process.exit(hasCountry ? 0 : 1);
} catch {
  process.exit(1);
}
EOF
}

prompt_map_country_if_missing() {
  local answer=""
  local country_value=""

  if [[ "$DRY_RUN" == "1" ]]; then
    return
  fi

  if [[ -n "$MAP_COUNTRY" ]]; then
    return
  fi

  if ! interactive_terminal; then
    return
  fi

  if maps_have_country_overlays; then
    return
  fi

  echo
  log "No high-detail country overlay is configured yet."
  printf 'Add one now? [y/N] '
  read -r answer || answer=""

  case "$answer" in
    y|Y|yes|YES)
      ;;
    *)
      return
      ;;
  esac

  while true; do
    printf 'Country id, ISO code or exact name: '
    read -r country_value || country_value=""
    country_value="${country_value#"${country_value%%[![:space:]]*}"}"
    country_value="${country_value%"${country_value##*[![:space:]]}"}"

    if [[ -n "$country_value" ]]; then
      MAP_COUNTRY="$country_value"
      log "Selected high-detail country overlay: $MAP_COUNTRY"
      return
    fi

    warn "Enter a country id, ISO code or exact name, or press Ctrl+C to cancel."
  done
}

needs_system_deps() {
  if simulator_enabled; then
    if [[ "$SKIP_ADSB_RUNTIME" == "1" ]]; then
      ! node_ok
      return
    fi
    if [[ "${DUMP1090_FA_REINSTALL:-0}" != "1" && -x "$(adsb_decoder_binary_path)" ]]; then
      ! node_ok
      return
    fi

    ! node_ok || ! have cc || ! have pkg-config || ! ncurses_build_ok
    return
  fi

  ! node_ok || ! have ffmpeg || ! have hackrf_info || ! have cc || ! have pkg-config || ! hackrf_pkgconfig_ok || ! ncurses_build_ok
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --check)
        CHECK_ONLY=1
        ;;
      --skip-system-deps)
        SKIP_SYSTEM_DEPS=1
        ;;
      --skip-npm)
        SKIP_NPM=1
        ;;
      --skip-build)
        SKIP_BUILD=1
        ;;
      --skip-maps)
        SKIP_MAPS=1
        ;;
      --skip-adsb-runtime)
        SKIP_ADSB_RUNTIME=1
        ;;
      --skip-ai)
        SKIP_AI=1
        ;;
      --reinstall-maps)
        MAP_REINSTALL=1
        ;;
      --reinstall-adsb-runtime)
        DUMP1090_FA_REINSTALL=1
        ;;
      --reinstall-ai)
        AI_REINSTALL=1
        ;;
      --map-global-budget)
        shift
        [[ $# -gt 0 ]] || fail "--map-global-budget requires a value."
        MAP_GLOBAL_BUDGET="$1"
        ;;
      --map-global-budget=*)
        MAP_GLOBAL_BUDGET="${1#*=}"
        ;;
      --map-global-zoom)
        shift
        [[ $# -gt 0 ]] || fail "--map-global-zoom requires a value."
        MAP_GLOBAL_MAX_ZOOM="$1"
        ;;
      --map-global-zoom=*)
        MAP_GLOBAL_MAX_ZOOM="${1#*=}"
        ;;
      --map-country)
        shift
        [[ $# -gt 0 ]] || fail "--map-country requires a value."
        MAP_COUNTRY="$1"
        ;;
      --map-country=*)
        MAP_COUNTRY="${1#*=}"
        ;;
      --map-country-zoom)
        shift
        [[ $# -gt 0 ]] || fail "--map-country-zoom requires a value."
        MAP_COUNTRY_MAX_ZOOM="$1"
        ;;
      --map-country-zoom=*)
        MAP_COUNTRY_MAX_ZOOM="${1#*=}"
        ;;
      --rebuild)
        FORCE_REBUILD=1
        ;;
      --dry-run)
        DRY_RUN=1
        ;;
      --host)
        shift
        [[ $# -gt 0 ]] || fail "--host requires a value."
        HOST="$1"
        HOST_WAS_SET=1
        ;;
      --host=*)
        HOST="${1#*=}"
        HOST_WAS_SET=1
        ;;
      --port)
        shift
        [[ $# -gt 0 ]] || fail "--port requires a value."
        PORT="$1"
        PORT_WAS_SET=1
        ;;
      --port=*)
        PORT="${1#*=}"
        PORT_WAS_SET=1
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "Unknown option: $1"
        ;;
    esac
    shift
  done

  [[ "$PORT" =~ ^[0-9]+$ ]] || fail "Port must be a number."
  (( PORT >= 1 && PORT <= 65535 )) || fail "Port must be between 1 and 65535."
  [[ "$GPSD_PORT" =~ ^[0-9]+$ ]] || fail "HACKRF_WEBUI_GPSD_PORT must be a number."
  (( GPSD_PORT >= 1 && GPSD_PORT <= 65535 )) || fail "HACKRF_WEBUI_GPSD_PORT must be between 1 and 65535."
  [[ "$MAP_COUNTRY_MAX_ZOOM" =~ ^[0-9]+$ ]] || fail "MAP_COUNTRY_MAX_ZOOM must be a number."
  (( MAP_COUNTRY_MAX_ZOOM >= 0 && MAP_COUNTRY_MAX_ZOOM <= 15 )) || fail "MAP_COUNTRY_MAX_ZOOM must be between 0 and 15."
  if [[ -n "$MAP_GLOBAL_MAX_ZOOM" ]]; then
    validate_map_zoom "$MAP_GLOBAL_MAX_ZOOM" || fail "MAP_GLOBAL_MAX_ZOOM must be between 0 and 15."
  fi
}

install_nodesource_setup() {
  local url="$1"
  local tmp
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' RETURN
  run curl -fsSL "$url" -o "$tmp"
  run_root bash "$tmp"
  rm -f "$tmp"
  trap - RETURN
}

install_apt_deps() {
  log "Installing system dependencies with apt."
  run_root apt-get update
  run_root apt-get install -y curl ca-certificates gnupg build-essential pkg-config ffmpeg hackrf libhackrf-dev libncurses-dev python3
  if ! run_root apt-get install -y gpsd gpsd-clients; then
    warn "Could not install gpsd packages with apt. GPS auto-location will stay optional."
  fi

  if ! node_ok; then
    log "Installing Node.js 24 from NodeSource for Debian/Ubuntu."
    install_nodesource_setup "https://deb.nodesource.com/setup_24.x"
    run_root apt-get install -y nodejs
  fi
}

install_dnf_deps() {
  log "Installing system dependencies with dnf."
  run_root dnf install -y curl ca-certificates gcc gcc-c++ make pkgconf-pkg-config hackrf hackrf-devel ncurses-devel python3
  if ! run_root dnf install -y gpsd gpsd-clients; then
    warn "Could not install gpsd packages with dnf. GPS auto-location will stay optional."
  fi

  if ! have ffmpeg; then
    if run_root dnf install -y ffmpeg; then
      :
    else
      run_root dnf install -y ffmpeg-free || fail "Could not install ffmpeg with dnf."
    fi
  fi

  if ! node_ok; then
    log "Installing Node.js 24 from NodeSource for RPM-based systems."
    install_nodesource_setup "https://rpm.nodesource.com/setup_24.x"
    run_root dnf install -y nodejs
  fi
}

install_pacman_deps() {
  log "Installing system dependencies with pacman."
  run_root pacman -Sy --noconfirm --needed base-devel pkgconf ffmpeg hackrf ncurses nodejs npm python
  if ! run_root pacman -Sy --noconfirm --needed gpsd; then
    warn "Could not install gpsd with pacman. GPS auto-location will stay optional."
  fi
}

zypper_install_first_available() {
  local label="$1"
  shift

  local package
  for package in "$@"; do
    if run_root zypper --non-interactive install -y "$package"; then
      return 0
    fi
  done

  fail "Could not install ${label} with zypper."
}

install_zypper_deps() {
  log "Installing system dependencies with zypper."
  run_root zypper --non-interactive refresh
  run_root zypper --non-interactive install -y curl ca-certificates gcc gcc-c++ make python3
  zypper_install_first_available "pkg-config" pkg-config pkgconf pkgconf-pkg-config
  zypper_install_first_available "HackRF userspace tools" hackrf
  zypper_install_first_available "HackRF development headers" hackrf-devel libhackrf-devel
  zypper_install_first_available "ncurses development headers" ncurses-devel ncurses6-devel ncurses5-devel
  if ! run_root zypper --non-interactive install -y gpsd gpsd-clients; then
    warn "Could not install gpsd packages with zypper. GPS auto-location will stay optional."
  fi

  if ! have ffmpeg; then
    zypper_install_first_available "ffmpeg" ffmpeg ffmpeg-8 ffmpeg-7 ffmpeg-5 ffmpeg-4
  fi

  if ! node_ok; then
    zypper_install_first_available "Node.js" nodejs24 nodejs
    if ! have npm; then
      zypper_install_first_available "npm" npm24 npm
    fi
  fi
}

install_system_deps() {
  if [[ "$SKIP_SYSTEM_DEPS" == "1" || "$CHECK_ONLY" == "1" ]]; then
    if [[ "$CHECK_ONLY" == "1" ]]; then
      log "Check mode: system dependency installation skipped."
    else
      log "Skipping system dependency installation because SKIP_SYSTEM_DEPS=1."
    fi
    return
  fi

  if have apt-get; then
    install_apt_deps
    return
  fi

  if have dnf; then
    install_dnf_deps
    return
  fi

  if have pacman; then
    install_pacman_deps
    return
  fi

  if have zypper; then
    install_zypper_deps
    return
  fi

  fail "Unsupported package manager. Install Node.js 24+, npm 11+, ffmpeg, HackRF tools, libhackrf headers, cc, and pkg-config manually."
}

verify_runtime() {
  node_ok || fail "Node.js ${MIN_NODE_MAJOR}+ and npm ${MIN_NPM_MAJOR}+ are required."

  if simulator_enabled; then
    if [[ "$SKIP_ADSB_RUNTIME" != "1" && ( "${DUMP1090_FA_REINSTALL:-0}" == "1" || ! -x "$(adsb_decoder_binary_path)" ) ]]; then
      have cc || fail "A C compiler (cc) is required to build the ADS-B backend. Use --skip-adsb-runtime for simulator-only development."
      have pkg-config || fail "pkg-config is required to build the ADS-B backend. Use --skip-adsb-runtime for simulator-only development."
      ncurses_build_ok || fail "ncurses development headers are required to build the ADS-B backend. Use --skip-adsb-runtime for simulator-only development."
    fi
    return
  fi

  have ffmpeg || fail "ffmpeg is required."
  have hackrf_info || fail "hackrf_info is required."
  have cc || fail "A C compiler (cc) is required."
  have pkg-config || fail "pkg-config is required."
  hackrf_pkgconfig_ok || fail "libhackrf development headers are required and must be visible via pkg-config."
  ncurses_build_ok || fail "ncurses development headers are required to build the ADS-B backend."
}

gpsd_reachable() {
  node - "$GPSD_HOST" "$GPSD_PORT" <<'NODE' >/dev/null 2>&1
const net = require("net");
const [host, portRaw] = process.argv.slice(2);
const port = Number(portRaw);
const socket = net.createConnection({ host, port });
let done = false;

function finish(code) {
  if (done) {
    return;
  }
  done = true;
  socket.destroy();
  process.exit(code);
}

socket.setTimeout(1000);
socket.once("connect", () => finish(0));
socket.once("timeout", () => finish(1));
socket.once("error", () => finish(1));
NODE
}

port_available() {
  local host="$1"
  local port="$2"

  node - "$host" "$port" <<'NODE' >/dev/null 2>&1
const net = require("net");
const [host, portRaw] = process.argv.slice(2);
const port = Number(portRaw);
const server = net.createServer();

server.once("error", () => process.exit(1));
server.once("listening", () => server.close(() => process.exit(0)));
server.listen({ host, port, exclusive: true });
NODE
}

find_available_port() {
  local host="$1"
  local start_port="$2"
  local end_port=$((start_port + 20))
  local candidate

  for ((candidate = start_port; candidate <= end_port; candidate += 1)); do
    if port_available "$host" "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

resolve_port() {
  if port_available "$HOST" "$PORT"; then
    return
  fi

  if [[ "$PORT_WAS_SET" == "1" ]]; then
    fail "Port ${PORT} on ${HOST} is already in use."
  fi

  local next_port
  if ! next_port="$(find_available_port "$HOST" $((PORT + 1)))"; then
    fail "No free port found in the range ${PORT}-${PORT+20}."
  fi

  warn "Port ${PORT} is busy on ${HOST}. Falling back to ${next_port}."
  PORT="$next_port"
}

hackrf_probe_status() {
  if ! have hackrf_info; then
    printf '%s\n' "missing"
    return
  fi

  local output
  local status
  set +e
  output="$(hackrf_info 2>&1)"
  status=$?
  set -e

  if [[ $status -eq 0 ]]; then
    printf '%s\n' "device-detected"
    return
  fi

  if grep -qi "No HackRF boards found" <<<"$output"; then
    printf '%s\n' "tool-ok-no-device"
    return
  fi

  printf '%s\n' "tool-error"
}

gpsd_probe_status() {
  if gpsd_reachable; then
    printf '%s\n' "reachable at ${GPSD_HOST}:${GPSD_PORT}"
    return
  fi

  printf '%s\n' "not reachable at ${GPSD_HOST}:${GPSD_PORT}"
}

install_local_uv() {
  mkdir -p "$AI_TOOLS_DIR"

  if [[ -n "${UV_INSTALL_SCRIPT_SHA256:-}" ]]; then
    local installer_path="${AI_TOOLS_DIR}/uv-install.sh"
    if [[ "$DRY_RUN" == "1" ]]; then
      run curl -fsSL "$UV_INSTALL_SCRIPT_URL" -o "$installer_path"
      run verify_file_sha256 "$installer_path" "$UV_INSTALL_SCRIPT_SHA256" "uv installer"
      run env UV_UNMANAGED_INSTALL="$AI_TOOLS_DIR" sh "$installer_path"
      return
    fi

    curl -fsSL "$UV_INSTALL_SCRIPT_URL" -o "$installer_path.tmp"
    verify_file_sha256 "$installer_path.tmp" "$UV_INSTALL_SCRIPT_SHA256" "uv installer"
    mv "$installer_path.tmp" "$installer_path"
    env UV_UNMANAGED_INSTALL="$AI_TOOLS_DIR" sh "$installer_path"
    return
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    run env UV_UNMANAGED_INSTALL="$AI_TOOLS_DIR" sh -c "curl -fsSL \"$UV_INSTALL_SCRIPT_URL\" | sh"
    return
  fi

  env UV_UNMANAGED_INSTALL="$AI_TOOLS_DIR" sh -c "curl -fsSL \"$UV_INSTALL_SCRIPT_URL\" | sh"
}

download_ai_asset() {
  local url="$1"
  local destination="$2"
  local label="$3"
  local expected_sha256="${4:-}"
  local tmp="${destination}.tmp"

  mkdir -p "$(dirname "$destination")"

  if [[ "$DRY_RUN" == "1" ]]; then
    run curl -fsSL "$url" -o "$destination"
    run verify_file_sha256 "$destination" "$expected_sha256" "$label"
    return
  fi

  log "Downloading ${label}."
  curl -fsSL "$url" -o "$tmp"
  verify_file_sha256 "$tmp" "$expected_sha256" "$label"
  mv "$tmp" "$destination"
}

ensure_ai_assets() {
  if [[ "$SKIP_AI" == "1" || "$CHECK_ONLY" == "1" ]]; then
    return
  fi

  mkdir -p "$AI_ASSETS_DIR"
  [[ -f "$AI_VAD_MODEL_PATH" ]] || fail "The bundled Silero VAD model is missing: $AI_VAD_MODEL_PATH"
  [[ -f "$AI_VAD_SHA256_PATH" ]] || fail "The Silero VAD checksum is missing: $AI_VAD_SHA256_PATH"
  if [[ "$DRY_RUN" != "1" ]]; then
    (cd "$AI_ASSETS_DIR" && sha256sum --check "$(basename "$AI_VAD_SHA256_PATH")" >/dev/null) \
      || fail "The bundled Silero VAD model failed checksum verification."
  fi
}

ensure_local_uv() {
  if uv_ready; then
    return
  fi

  log "Installing a local uv toolchain under runtime/tools/uv."
  install_local_uv
  if [[ "$DRY_RUN" == "1" ]]; then
    return
  fi
  uv_ready || fail "Local uv bootstrap failed."
}

install_ai_runtime() {
  cd "$ROOT_DIR"

  if [[ "$SKIP_AI" == "1" || "$CHECK_ONLY" == "1" ]]; then
    if [[ "$CHECK_ONLY" == "1" ]]; then
      log "Check mode: local AI runtime installation skipped."
    else
      log "Skipping local AI runtime because --skip-ai was requested."
    fi
    return
  fi

  ai_runtime_code_ready || fail "The local AI scripts or requirements are missing from the repository."
  ensure_ai_assets

  mkdir -p "$RUNTIME_DIR" "$AI_PYTHON_DIR" "$AI_CACHE_DIR" "$AI_MODEL_CACHE_DIR"
  ensure_local_uv

  if [[ "$AI_REINSTALL" == "1" ]]; then
    log "Reinstalling the local SIGINT AI runtime."
    run rm -rf "$AI_VENV_DIR" "$AI_CACHE_DIR"
    run mkdir -p "$AI_CACHE_DIR"
  fi

  log "Ensuring local Python ${AI_PYTHON_VERSION} for the AI runtime."
  run env \
    UV_CACHE_DIR="$AI_CACHE_DIR" \
    UV_LINK_MODE=copy \
    "$AI_UV_BIN" python install \
    --install-dir "$AI_PYTHON_DIR" \
    --no-bin \
    "$AI_PYTHON_VERSION"

  if [[ ! -x "$(ai_python_path)" ]]; then
    log "Creating the local AI virtual environment."
    run env \
      UV_CACHE_DIR="$AI_CACHE_DIR" \
      UV_LINK_MODE=copy \
      UV_PYTHON_INSTALL_DIR="$AI_PYTHON_DIR" \
      "$AI_UV_BIN" venv \
      --python "$AI_PYTHON_VERSION" \
      "$AI_VENV_DIR"
  fi

  log "Synchronizing the pinned local SIGINT AI packages."
  run env \
    UV_CACHE_DIR="$AI_CACHE_DIR" \
    UV_LINK_MODE=copy \
    UV_PYTHON_INSTALL_DIR="$AI_PYTHON_DIR" \
    "$AI_UV_BIN" pip sync \
    --python "$(ai_python_path)" \
    --require-hashes \
    "$AI_REQUIREMENTS_PATH"

  if [[ "$DRY_RUN" == "1" ]]; then
    log "Dry run: local SIGINT AI runtime self-check skipped."
    return
  fi

  if ! ai_runtime_ready; then
    log "Preparing the local multilingual speech model (${AI_ASR_MODEL})."
    env PYTHONNOUSERSITE=1 "$(ai_python_path)" "$AI_SCRIPT_PATH" \
      --prepare \
      --vad-model "$AI_VAD_MODEL_PATH" \
      --model-cache "$AI_MODEL_CACHE_DIR" \
      --asr-model "$AI_ASR_MODEL" \
      --asr-revision "$AI_ASR_REVISION"
  fi

  ai_runtime_ready || fail "Local SIGINT AI runtime failed its self-check."

  log "Removing the temporary AI package cache."
  rm -rf "$AI_CACHE_DIR"
  mkdir -p "$AI_CACHE_DIR"
}

report_line() {
  printf '  %-18s %s\n' "$1" "$2"
}

print_status_report() {
  local port_status
  local hackrf_status
  local issues=0

  echo
  log "Setup report"
  report_line "Node.js" "$(node_version)"
  report_line "npm" "$(npm_version)"
  report_line "ffmpeg" "$(command_display ffmpeg)"
  report_line "hackrf_info" "$(command_display hackrf_info)"
  report_line "gpsd" "$(command_display gpsd)"
  report_line "cc" "$(command_display cc)"
  report_line "pkg-config" "$(command_display pkg-config)"
  report_line "GPSD daemon" "$(gpsd_probe_status)"
  report_line "RF simulator" "$(simulator_status)"
  report_line "Replay feeds" "$(replay_status)"
  report_line "SQLite DB" "$(db_ready && printf '%s' "$DB_PATH" || printf '%s' 'not initialized yet')"
  report_line "API auth" "$(api_auth_status)"
  report_line "Capture store" "$CAPTURES_DIR"
  report_line "AI assets" "$(ai_assets_ready && printf '%s' "$AI_VAD_MODEL_PATH" || printf '%s' 'missing')"
  report_line "AI Python" "$([[ -x "$(ai_python_path)" ]] && printf '%s' "$(ai_python_path)" || printf '%s' 'missing')"
  report_line "AI runtime" "$(ai_runtime_ready && printf '%s' 'ready' || printf '%s' 'not initialized yet')"

  if simulator_enabled; then
    report_line "libhackrf" "not required in simulator mode"
  elif hackrf_pkgconfig_ok; then
    report_line "libhackrf" "ok"
  else
    report_line "libhackrf" "missing"
    issues=1
  fi

  if native_binary_ready; then
    report_line "Native binary" "$(native_binary_path)"
  elif simulator_enabled; then
    report_line "Native binary" "not required in simulator mode"
  else
    report_line "Native binary" "missing"
  fi

  if adsb_decoder_ready; then
    report_line "ADS-B backend" "$(adsb_decoder_binary_path)"
  else
    report_line "ADS-B backend" "missing"
  fi

  if prod_bundle_ready; then
    report_line "Prod bundle" ".next/BUILD_ID present"
  else
    report_line "Prod bundle" "missing"
  fi

  if maps_ready; then
    report_line "Offline maps" "$(maps_manifest_path)"
  else
    report_line "Offline maps" "not installed"
  fi

  if node_ok; then
    if port_available "$HOST" "$PORT"; then
      port_status="available at ${HOST}:${PORT}"
    elif [[ "$PORT_WAS_SET" == "1" ]]; then
      port_status="busy at ${HOST}:${PORT}"
      issues=1
    else
      local next_port
      next_port="$(find_available_port "$HOST" $((PORT + 1)) || true)"
      if [[ -n "$next_port" ]]; then
        port_status="busy at ${HOST}:${PORT}, next free ${HOST}:${next_port}"
      else
        port_status="busy at ${HOST}:${PORT}, no fallback found"
        issues=1
      fi
    fi
  else
    port_status="not checked"
  fi
  report_line "Port" "$port_status"

  if simulator_enabled; then
    report_line "HackRF device" "virtual simulator"
  else
    hackrf_status="$(hackrf_probe_status)"
    case "$hackrf_status" in
      device-detected)
        report_line "HackRF device" "detected"
        ;;
      tool-ok-no-device)
        report_line "HackRF device" "not detected right now"
        ;;
      tool-error)
        report_line "HackRF device" "tool present but probe failed"
        ;;
      *)
        report_line "HackRF device" "not checked"
        ;;
    esac
  fi

  if ! node_ok; then
    issues=1
  fi
  if simulator_enabled; then
    if [[ "$SKIP_ADSB_RUNTIME" != "1" && ( "${DUMP1090_FA_REINSTALL:-0}" == "1" || ! -x "$(adsb_decoder_binary_path)" ) ]]; then
      have cc || issues=1
      have pkg-config || issues=1
      ncurses_build_ok || issues=1
    fi
  else
    have ffmpeg || issues=1
    have hackrf_info || issues=1
    have cc || issues=1
    have pkg-config || issues=1
    ncurses_build_ok || issues=1
  fi

  return "$issues"
}

install_node_modules() {
  cd "$ROOT_DIR"

  if [[ "$SKIP_NPM" == "1" ]]; then
    node_modules_ready || fail "node_modules is missing and --skip-npm was requested."
    log "Skipping npm install because --skip-npm was requested."
    return
  fi

  if [[ "$FORCE_REBUILD" == "1" ]]; then
    log "Reinstalling Node dependencies."
    run npm ci
    return
  fi

  if [[ ! -d node_modules || ! -f node_modules/.package-lock.json || package-lock.json -nt node_modules/.package-lock.json ]]; then
    log "Installing Node dependencies."
    run npm ci
  else
    log "Node dependencies already look up to date."
  fi
}

prepare_local_storage() {
  cd "$ROOT_DIR"

  log "Preparing local runtime storage."
  run mkdir -p "$DB_DIR" "$CAPTURES_DIR"
  run npm run db:migrate
}

install_maps() {
  cd "$ROOT_DIR"

  if [[ "$SKIP_MAPS" == "1" || "$CHECK_ONLY" == "1" ]]; then
    if [[ "$CHECK_ONLY" == "1" ]]; then
      log "Check mode: offline map installation skipped."
    else
      log "Skipping offline map installation because --skip-maps was requested."
    fi
    return
  fi

  prompt_map_country_if_missing

  local -a map_args=(
    ./manage_maps.sh
    ensure
    --global-budget "$MAP_GLOBAL_BUDGET"
    --country-max-zoom "$MAP_COUNTRY_MAX_ZOOM"
  )

  if [[ -n "$MAP_GLOBAL_MAX_ZOOM" ]]; then
    map_args+=(--global-max-zoom "$MAP_GLOBAL_MAX_ZOOM")
  fi

  if [[ -n "$MAP_COUNTRY" ]]; then
    map_args+=(--country "$MAP_COUNTRY")
  fi

  if [[ "$MAP_REINSTALL" == "1" ]]; then
    map_args+=(--reinstall)
  fi

  log "Ensuring offline maps."
  run "${map_args[@]}"
}

install_adsb_runtime() {
  cd "$ROOT_DIR"

  if [[ "$SKIP_ADSB_RUNTIME" == "1" || "$CHECK_ONLY" == "1" ]]; then
    if [[ "$CHECK_ONLY" == "1" ]]; then
      log "Check mode: ADS-B backend installation skipped."
    else
      log "Skipping ADS-B backend installation because --skip-adsb-runtime was requested."
    fi
    return
  fi

  if adsb_decoder_ready && [[ "$DUMP1090_FA_REINSTALL" != "1" ]]; then
    log "ADS-B backend already present."
    return
  fi

  log "Installing ADS-B backend."
  run env \
    DUMP1090_FA_REF="$DUMP1090_FA_REF" \
    DUMP1090_FA_REINSTALL="$DUMP1090_FA_REINSTALL" \
    node ./scripts/install-dump1090-fa.mjs
}

build_app() {
  cd "$ROOT_DIR"

  if [[ "$SKIP_BUILD" == "1" ]]; then
    if ! simulator_enabled; then
      native_binary_ready || fail "Native binary is missing and --skip-build was requested."
    fi
    prod_bundle_ready || fail "Production build is missing and --skip-build was requested."
    log "Skipping build because --skip-build was requested."
    return
  fi

  if [[ "$FORCE_REBUILD" == "1" ]]; then
    log "Clearing previous Next.js build output."
    run npm run clean
  fi

  if simulator_enabled; then
    log "Building production bundle for simulator mode; native HackRF binaries are not required."
    run npm run build:web
    return
  fi

  log "Building native binary and production bundle."
  run npm run build
}

print_start_summary() {
  echo
  log "Startup summary"
  report_line "URL" "http://${HOST}:${PORT}"
  report_line "Node.js" "$(node_version)"
  report_line "npm" "$(npm_version)"
  if simulator_enabled && ! native_binary_ready; then
    report_line "Native binary" "not required in simulator mode"
  else
    report_line "Native binary" "$(native_binary_path)"
  fi
  report_line "ADS-B backend" "$(adsb_decoder_binary_path)"
  report_line "Prod bundle" ".next/BUILD_ID present"
  report_line "SQLite DB" "$DB_PATH"
  report_line "API auth" "$(api_auth_status)"
  report_line "RF simulator" "$(simulator_status)"
  report_line "Replay feeds" "$(replay_status)"
  report_line "Capture store" "$CAPTURES_DIR"
  report_line "AI Python" "$([[ -x "$(ai_python_path)" ]] && printf '%s' "$(ai_python_path)" || printf '%s' 'missing')"
  report_line "AI runtime" "$(ai_runtime_ready && printf '%s' 'ready' || printf '%s' 'not initialized yet')"
  report_line "gpsd" "$(command_display gpsd)"
  report_line "GPSD daemon" "$(gpsd_probe_status)"
  if maps_ready; then
    report_line "Offline maps" "$(maps_manifest_path)"
  else
    report_line "Offline maps" "not installed"
  fi

  if simulator_enabled; then
    report_line "HackRF device" "virtual simulator"
  else
    case "$(hackrf_probe_status)" in
      device-detected)
        report_line "HackRF device" "detected"
        ;;
      tool-ok-no-device)
        report_line "HackRF device" "not detected right now"
        ;;
      tool-error)
        report_line "HackRF device" "tool present but probe failed"
        ;;
      *)
        report_line "HackRF device" "not checked"
        ;;
    esac
  fi
}

start_app() {
  cd "$ROOT_DIR"
  log "Starting hackrf-webui in production mode."
  if [[ "$DRY_RUN" == "1" ]]; then
    run env \
      NEXT_TELEMETRY_DISABLED="$NEXT_TELEMETRY_DISABLED" \
      HACKRF_WEBUI_TOKEN="${HACKRF_WEBUI_TOKEN:-}" \
      NEXT_PUBLIC_HACKRF_WEBUI_TOKEN="${NEXT_PUBLIC_HACKRF_WEBUI_TOKEN:-}" \
      HACKRF_WEBUI_ALLOWED_ORIGINS="${HACKRF_WEBUI_ALLOWED_ORIGINS:-}" \
      HACKRF_WEBUI_SIMULATOR="${HACKRF_WEBUI_SIMULATOR:-}" \
      HACKRF_WEBUI_GPSD_HOST="$GPSD_HOST" \
      HACKRF_WEBUI_GPSD_PORT="$GPSD_PORT" \
      npm run start -- --hostname "$HOST" --port "$PORT"
    return
  fi
  exec env \
    NEXT_TELEMETRY_DISABLED="$NEXT_TELEMETRY_DISABLED" \
    HACKRF_WEBUI_TOKEN="${HACKRF_WEBUI_TOKEN:-}" \
    NEXT_PUBLIC_HACKRF_WEBUI_TOKEN="${NEXT_PUBLIC_HACKRF_WEBUI_TOKEN:-}" \
    HACKRF_WEBUI_ALLOWED_ORIGINS="${HACKRF_WEBUI_ALLOWED_ORIGINS:-}" \
    HACKRF_WEBUI_SIMULATOR="${HACKRF_WEBUI_SIMULATOR:-}" \
    HACKRF_WEBUI_GPSD_HOST="$GPSD_HOST" \
    HACKRF_WEBUI_GPSD_PORT="$GPSD_PORT" \
    npm run start -- --hostname "$HOST" --port "$PORT"
}

main() {
  parse_args "$@"
  configure_api_security
  trap 'warn "Interrupted."; exit 130' INT TERM

  log "Preparing hackrf-webui."

  if [[ "$CHECK_ONLY" == "1" ]]; then
    if needs_system_deps; then
      warn "Some required dependencies are missing."
    fi
    print_status_report
    exit $?
  fi

  if needs_system_deps; then
    install_system_deps
  else
    log "System dependencies already look installed."
  fi

  verify_runtime
  resolve_port
  install_node_modules
  repair_native_node_modules_if_needed
  prepare_local_storage
  install_maps
  install_adsb_runtime
  install_ai_runtime
  build_app
  print_start_summary
  start_app
}

main "$@"
