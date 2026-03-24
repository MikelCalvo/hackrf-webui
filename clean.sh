#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DRY_RUN=0
ASSUME_YES=0

TARGETS=(
  "$ROOT_DIR/node_modules"
  "$ROOT_DIR/.next"
  "$ROOT_DIR/.cache"
  "$ROOT_DIR/bin"
  "$ROOT_DIR/build"
  "$ROOT_DIR/out"
  "$ROOT_DIR/coverage"
  "$ROOT_DIR/.vercel"
  "$ROOT_DIR/public/tiles/osm"
  "$ROOT_DIR/tsconfig.tsbuildinfo"
)

log() {
  printf '[clean] %s\n' "$*"
}

fail() {
  printf '[clean] error: %s\n' "$*" >&2
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
Usage: ./clean.sh [options]

Remove local build/runtime artifacts and leave the repository close to a fresh clone.

This removes only regenerable local outputs such as:
  - node_modules
  - .next
  - .cache
  - bin
  - build / out / coverage / .vercel
  - public/tiles/osm
  - tsconfig.tsbuildinfo

Options:
  --dry-run   Print the actions without deleting anything.
  -y, --yes   Skip the confirmation prompt.
  -h, --help  Show this help text.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        DRY_RUN=1
        ;;
      -y|--yes)
        ASSUME_YES=1
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

collect_existing_targets() {
  local path
  for path in "${TARGETS[@]}"; do
    if [[ -e "$path" ]]; then
      printf '%s\n' "$path"
    fi
  done
}

confirm_cleanup() {
  local -a existing_targets=("$@")
  local answer

  if [[ "$DRY_RUN" == "1" || "$ASSUME_YES" == "1" ]]; then
    return 0
  fi

  if [[ ! -t 0 ]]; then
    fail "Confirmation required. Re-run with --yes in non-interactive mode."
  fi

  echo
  log "This will remove the following local artifacts:"
  printf '  %s\n' "${existing_targets[@]}"
  echo
  printf 'Proceed? [y/N] '
  read -r answer

  case "$answer" in
    y|Y|yes|YES)
      return 0
      ;;
    *)
      log "Cancelled."
      exit 0
      ;;
  esac
}

main() {
  local -a existing_targets

  parse_args "$@"
  mapfile -t existing_targets < <(collect_existing_targets)

  if [[ "${#existing_targets[@]}" -eq 0 ]]; then
    log "Nothing to clean."
    return
  fi

  confirm_cleanup "${existing_targets[@]}"

  local path
  for path in "${existing_targets[@]}"; do
    log "Removing $path"
    run rm -rf "$path"
  done

  log "Done."
}

main "$@"
