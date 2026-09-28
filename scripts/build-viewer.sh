#!/bin/sh
# Rebuild the self-contained viewer from the reviewed app source and a CityKit checkout.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CITYKIT_ROOT=${1:?Usage: scripts/build-viewer.sh CITYKIT_ROOT}
DEPS=${NODE_MODULES:-$ROOT/node_modules}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/demo" "$TMP/citykit"
cp "$ROOT/src/demo/app.mjs" "$TMP/demo/app.mjs"
cp "$CITYKIT_ROOT"/citykit/streaming/runtime/*.mjs "$TMP/citykit/"
NODE_PATH="$DEPS" "$DEPS/.bin/esbuild" "$TMP/demo/app.mjs" --bundle --format=esm --minify \
  --target=es2022 --legal-comments=none --outfile="$ROOT/site/demo/app.js"
NODE_PATH="$DEPS" "$DEPS/.bin/esbuild" "$TMP/citykit/building-worker.mjs" --bundle --format=esm --minify \
  --target=es2022 --legal-comments=none --outfile="$ROOT/site/demo/building-worker.mjs"
