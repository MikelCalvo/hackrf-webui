#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_HOST="127.0.0.1"
DEFAULT_PORT=3000
MIN_NODE_MAJOR=20
GPSD_HOST="${HACKRF_WEBUI_GPSD_HOST:-127.0.0.1}"
GPSD_PORT="${HACKRF_WEBUI_GPSD_PORT:-2947}"
DB_DIR="${ROOT_DIR}/db"
DB_PATH="${HACKRF_WEBUI_DB_PATH:-${DB_DIR}/app.sqlite}"
CAPTURES_DIR="${ROOT_DIR}/data/captures"

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
  --reinstall-maps     Rebuild the managed offline maps.
  --reinstall-adsb-runtime
                       Rebuild the local dump1090-fa backend.
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
  SKIP_ADSB_RUNTIME, REBUILD,
  MAP_REINSTALL, MAP_GLOBAL_BUDGET, MAP_GLOBAL_MAX_ZOOM,
  MAP_COUNTRY, MAP_COUNTRY_MAX_ZOOM,
  DUMP1090_FA_REF, DUMP1090_FA_REINSTALL, DRY_RUN,
  HACKRF_WEBUI_GPSD_HOST, HACKRF_WEBUI_GPSD_PORT
  HACKRF_WEBUI_DB_PATH

Default map behavior:
  start.sh ensures a managed offline map stack based on the latest Protomaps
  world archive. By default it installs a dark global basemap capped near 4 GB.
  If --map-country is provided, it also installs a high-detail overlay for that
  country on top of the shared global layer. In an interactive terminal, if no
  country overlay is installed yet, start.sh offers to configure one.
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

node_ok() {
  have node && have npm && [[ "$(node_major)" -ge "$MIN_NODE_MAJOR" ]]
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
      --reinstall-maps)
        MAP_REINSTALL=1
        ;;
      --reinstall-adsb-runtime)
        DUMP1090_FA_REINSTALL=1
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
  run_root apt-get install -y curl ca-certificates gnupg build-essential pkg-config ffmpeg hackrf libhackrf-dev libncurses-dev
  if ! run_root apt-get install -y gpsd gpsd-clients; then
    warn "Could not install gpsd packages with apt. GPS auto-location will stay optional."
  fi

  if ! node_ok; then
    log "Installing Node.js 22 from NodeSource for Debian/Ubuntu."
    install_nodesource_setup "https://deb.nodesource.com/setup_22.x"
    run_root apt-get install -y nodejs
  fi
}

install_dnf_deps() {
  log "Installing system dependencies with dnf."
  run_root dnf install -y curl ca-certificates gcc gcc-c++ make pkgconf-pkg-config hackrf hackrf-devel ncurses-devel
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
    log "Installing Node.js 22 from NodeSource for RPM-based systems."
    install_nodesource_setup "https://rpm.nodesource.com/setup_22.x"
    run_root dnf install -y nodejs
  fi
}

install_pacman_deps() {
  log "Installing system dependencies with pacman."
  run_root pacman -Sy --noconfirm --needed base-devel pkgconf ffmpeg hackrf ncurses nodejs npm
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
  run_root zypper --non-interactive install -y curl ca-certificates gcc gcc-c++ make
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
    zypper_install_first_available "Node.js" nodejs22 nodejs20 nodejs
    if ! have npm; then
      zypper_install_first_available "npm" npm22 npm20 npm
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

  fail "Unsupported package manager. Install Node.js 20+, npm, ffmpeg, HackRF tools, libhackrf headers, cc, and pkg-config manually."
}

verify_runtime() {
  node_ok || fail "Node.js ${MIN_NODE_MAJOR}+ and npm are required."
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
  report_line "SQLite DB" "$(db_ready && printf '%s' "$DB_PATH" || printf '%s' 'not initialized yet')"
  report_line "Capture store" "$CAPTURES_DIR"

  if hackrf_pkgconfig_ok; then
    report_line "libhackrf" "ok"
  else
    report_line "libhackrf" "missing"
    issues=1
  fi

  if native_binary_ready; then
    report_line "Native binary" "$(native_binary_path)"
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

  if ! node_ok; then
    issues=1
  fi
  have ffmpeg || issues=1
  have hackrf_info || issues=1
  have cc || issues=1
  have pkg-config || issues=1
  ncurses_build_ok || issues=1

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
    native_binary_ready || fail "Native binary is missing and --skip-build was requested."
    prod_bundle_ready || fail "Production build is missing and --skip-build was requested."
    log "Skipping build because --skip-build was requested."
    return
  fi

  if [[ "$FORCE_REBUILD" == "1" ]]; then
    log "Clearing previous Next.js build output."
    run npm run clean
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
  report_line "Native binary" "$(native_binary_path)"
  report_line "ADS-B backend" "$(adsb_decoder_binary_path)"
  report_line "Prod bundle" ".next/BUILD_ID present"
  report_line "SQLite DB" "$DB_PATH"
  report_line "Capture store" "$CAPTURES_DIR"
  report_line "gpsd" "$(command_display gpsd)"
  report_line "GPSD daemon" "$(gpsd_probe_status)"
  if maps_ready; then
    report_line "Offline maps" "$(maps_manifest_path)"
  else
    report_line "Offline maps" "not installed"
  fi

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
}

start_app() {
  cd "$ROOT_DIR"
  log "Starting hackrf-webui in production mode."
  if [[ "$DRY_RUN" == "1" ]]; then
    run env \
      NEXT_TELEMETRY_DISABLED="$NEXT_TELEMETRY_DISABLED" \
      HACKRF_WEBUI_GPSD_HOST="$GPSD_HOST" \
      HACKRF_WEBUI_GPSD_PORT="$GPSD_PORT" \
      npm run start -- --hostname "$HOST" --port "$PORT"
    return
  fi
  exec env \
    NEXT_TELEMETRY_DISABLED="$NEXT_TELEMETRY_DISABLED" \
    HACKRF_WEBUI_GPSD_HOST="$GPSD_HOST" \
    HACKRF_WEBUI_GPSD_PORT="$GPSD_PORT" \
    npm run start -- --hostname "$HOST" --port "$PORT"
}

main() {
  parse_args "$@"
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
  build_app
  print_start_summary
  start_app
}

main "$@"
