#!/usr/bin/env bash
set -Eeuo pipefail

# Reader-Leader Codespaces setup and full application preview.
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
if [[ -z "${OAUTH_SERVER_URL:-}" ]]; then
  echo
  echo "Validation passed, but OAUTH_SERVER_URL is not configured."
  echo "Add the project environment variables to Codespaces Secrets before starting the full app:"
  echo "  OAUTH_SERVER_URL"
  echo "  DATABASE_URL"
  echo "  JWT_SECRET"
  echo
  echo "The frontend-only Vite server is not a valid application preview because it has no /api/trpc backend."
  exit 2
fi

echo "Validation passed. Starting the full application server on port ${PORT}..."
echo "In Codespaces, open the Ports tab and select port ${PORT}."
echo "Press Ctrl+C to stop the preview."
echo

exec pnpm dev --host 0.0.0.0 --port "${PORT}"
