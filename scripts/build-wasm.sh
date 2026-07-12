#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GOROOT_PATH="$(go env GOROOT)"
GO_BUILD_CACHE="$ROOT/.cache/go-build"
mkdir -p "$GO_BUILD_CACHE"

# Go has moved wasm_exec.js location over versions. Support both common locations.
if [[ -f "$GOROOT_PATH/lib/wasm/wasm_exec.js" ]]; then
  cp "$GOROOT_PATH/lib/wasm/wasm_exec.js" "$ROOT/public/wasm_exec.js"
elif [[ -f "$GOROOT_PATH/misc/wasm/wasm_exec.js" ]]; then
  cp "$GOROOT_PATH/misc/wasm/wasm_exec.js" "$ROOT/public/wasm_exec.js"
else
  echo "Cannot find wasm_exec.js in $GOROOT_PATH" >&2
  exit 1
fi

# -trimpath keeps absolute build paths (and the developer's username) out of the
# committed binary; the embedded source paths become module-relative instead.
GO111MODULE=on GOCACHE="$GO_BUILD_CACHE" GOOS=js GOARCH=wasm go build -trimpath -o "$ROOT/public/sim.wasm" "$ROOT/wasm/sim"
echo "Built public/sim.wasm"
