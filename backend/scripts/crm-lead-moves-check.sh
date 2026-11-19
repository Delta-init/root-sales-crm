#!/usr/bin/env bash
#
# Stands up a throwaway mongod and checks moving leads between the sales CRMs through Root (2026-11-19): who may ask,
# what goes to the other CRM, the rows kept, Undo. The CRMs are stand-ins on local ports. Tears it all down after.
#
# Runs from an empty scratch folder: Root's env.ts loads ./.env (production) itself, so nothing here may start in
# backend/. The check refuses to run unless MONGODB_URI names a scratch database.
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${CRM_LEAD_MOVES_MONGO_PORT:-27138}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/crm-lead-moves-check.XXXXXX")"

cleanup() {
  local code=$? pid
  pid="$(lsof -ti:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pid" ]; then
    kill $pid 2>/dev/null || true
    for _ in $(seq 1 50); do kill -0 $pid 2>/dev/null || break; sleep 0.2; done
  fi
  rm -rf "$WORK"
  exit $code
}
if lsof -ti:"$PORT" >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Set CRM_LEAD_MOVES_MONGO_PORT." >&2
  rm -rf "$WORK"
  exit 1
fi
trap cleanup EXIT INT TERM

mkdir -p "$WORK/db" "$WORK/log" "$WORK/run"
mongod --dbpath "$WORK/db" --port "$PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/log/mongod.log" >/dev/null

cd "$WORK/run"
env -i PATH="$PATH" HOME="$HOME" MONGO="mongodb://127.0.0.1:$PORT" MONGODB_URI="mongodb://127.0.0.1:$PORT/root-lead-moves-scratch" \
  bun --no-env-file run "$REPO/scripts/crm-lead-moves-check.ts"
