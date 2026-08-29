#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/skills"
DEST="$ROOT/plugins/functhis/skills"

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC/." "$DEST"

echo "Copied $SRC → $DEST"
