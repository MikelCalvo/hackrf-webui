#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MAP_PACK_DIR="$ROOT_DIR/public/tiles/osm"
CACHE_DIR="$ROOT_DIR/.cache/ais-map"
DRY_RUN=0

log() {
  printf '[delete-maps] %s\n' "$*"
}

fail() {
  printf '[delete-maps] error: %s\n' "$*" >&2
  exit 1
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

usage() {
  cat <<'EOF'
Usage: ./delete_maps.sh [options]

Options:
  --dry-run   Print the actions without deleting anything.
  -h, --help  Show this help text.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        DRY_RUN=1
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
}

main() {
  parse_args "$@"

  if [[ ! -e "$MAP_PACK_DIR" && ! -e "$CACHE_DIR" ]]; then
    log "No local map files were found."
    return
  fi

  if [[ -e "$MAP_PACK_DIR" ]]; then
    log "Removing offline map pack at $MAP_PACK_DIR"
    run rm -rf "$MAP_PACK_DIR"
  else
    log "Offline map pack directory not present."
  fi

  if [[ -e "$CACHE_DIR" ]]; then
    log "Removing map cache at $CACHE_DIR"
    run rm -rf "$CACHE_DIR"
  else
    log "Map cache directory not present."
  fi

  log "Done."
}

main "$@"
