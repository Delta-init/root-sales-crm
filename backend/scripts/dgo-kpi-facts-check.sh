#!/usr/bin/env bash
#
# End-to-end check of GET /service/dgo/kpi-facts (DGO Points' automatic sales KPI points and review suggestions in
# HRMS), by the real portal backend.
#
# Stands up a throwaway mongod holding the portal's database and four scratch CRM databases (Delta, Draw, Remote and
# Banglore), and a stand-in answering as the LMS (its review feed). Tears everything down afterwards.
#
# Nothing here touches a configured database or a real portal: the backend starts from a scratch directory with
# --no-env-file, every setting passed explicitly, and the driver refuses anything but scratch databases on 127.0.0.1.
#
#   ./scripts/dgo-kpi-facts-check.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONGO_PORT="${DGOKPI_MONGO_PORT:-27154}"
API_PORT="${DGOKPI_API_PORT:-27155}"
STANDIN_PORT="${DGOKPI_STANDIN_PORT:-27156}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/dgo-kpi-facts-check.XXXXXX")"

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
    echo "Port $port is already in use. Set DGOKPI_MONGO_PORT / DGOKPI_API_PORT / DGOKPI_STANDIN_PORT." >&2
    exit 1
  fi
done

mkdir -p "$WORK/db" "$WORK/log" "$WORK/run"
echo "Starting a throwaway mongod on :$MONGO_PORT"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/log/mongod.log" >/dev/null

MONGO="mongodb://127.0.0.1:$MONGO_PORT"
STANDIN="http://127.0.0.1:$STANDIN_PORT"
export MONGODB_URI="$MONGO/root-dgo-kpi-e2e"
export DELTA_MONGODB_URI="$MONGO/delta-crm-dgokpi-e2e" DRAW_MONGODB_URI="$MONGO/draw-crm-dgokpi-e2e"
export REMOTE_MONGODB_URI="$MONGO/remote-crm-dgokpi-e2e" BANGLORE_MONGODB_URI="$MONGO/banglore-crm-dgokpi-e2e"
export DELTA_API_URL="" DRAW_API_URL="" REMOTE_API_URL="" BANGLORE_API_URL=""
export PORT="$API_PORT"
export NODE_ENV=test
export JWT_SECRET="dgo-kpi-e2e-access-secret-0123456789abcdef0123"
export JWT_REFRESH_SECRET="dgo-kpi-e2e-refresh-secret-0123456789abcdef0123"
export CLIENT_URL="http://localhost:3100"
export SMTP_HOST="" SMTP_USER="" SMTP_PASS="" SMTP_EMAIL_FROM=""
export HRMS_API_URL="" HRMS_CLIENT_ID="" HRMS_INTEGRATION_SECRET="" HRMS_ORG_ID=""
export HRMS_SSO_SECRET="dgo-kpi-e2e-hrms-secret"
export COMMISSION_API_URL="" COMMISSION_SSO_SECRET="dgo-kpi-e2e-commission"
export LMS_API_URL="$STANDIN/lms/api/v1" LMS_SSO_SECRET="dgo-kpi-e2e-lms"
export LEAD_TRAFFIC_SHEET_KEY="" TRAFFIC_WORKER=false BACKUP_WORKER=false MENTOR_KPI_WORKER=false
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
if ! grep -q "MongoDB connected: root-dgo-kpi-e2e" "$WORK/log/api.log"; then
  echo "The backend did not report connecting to the scratch database:" >&2
  tail -30 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi

echo "Asking it for DGO KPI facts"
if ! bun --no-env-file "$REPO/src/scripts/dgo-kpi-facts-check.ts"; then
  echo
  echo "--- last 40 lines of the backend log ---" >&2
  tail -40 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi
