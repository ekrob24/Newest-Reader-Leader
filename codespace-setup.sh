#!/usr/bin/env bash
set -Eeuo pipefail

# Reader-Leader Codespaces setup and frontend preview.
# Run from the repository root with:
#   bash codespace-setup.sh

PORT="${PORT:-4173}"

if [[ ! -f package.json ]]; then
  echo "Error: package.json was not found. Run this script from the repository root." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is not installed in this Codespace." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm was not found; enabling it through Corepack..."
  if ! command -v corepack >/dev/null 2>&1; then
    echo "Error: neither pnpm nor Corepack is available." >&2
    exit 1
  fi
  corepack enable
  corepack prepare pnpm@10.4.1 --activate
fi

echo "Installing locked dependencies..."
pnpm install --frozen-lockfile

echo "Running TypeScript validation..."
pnpm check

echo "Building the application..."
pnpm build

echo
echo "Validation passed. Starting the frontend preview on port ${PORT}..."
echo "In Codespaces, open the Ports tab and select port ${PORT}."
echo "Press Ctrl+C to stop the preview."
echo

exec pnpm exec vite --host 0.0.0.0 --port "${PORT}"
