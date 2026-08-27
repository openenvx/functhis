#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Typecheck"
bun run check-types

echo "==> Lint"
bun run lint

echo "==> Build"
bun run build

echo "==> Test suite"
bun run test

echo "==> Benchmark"
bun run benchmark

echo "==> Pack tarball"
rm -f functhis-*.tgz
bun pm pack >/dev/null
TARBALL="$(ls functhis-*.tgz | head -1)"
test -f "$TARBALL"

echo "==> Tarball CLI smoke"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
tar -xzf "$TARBALL" -C "$STAGE"
PKG="$STAGE/package"
(cd "$PKG" && bun install --production)
CLI="$PKG/dist/src/cli.js"
bun "$CLI" --version | grep -q "0.2.0"
CONFIG_DIR="$(mktemp -d)"
bun "$CLI" setup --dir "$CONFIG_DIR"
bun "$CLI" doctor --dir "$CONFIG_DIR"

echo "==> Release verification passed ($TARBALL ready to publish)"
