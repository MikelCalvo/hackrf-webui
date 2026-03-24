#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_HOST="127.0.0.1"
DEFAULT_PORT=3000
MIN_NODE_MAJOR=20

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
SKIP_AIS_MAPS="${SKIP_AIS_MAPS:-0}"
FORCE_REBUILD="${REBUILD:-0}"
AIS_TILE_PACK_URL="${AIS_TILE_PACK_URL:-}"
AIS_TILE_PACK_FILE="${AIS_TILE_PACK_FILE:-}"
AIS_TILE_PACK_REINSTALL="${AIS_TILE_PACK_REINSTALL:-0}"
MAP_PACK_PROFILE="${MAP_PACK_PROFILE:-${AIS_TILE_PACK_PROFILE:-}}"
MAP_PACK_MAX_ZOOM="${MAP_PACK_MAX_ZOOM:-${AIS_TILE_PACK_MAX_ZOOM:-}}"
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
  --skip-ais-maps      Do not install or update the offline map pack.
  --ais-tile-pack-url <url>
                       Download and install a map pack (.zip or .pmtiles source).
  --ais-tile-pack-file <path>
                       Install a map pack from a local .zip or .pmtiles file.
  --reinstall-ais-maps Replace an existing offline map pack.
  --map-profile <name> Select a default offline basemap profile when no source is provided.
  --map-zoom <z>       Force a custom max zoom for the default offline basemap extract.
  --rebuild            Force npm ci and a fresh production build.
  --dry-run            Print the actions without executing them.
  -h, --help           Show this help text.

Environment overrides:
  HOST, PORT, SKIP_SYSTEM_DEPS, SKIP_NPM, SKIP_BUILD, SKIP_AIS_MAPS, REBUILD,
  AIS_TILE_PACK_URL, AIS_TILE_PACK_FILE, AIS_TILE_PACK_REINSTALL,
  AIS_TILE_PACK_MAX_ZOOM, MAP_PACK_MAX_ZOOM, MAP_PACK_PROFILE, DRY_RUN

Default map behavior:
  If no map pack URL or file is provided, start.sh installs a dark offline world
  basemap extracted from the latest Protomaps world archive. In an interactive
  terminal it lets you choose a profile first; otherwise it defaults to the
  "balanced" profile (~1.5 GB, z9).
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

native_binary_path() {
  printf '%s\n' "$ROOT_DIR/bin/hackrf_audio_stream"
}

native_binary_ready() {
  [[ -x "$(native_binary_path)" ]]
}

prod_bundle_ready() {
  [[ -f "$ROOT_DIR/.next/BUILD_ID" ]]
}

ais_tile_pack_manifest_path() {
  printf '%s\n' "$ROOT_DIR/public/tiles/osm/manifest.json"
}

ais_tile_pack_ready() {
  [[ -f "$(ais_tile_pack_manifest_path)" ]]
}

node_modules_ready() {
  [[ -d "$ROOT_DIR/node_modules" && -f "$ROOT_DIR/node_modules/.package-lock.json" ]]
}

interactive_terminal() {
  [[ -t 0 && -t 1 ]]
}

map_profile_zoom() {
  case "$1" in
    compact) printf '%s\n' 8 ;;
    balanced) printf '%s\n' 9 ;;
    detailed) printf '%s\n' 10 ;;
    xdetail) printf '%s\n' 11 ;;
    ultra) printf '%s\n' 12 ;;
    max) printf '%s\n' 13 ;;
    *)
      return 1
      ;;
  esac
}

map_profile_size() {
  case "$1" in
    compact) printf '%s\n' "~526 MB" ;;
    balanced) printf '%s\n' "~1.5 GB" ;;
    detailed) printf '%s\n' "~3.5 GB" ;;
    xdetail) printf '%s\n' "~7.4 GB" ;;
    ultra) printf '%s\n' "~16 GB" ;;
    max) printf '%s\n' "~33 GB" ;;
    *)
      return 1
      ;;
  esac
}

validate_map_zoom() {
  [[ "$1" =~ ^[0-9]+$ ]] || return 1
  (( "$1" >= 0 && "$1" <= 14 ))
}

choose_map_profile_interactive() {
  local choice=""
  local custom_zoom=""

  echo
  log "Choose the default offline basemap profile:"
  printf '  1) compact   %s  world up to z%s\n' "$(map_profile_size compact)" "$(map_profile_zoom compact)"
  printf '  2) balanced  %s  world up to z%s  [default]\n' "$(map_profile_size balanced)" "$(map_profile_zoom balanced)"
  printf '  3) detailed  %s  world up to z%s\n' "$(map_profile_size detailed)" "$(map_profile_zoom detailed)"
  printf '  4) xdetail   %s  world up to z%s\n' "$(map_profile_size xdetail)" "$(map_profile_zoom xdetail)"
  printf '  5) ultra     %s  world up to z%s\n' "$(map_profile_size ultra)" "$(map_profile_zoom ultra)"
  printf '  6) max       %s  world up to z%s\n' "$(map_profile_size max)" "$(map_profile_zoom max)"
  printf '  7) custom    choose your own max zoom\n'
  printf 'Select profile [2]: '
  read -r choice || choice=""

  case "${choice:-2}" in
    1|compact)
      MAP_PACK_PROFILE="compact"
      ;;
    2|balanced|"")
      MAP_PACK_PROFILE="balanced"
      ;;
    3|detailed)
      MAP_PACK_PROFILE="detailed"
      ;;
    4|xdetail)
      MAP_PACK_PROFILE="xdetail"
      ;;
    5|ultra)
      MAP_PACK_PROFILE="ultra"
      ;;
    6|max)
      MAP_PACK_PROFILE="max"
      ;;
    7|custom)
      while true; do
        printf 'Custom max zoom [0-14]: '
        read -r custom_zoom || custom_zoom=""
        if validate_map_zoom "$custom_zoom"; then
          MAP_PACK_PROFILE="custom"
          MAP_PACK_MAX_ZOOM="$custom_zoom"
          break
        fi
        warn "Invalid custom zoom '${custom_zoom}'. Enter a number between 0 and 14."
      done
      ;;
    *)
      warn "Unknown profile selection '${choice}'. Falling back to balanced."
      MAP_PACK_PROFILE="balanced"
      ;;
  esac
}

resolve_map_pack_profile() {
  if [[ -n "$MAP_PACK_MAX_ZOOM" || -n "$AIS_TILE_PACK_URL" || -n "$AIS_TILE_PACK_FILE" ]]; then
    return
  fi

  if [[ -z "$MAP_PACK_PROFILE" ]]; then
    if interactive_terminal; then
      choose_map_profile_interactive
    else
      MAP_PACK_PROFILE="balanced"
    fi
  fi

  if [[ -z "$MAP_PACK_MAX_ZOOM" ]]; then
    MAP_PACK_MAX_ZOOM="$(map_profile_zoom "$MAP_PACK_PROFILE")" \
      || fail "Unknown map profile: $MAP_PACK_PROFILE"
  fi

  validate_map_zoom "$MAP_PACK_MAX_ZOOM" \
    || fail "Invalid MAP_PACK_MAX_ZOOM: $MAP_PACK_MAX_ZOOM"

  if [[ "$MAP_PACK_PROFILE" == "custom" ]]; then
    log "Selected offline basemap profile: custom (z${MAP_PACK_MAX_ZOOM})."
    return
  fi

  log "Selected offline basemap profile: $MAP_PACK_PROFILE ($(map_profile_size "$MAP_PACK_PROFILE"), z${MAP_PACK_MAX_ZOOM})."
}

needs_system_deps() {
  ! node_ok || ! have ffmpeg || ! have hackrf_info || ! have cc || ! have pkg-config || ! hackrf_pkgconfig_ok
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
      --skip-ais-maps)
        SKIP_AIS_MAPS=1
        ;;
      --ais-tile-pack-url)
        shift
        [[ $# -gt 0 ]] || fail "--ais-tile-pack-url requires a value."
        AIS_TILE_PACK_URL="$1"
        ;;
      --ais-tile-pack-url=*)
        AIS_TILE_PACK_URL="${1#*=}"
        ;;
      --ais-tile-pack-file)
        shift
        [[ $# -gt 0 ]] || fail "--ais-tile-pack-file requires a value."
        AIS_TILE_PACK_FILE="$1"
        ;;
      --ais-tile-pack-file=*)
        AIS_TILE_PACK_FILE="${1#*=}"
        ;;
      --reinstall-ais-maps)
        AIS_TILE_PACK_REINSTALL=1
        ;;
      --map-profile)
        shift
        [[ $# -gt 0 ]] || fail "--map-profile requires a value."
        MAP_PACK_PROFILE="$1"
        ;;
      --map-profile=*)
        MAP_PACK_PROFILE="${1#*=}"
        ;;
      --map-zoom)
        shift
        [[ $# -gt 0 ]] || fail "--map-zoom requires a value."
        MAP_PACK_MAX_ZOOM="$1"
        MAP_PACK_PROFILE="custom"
        ;;
      --map-zoom=*)
        MAP_PACK_MAX_ZOOM="${1#*=}"
        MAP_PACK_PROFILE="custom"
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
  run_root apt-get install -y curl ca-certificates gnupg build-essential pkg-config ffmpeg hackrf libhackrf-dev

  if ! node_ok; then
    log "Installing Node.js 22 from NodeSource for Debian/Ubuntu."
    install_nodesource_setup "https://deb.nodesource.com/setup_22.x"
    run_root apt-get install -y nodejs
  fi
}

install_dnf_deps() {
  log "Installing system dependencies with dnf."
  run_root dnf install -y curl ca-certificates gcc gcc-c++ make pkgconf-pkg-config hackrf hackrf-devel

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
  run_root pacman -Sy --noconfirm --needed base-devel pkgconf ffmpeg hackrf nodejs npm
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
  report_line "ffmpeg" "$(command_path ffmpeg || echo missing)"
  report_line "hackrf_info" "$(command_path hackrf_info || echo missing)"
  report_line "cc" "$(command_path cc || echo missing)"
  report_line "pkg-config" "$(command_path pkg-config || echo missing)"

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

  if prod_bundle_ready; then
    report_line "Prod bundle" ".next/BUILD_ID present"
  else
    report_line "Prod bundle" "missing"
  fi

  if ais_tile_pack_ready; then
    report_line "Offline map pack" "$(ais_tile_pack_manifest_path)"
  else
    report_line "Offline map pack" "not installed"
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

install_ais_maps() {
  cd "$ROOT_DIR"

  if [[ "$SKIP_AIS_MAPS" == "1" || "$CHECK_ONLY" == "1" ]]; then
    if [[ "$CHECK_ONLY" == "1" ]]; then
      log "Check mode: offline map-pack installation skipped."
    else
      log "Skipping offline map-pack installation because --skip-ais-maps was requested."
    fi
    return
  fi

  if ais_tile_pack_ready && [[ "$AIS_TILE_PACK_REINSTALL" != "1" ]]; then
    log "Offline map pack already present."
    return
  fi

  resolve_map_pack_profile

  log "Installing offline map pack."
  run env \
    AIS_TILE_PACK_URL="$AIS_TILE_PACK_URL" \
    AIS_TILE_PACK_FILE="$AIS_TILE_PACK_FILE" \
    AIS_TILE_PACK_REINSTALL="$AIS_TILE_PACK_REINSTALL" \
    AIS_TILE_PACK_MAX_ZOOM="$MAP_PACK_MAX_ZOOM" \
    MAP_PACK_PROFILE="$MAP_PACK_PROFILE" \
    node ./scripts/install-ais-map-pack.mjs
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
  report_line "Prod bundle" ".next/BUILD_ID present"
  if ais_tile_pack_ready; then
    report_line "Offline map pack" "$(ais_tile_pack_manifest_path)"
  else
    report_line "Offline map pack" "not installed"
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
    run npm run start -- --hostname "$HOST" --port "$PORT"
    return
  fi
  exec env NEXT_TELEMETRY_DISABLED="$NEXT_TELEMETRY_DISABLED" npm run start -- --hostname "$HOST" --port "$PORT"
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
  install_ais_maps
  build_app
  print_start_summary
  start_app
}

main "$@"
