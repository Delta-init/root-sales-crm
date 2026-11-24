#!/usr/bin/env bash
#
# End-to-end check of move-close-to-draw.ts (2026-11-24): a close moved from the
# Sales CRM to Draw — dry run, refusals, the write, again, and the undo.
#
# Stands up a throwaway mongod with two scratch CRM databases and runs the
# script the way somebody would, from a scratch directory with no .env and a
# scratch home folder for its undo file. The driver refuses anything but
# scratch databases on 127.0.0.1.
#
#   ./scripts/move-close-to-draw-check.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONGO_PORT="${MOVE_CLOSE_MONGO_PORT:-27196}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/move-close-to-draw-check.XXXXXX")"

cleanup() {
  local code=$?
  mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --shutdown >/dev/null 2>&1 || true
  local pids
  pids="$(lsof -nP -iTCP:"$MONGO_PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
  # shellcheck disable=SC2086
  [ -n "$pids" ] && kill $pids 2>/dev/null || true
  rm -rf "$WORK"
  exit $code
}
trap cleanup EXIT INT TERM

if lsof -nP -iTCP:"$MONGO_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $MONGO_PORT is busy" >&2
  exit 1
fi
mkdir -p "$WORK/db" "$WORK/home" "$WORK/run"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongod.log" >/dev/null

cd "$WORK/run"
env -i PATH="$PATH" HOME="$WORK/home" \
  DELTA_MONGODB_URI="mongodb://127.0.0.1:$MONGO_PORT/sales_move_close_e2e" \
  DRAW_MONGODB_URI="mongodb://127.0.0.1:$MONGO_PORT/draw_move_close_e2e" \
  E2E_REPO="$REPO" E2E_WORK="$WORK/run" E2E_HOME="$WORK/home" \
  bun --no-env-file "$REPO/src/scripts/move-close-to-draw-check.ts"
