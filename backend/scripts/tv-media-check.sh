#!/usr/bin/env bash
#
# End-to-end check of the office TVs' photos and videos (2026-11-02): the TV media page's API (root admins), uploads
# into an R2 stand-in (src/scripts/fake-r2.ts), each TV's open playlist and the overlay script other portals load.
#
# Stands up a throwaway mongod, the R2 stand-in and the portal backend, then runs src/scripts/tv-media-check.ts.
#
#   ./scripts/tv-media-check.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONGO_PORT="${TVMEDIA_MONGO_PORT:-27196}"
API_PORT="${TVMEDIA_API_PORT:-5296}"
R2_PORT="${TVMEDIA_R2_PORT:-5297}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/tv-media-check.XXXXXX")"

release_port() {
  local port="$1" pids
  for _ in $(seq 1 20); do
    pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
    [ -z "$pids" ] && return 0
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 0.25
  done
}

cleanup() {
  local code=$?
  release_port "$API_PORT"
  release_port "$R2_PORT"
  mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --shutdown >/dev/null 2>&1 || true
  release_port "$MONGO_PORT"
  rm -rf "$WORK"
  exit $code
}
trap cleanup EXIT INT TERM

for port in "$MONGO_PORT" "$API_PORT" "$R2_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Set TVMEDIA_MONGO_PORT / TVMEDIA_API_PORT / TVMEDIA_R2_PORT." >&2
    exit 1
  fi
done

mkdir -p "$WORK/db" "$WORK/log" "$WORK/run" "$WORK/r2"
echo "Starting a throwaway mongod on :$MONGO_PORT"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/log/mongod.log" >/dev/null

MONGO="mongodb://127.0.0.1:$MONGO_PORT"
export MONGODB_URI="$MONGO/root-tv-media-e2e"
export PORT="$API_PORT"
export NODE_ENV=test
export JWT_SECRET="tv-media-e2e-access-secret-0123456789abcdef"
export JWT_REFRESH_SECRET="tv-media-e2e-refresh-secret-0123456789abcdef"
export CLIENT_URL="http://localhost:3100"
export SMTP_HOST="" SMTP_USER="" SMTP_PASS="" SMTP_EMAIL_FROM=""
export HRMS_API_URL="" HRMS_CLIENT_ID="" HRMS_INTEGRATION_SECRET="" HRMS_ORG_ID=""
export LEAD_TRAFFIC_SHEET_KEY="" TRAFFIC_WORKER=false BACKUP_WORKER=false
# The TVs' files go in the backups' bucket with the backups' keys, as in production (2026-11-02): no TV_MEDIA_R2_*.
export BACKUP_R2_ENDPOINT="http://127.0.0.1:$R2_PORT" BACKUP_R2_ACCOUNT_ID=""
export BACKUP_R2_ACCESS_KEY_ID="e2e-key" BACKUP_R2_SECRET_ACCESS_KEY="e2e-secret" BACKUP_R2_BUCKET="delta-backups-tv-e2e"
export TV_MEDIA_R2_ENDPOINT="" TV_MEDIA_R2_ACCOUNT_ID="" TV_MEDIA_R2_ACCESS_KEY_ID="" TV_MEDIA_R2_SECRET_ACCESS_KEY="" TV_MEDIA_R2_BUCKET=""
export E2E_API_PORT="$API_PORT" E2E_R2_PORT="$R2_PORT" E2E_R2_DIR="$WORK/r2/delta-backups-tv-e2e"

# From the scratch directory, so dotenv finds no .env to fill the gaps with.
cd "$WORK/run"
echo "Starting the R2 stand-in on :$R2_PORT"
bun --no-env-file "$REPO/src/scripts/fake-r2.ts" "$R2_PORT" "$WORK/r2" > "$WORK/log/r2.log" 2>&1 &
echo "Starting the portal backend on :$API_PORT"
bun --no-env-file "$REPO/src/index.ts" > "$WORK/log/api.log" 2>&1 &

for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -sf "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null || {
  echo "The backend did not start:" >&2; tail -30 "$WORK/log/api.log" >&2; exit 1
}
if ! grep -q "MongoDB connected: root-tv-media-e2e" "$WORK/log/api.log"; then
  echo "The backend did not report connecting to the scratch database:" >&2
  tail -30 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi

echo "Uploading, arranging and playing the TVs' photos and videos"
if ! bun --no-env-file "$REPO/src/scripts/tv-media-check.ts"; then
  echo
  echo "--- last 40 lines of the backend log ---" >&2
  tail -40 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi
