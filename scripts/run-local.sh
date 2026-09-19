#!/usr/bin/env bash
# Run Reader Leader on this machine for hands-on testing, microphone included.
#
# One command, because the sequence has two things in it that fail quietly if you get them
# wrong: VITE_APP_ID has to be set before the build (it is baked into the client bundle, and
# its absence looks exactly like a wrong password), and the database has to be migrated and
# seeded before the app starts.
#
#   ./scripts/run-local.sh
#
# Needs Node 22, pnpm, and a MySQL 8 you can reach. Override the connection if yours differs:
#   DATABASE_URL='mysql://user:pass@127.0.0.1:3306/reader_leader_local' ./scripts/run-local.sh
set -euo pipefail

cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-mysql://root:rlroot@127.0.0.1:3306/rl_local}"
export JWT_SECRET="${JWT_SECRET:-local-development-secret}"
export VITE_APP_ID="${VITE_APP_ID:-reader-leader-local}"
export NODE_ENV=production
export PORT="${PORT:-3100}"
export READER_LEADER_CHILD_DEMO_PASSWORD="${READER_LEADER_CHILD_DEMO_PASSWORD:-reader-child-2026}"
export READER_LEADER_TEACHER_DEMO_PASSWORD="${READER_LEADER_TEACHER_DEMO_PASSWORD:-reader-teacher-2026}"
export READER_LEADER_PARENT_DEMO_PASSWORD="${READER_LEADER_PARENT_DEMO_PASSWORD:-reader-parent-2026}"

echo "Installing dependencies…"
pnpm install --frozen-lockfile

echo "Preparing the database…"
pnpm seed:preview || echo "(database already seeded — continuing)"

echo "Building…"
pnpm build

echo
echo "Open  http://localhost:${PORT}"
echo "  Child    child1   / ${READER_LEADER_CHILD_DEMO_PASSWORD}"
echo "  Teacher  teacher2 / ${READER_LEADER_TEACHER_DEMO_PASSWORD}"
echo "  Parent   parent3  / ${READER_LEADER_PARENT_DEMO_PASSWORD}"
echo
echo "Use localhost, not 127.0.0.1: browsers only grant microphone access on localhost or HTTPS."
echo

exec node dist/index.js
