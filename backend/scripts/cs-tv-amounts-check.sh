#!/usr/bin/env bash
#
# End-to-end check of the CS TV amounts page's routes (/cs-tv-amounts), by the
# real portal backend.
#
# Stands up a throwaway mongod holding the portal's database, and a stand-in
# answering as CS Portal's /api/v1/service/cs-tv-amounts. Tears everything
# down afterwards. Takes a few seconds.
#
# Nothing here touches a configured database or the real CS Portal: the
# backend starts from a scratch directory with --no-env-file, every setting
# passed explicitly, and the driver refuses anything but a scratch database on
# 127.0.0.1.
#
#   ./scripts/cs-tv-amounts-check.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONGO_PORT="${CSTV_MONGO_PORT:-27198}"
API_PORT="${CSTV_API_PORT:-5298}"
STANDIN_PORT="${CSTV_STANDIN_PORT:-5299}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/cs-tv-amounts-check.XXXXXX")"

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
  mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --shutdown >/dev/null 2>&1 || true
  release_port "$MONGO_PORT"
  rm -rf "$WORK"
  exit $code
}
trap cleanup EXIT INT TERM

for port in "$MONGO_PORT" "$API_PORT" "$STANDIN_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Set CSTV_MONGO_PORT / CSTV_API_PORT / CSTV_STANDIN_PORT." >&2
    exit 1
  fi
done

mkdir -p "$WORK/db" "$WORK/log" "$WORK/run"
echo "Starting a throwaway mongod on :$MONGO_PORT"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/log/mongod.log" >/dev/null

MONGO="mongodb://127.0.0.1:$MONGO_PORT"
STANDIN="http://127.0.0.1:$STANDIN_PORT"
export MONGODB_URI="$MONGO/root-cs-tv-amounts-e2e"
export PORT="$API_PORT"
export NODE_ENV=test
export JWT_SECRET="cs-tv-amounts-e2e-access-secret-0123456789abcdef"
export JWT_REFRESH_SECRET="cs-tv-amounts-e2e-refresh-secret-0123456789abcdef"
export CLIENT_URL="http://localhost:3100"
export SMTP_HOST="" SMTP_USER="" SMTP_PASS="" SMTP_EMAIL_FROM=""
export HRMS_API_URL="" HRMS_CLIENT_ID="" HRMS_INTEGRATION_SECRET="" HRMS_ORG_ID=""
export COMMISSION_API_URL="$STANDIN/commission/api/v1" COMMISSION_SSO_SECRET="cs-tv-amounts-e2e-commission"
export LEAD_TRAFFIC_SHEET_KEY="" TRAFFIC_WORKER=false BACKUP_WORKER=false
export E2E_STANDIN_PORT="$STANDIN_PORT"
export E2E_API_PORT="$API_PORT"

# From the scratch directory, so dotenv finds no .env to fill the gaps with.
cd "$WORK/run"
echo "Starting the portal backend on :$API_PORT"
bun --no-env-file "$REPO/src/index.ts" > "$WORK/log/api.log" 2>&1 &

for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -sf "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null || {
  echo "The backend did not start:" >&2; tail -30 "$WORK/log/api.log" >&2; exit 1
}
if ! grep -q "MongoDB connected: root-cs-tv-amounts-e2e" "$WORK/log/api.log"; then
  echo "The backend did not report connecting to the scratch database:" >&2
  tail -30 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi

echo "Asking it for the CS TV amounts"
if ! bun --no-env-file "$REPO/src/scripts/cs-tv-amounts-check.ts"; then
  echo
  echo "--- last 40 lines of the backend log ---" >&2
  tail -40 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi
