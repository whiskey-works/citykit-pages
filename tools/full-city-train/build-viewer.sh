#!/bin/sh
# Bundle the local train viewer against a CityKit checkout. Run prepare.py first.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
CITYKIT_ROOT=${1:?Usage: build-viewer.sh CITYKIT_ROOT PREVIEW_OUTPUT}
OUT=${2:?Usage: build-viewer.sh CITYKIT_ROOT PREVIEW_OUTPUT}
DEPS=${NODE_MODULES:-$ROOT/node_modules}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/demo" "$TMP/citykit" "$OUT/demo"
cp "$HERE/app.mjs" "$TMP/demo/app.mjs"
cp "$CITYKIT_ROOT"/citykit/streaming/runtime/*.mjs "$TMP/citykit/"
NODE_PATH="$DEPS" "$DEPS/.bin/esbuild" "$TMP/demo/app.mjs" --bundle --format=esm --minify \
  --target=es2022 --legal-comments=none --outfile="$OUT/demo/app.js"
NODE_PATH="$DEPS" "$DEPS/.bin/esbuild" "$TMP/citykit/building-worker.mjs" --bundle --format=esm --minify \
  --target=es2022 --legal-comments=none --outfile="$OUT/demo/building-worker.mjs"
