#!/usr/bin/env bash
#
# End-to-end check of the CSEs pages' API: Root asks Tetra Commission (a
# stand-in, inside the check) for each CSE's figures, with its portal secret and
# the period cut in Gulf time, and hands them on with a link to each student.
# Stands up a throwaway mongod for the portal's own database; nothing touches a
# configured one — both processes start from a scratch directory with no .env.
#
#   ./scripts/cses-check.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONGO_PORT="${CSES_MONGO_PORT:-27189}"
API_PORT="${CSES_API_PORT:-5293}"
STANDIN_PORT="${CSES_STANDIN_PORT:-5294}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/cses-check.XXXXXX")"

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
    echo "Port $port is already in use. Set PENDING_MONGO_PORT / PENDING_API_PORT." >&2
    exit 1
  fi
done

mkdir -p "$WORK/db" "$WORK/log" "$WORK/run"
echo "Starting a throwaway mongod on :$MONGO_PORT"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/log/mongod.log" >/dev/null

MONGO="mongodb://127.0.0.1:$MONGO_PORT"
export MONGODB_URI="$MONGO/root-cses-e2e"
export PORT="$API_PORT"
export NODE_ENV=test
export JWT_SECRET="salespeople-e2e-access-secret-0123456789abcdef"
export JWT_REFRESH_SECRET="salespeople-e2e-refresh-secret-0123456789abcdef"
export CLIENT_URL="http://localhost:3100"
export SMTP_HOST="" SMTP_USER="" SMTP_PASS="" SMTP_EMAIL_FROM=""
export HRMS_API_URL="" HRMS_CLIENT_ID="" HRMS_INTEGRATION_SECRET="" HRMS_ORG_ID=""
export DELTA_API_URL="" DRAW_API_URL="" BANGLORE_API_URL="" REMOTE_API_URL=""
export DELTA_SSO_SECRET="" DRAW_SSO_SECRET="" BANGLORE_SSO_SECRET="" REMOTE_SSO_SECRET=""
export DELTA_MONGODB_URI="$MONGO/delta-crm-salespeople-e2e" DRAW_MONGODB_URI="$MONGO/draw-crm-salespeople-e2e"
# Nothing listens on port 1: Banglore cannot be reached. Remote has no database set.
export BANGLORE_MONGODB_URI="mongodb://127.0.0.1:1/banglore-crm-salespeople-e2e" REMOTE_MONGODB_URI=""
export LEAD_TRAFFIC_SHEET_KEY="" TRAFFIC_WORKER=false
# The other portals answer for themselves: a stand-in, inside the check, on its own port.
# HRMS is left unset (not configured); the LMS's stand-in has no pending route (an old server).
STANDIN="http://127.0.0.1:$STANDIN_PORT"
export COMMISSION_API_URL="$STANDIN/commission" COMMISSION_SSO_SECRET="cses-e2e-commission-secret" COMMISSION_APP_URL="https://tetra.example.test/"
export FINANCE_HQ_API_URL="$STANDIN/finance/api/v1" FINANCE_HQ_SSO_SECRET="salespeople-e2e-finance-secret"
export LMS_API_URL="$STANDIN/lms" LMS_SSO_SECRET="salespeople-e2e-lms-secret"
export MEDIA_ERP_API_URL="$STANDIN/media" MEDIA_ERP_SSO_SECRET="salespeople-e2e-media-secret-that-it-refuses"
export HRMS_SSO_SECRET=""
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
if ! grep -q "MongoDB connected: root-cses-e2e" "$WORK/log/api.log"; then
  echo "The backend did not report connecting to the scratch database:" >&2
  tail -30 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi

echo "Asking it about the CSEs"
if ! bun --no-env-file "$REPO/src/scripts/cses-check.ts"; then
  echo
  echo "--- last 40 lines of the backend log ---" >&2
  tail -40 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi
