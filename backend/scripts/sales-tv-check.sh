#!/usr/bin/env bash
#
# End-to-end check of Sales TV: GET /sales-tv (root admins) and the open
# GET /public/sales-tv, by the real portal backend.
#
# Stands up a throwaway mongod holding the portal's database, and a stand-in
# answering as the three sales CRMs' /api/v1/service/sales-tv (Remote's is an
# old server with no such route) and as HRMS's signed work-modes. Tears
# everything down afterwards. Takes about 45 seconds: it waits out the 5 s and
# 30 s cache windows.
#
# Nothing here touches a configured database or a real CRM: the backend starts
# from a scratch directory with --no-env-file, every setting passed explicitly,
# and the driver refuses anything but a scratch database on 127.0.0.1.
#
#   ./scripts/sales-tv-check.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONGO_PORT="${SALESTV_MONGO_PORT:-27093}"
API_PORT="${SALESTV_API_PORT:-5197}"
STANDIN_PORT="${SALESTV_STANDIN_PORT:-5198}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/sales-tv-check.XXXXXX")"

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
    echo "Port $port is already in use. Set SALESTV_MONGO_PORT / SALESTV_API_PORT / SALESTV_STANDIN_PORT." >&2
    exit 1
  fi
done

mkdir -p "$WORK/db" "$WORK/log" "$WORK/run"
echo "Starting a throwaway mongod on :$MONGO_PORT"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/log/mongod.log" >/dev/null

MONGO="mongodb://127.0.0.1:$MONGO_PORT"
STANDIN="http://127.0.0.1:$STANDIN_PORT"
export MONGODB_URI="$MONGO/root-sales-tv-e2e"
export PORT="$API_PORT"
export NODE_ENV=test
export JWT_SECRET="sales-tv-e2e-access-secret-0123456789abcdef"
export JWT_REFRESH_SECRET="sales-tv-e2e-refresh-secret-0123456789abcdef"
export CLIENT_URL="http://localhost:3100"
export SMTP_HOST="" SMTP_USER="" SMTP_PASS="" SMTP_EMAIL_FROM=""
export HRMS_API_URL="$STANDIN/hrms" HRMS_CLIENT_ID="sales-tv-e2e" HRMS_INTEGRATION_SECRET="sales-tv-e2e-hrms-signing" HRMS_ORG_ID=""
export DELTA_API_URL="$STANDIN/delta" DELTA_SSO_SECRET="sales-tv-e2e-delta"
export DRAW_API_URL="$STANDIN/draw/api/v1" DRAW_SSO_SECRET="sales-tv-e2e-draw"
export REMOTE_API_URL="$STANDIN/remote" REMOTE_SSO_SECRET="sales-tv-e2e-remote"
export BANGLORE_API_URL="" BANGLORE_SSO_SECRET=""
export DELTA_MONGODB_URI="" DRAW_MONGODB_URI="" BANGLORE_MONGODB_URI="" REMOTE_MONGODB_URI=""
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
if ! grep -q "MongoDB connected: root-sales-tv-e2e" "$WORK/log/api.log"; then
  echo "The backend did not report connecting to the scratch database:" >&2
  tail -30 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi

echo "Asking it for Sales TV"
if ! bun --no-env-file "$REPO/src/scripts/sales-tv-check.ts"; then
  echo
  echo "--- last 40 lines of the backend log ---" >&2
  tail -40 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi
