#!/usr/bin/env bash
#
# End-to-end check of lead traffic: the lead sheets posting into the portal, the
# split between teams in the Delta and Draw CRMs, and what reaches each of them.
#
# Stands up a throwaway mongod and the real portal backend; the two CRMs are
# stand-ins the driver serves itself, answering the way their sheet intakes do.
# The split and leads as they are live go into the scratch database first, so
# the backend meets them on start-up as it will when deployed over them.
# Tears everything down afterwards.
#
# Nothing here touches a configured database or a real CRM. backend/.env names
# REMOTE databases and holds the CRMs' real secrets, and src/config/env.ts loads
# it through dotenv whatever bun is told — so both processes are started from a
# scratch directory that has no .env for dotenv to find, and every setting they
# need is passed explicitly. The driver refuses anything but scratch databases
# on 127.0.0.1.
#
#   ./scripts/traffic-check.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONGO_PORT="${TRAFFIC_MONGO_PORT:-27087}"
API_PORT="${TRAFFIC_API_PORT:-5187}"
DELTA_PORT="${TRAFFIC_DELTA_PORT:-5188}"
DRAW_PORT="${TRAFFIC_DRAW_PORT:-5189}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/traffic-check.XXXXXX")"

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
  release_port "$DELTA_PORT"
  release_port "$DRAW_PORT"
  mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --shutdown >/dev/null 2>&1 || true
  release_port "$MONGO_PORT"
  rm -rf "$WORK"
  exit $code
}
trap cleanup EXIT INT TERM

for port in "$MONGO_PORT" "$API_PORT" "$DELTA_PORT" "$DRAW_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Set TRAFFIC_MONGO_PORT / TRAFFIC_API_PORT / TRAFFIC_DELTA_PORT / TRAFFIC_DRAW_PORT." >&2
    exit 1
  fi
done

mkdir -p "$WORK/db" "$WORK/log" "$WORK/run"
echo "Starting a throwaway mongod on :$MONGO_PORT"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/log/mongod.log" >/dev/null

MONGO="mongodb://127.0.0.1:$MONGO_PORT"
export MONGODB_URI="$MONGO/root-traffic-e2e"
export PORT="$API_PORT"
export NODE_ENV=test
export JWT_SECRET="traffic-e2e-access-secret-0123456789abcdef"
export JWT_REFRESH_SECRET="traffic-e2e-refresh-secret-0123456789abcdef"
export CLIENT_URL="http://localhost:3100"
export SMTP_HOST="" SMTP_USER="" SMTP_PASS="" SMTP_EMAIL_FROM=""
export HRMS_API_URL="" HRMS_CLIENT_ID="" HRMS_INTEGRATION_SECRET="" HRMS_ORG_ID=""
export DELTA_API_URL="http://127.0.0.1:$DELTA_PORT" DRAW_API_URL="http://127.0.0.1:$DRAW_PORT"
export DELTA_MONGODB_URI="$MONGO/delta-crm-traffic-e2e" DRAW_MONGODB_URI="$MONGO/draw-crm-traffic-e2e"
export DELTA_SSO_SECRET="" DRAW_SSO_SECRET="" BANGLORE_API_URL="" BANGLORE_MONGODB_URI=""
export DELTA_SHEETS_API_KEY="delta-sheets-e2e-key" DRAW_SHEETS_API_KEY="draw-sheets-e2e-key"
export LEAD_TRAFFIC_SHEET_KEY="lead-traffic-e2e-sheet-key"
export TRAFFIC_WORKER=true TRAFFIC_WORKER_INTERVAL_MS=1000
export E2E_API_PORT="$API_PORT" E2E_DELTA_PORT="$DELTA_PORT" E2E_DRAW_PORT="$DRAW_PORT"

# From the scratch directory, so dotenv finds no .env to fill the gaps with.
cd "$WORK/run"
echo "Writing the split and leads as they are live, before the backend starts"
bun --no-env-file "$REPO/src/scripts/traffic-check.ts" seed

echo "Starting the portal backend on :$API_PORT"
bun --no-env-file "$REPO/src/index.ts" > "$WORK/log/api.log" 2>&1 &

for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -sf "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null || {
  echo "The backend did not start:" >&2; tail -30 "$WORK/log/api.log" >&2; exit 1
}
if ! grep -q "MongoDB connected: root-traffic-e2e" "$WORK/log/api.log"; then
  echo "The backend did not report connecting to the scratch database:" >&2
  tail -30 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi

echo "Driving the lead sheet through the portal"
if ! bun --no-env-file "$REPO/src/scripts/traffic-check.ts"; then
  echo
  echo "--- last 40 lines of the backend log ---" >&2
  tail -40 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi
