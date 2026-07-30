#!/bin/sh
# Builds the sibling @nodal/ui component library (/srv/nodal-ui) and copies its
# package output into frontend/vendor/nodal-ui, so the noas Docker build (whose
# context is just /srv/noas) can install it as a plain `file:` dependency
# without needing a build context that spans multiple sibling repos.
#
# Run this before `docker build` whenever nodal-ui has changed.
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
NOAS_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
NODAL_UI_DIR="$NOAS_DIR/../nodal-ui"
VENDOR_DIR="$NOAS_DIR/frontend/vendor/nodal-ui"

if [ ! -d "$NODAL_UI_DIR" ]; then
  echo "error: expected nodal-ui checkout at $NODAL_UI_DIR" >&2
  exit 1
fi

docker run --rm -v "$NODAL_UI_DIR:/app" -w /app node:20-alpine sh -c \
  "npm install --no-audit --no-fund >/dev/null 2>&1 && npx svelte-package -o dist"

rm -rf "$VENDOR_DIR"
mkdir -p "$VENDOR_DIR"
cp "$NODAL_UI_DIR/package.json" "$VENDOR_DIR/package.json"
cp -r "$NODAL_UI_DIR/dist" "$VENDOR_DIR/dist"

echo "Vendored @nodal/ui into $VENDOR_DIR"
