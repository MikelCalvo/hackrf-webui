#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/bin"

if ! command -v pkg-config >/dev/null 2>&1; then
  echo "pkg-config is not available on this system." >&2
  exit 1
fi

if ! PKG_FLAGS="$(pkg-config --cflags --libs libhackrf 2>/dev/null)"; then
  echo "Could not resolve libhackrf via pkg-config." >&2
  echo "Install the libhackrf development headers before building." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

build_binary() {
  local src="$1"
  local out="$2"

  if [[ ! -f "$src" ]]; then
    echo "Native source file not found: $src" >&2
    exit 1
  fi

  # shellcheck disable=SC2086
  cc -O3 -std=c11 -Wall -Wextra "$src" -o "$out" $PKG_FLAGS -lm
  echo "Binary generated at: $out"
}

build_binary "$ROOT/native/hackrf_audio_stream.c" "$OUT_DIR/hackrf_audio_stream"
build_binary "$ROOT/native/hackrf_ais_stream.c" "$OUT_DIR/hackrf_ais_stream"
