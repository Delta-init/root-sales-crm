#!/usr/bin/env bash
#
# End-to-end check of GET /api/v1/service/crm-commission: finance asking each
# sales CRM's counted commission for a month — read from the CRMs' databases by
# the real portal backend, behind finance's secret (2026-10-21).
#
# Stands up a throwaway mongod holding the portal's database and three scratch
# CRM databases, starts the backend against them, and drives it. Banglore is
# pointed at a port nothing listens on, so the "cannot be read" path is taken.
# Nothing here touches a configured database: both processes start from a
# scratch directory with no .env, every setting is passed explicitly, and the
# driver refuses anything but scratch databases on 127.0.0.1.
#
#   ./scripts/crm-commission-check.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONGO_PORT="${CRMCOMM_MONGO_PORT:-27191}"
API_PORT="${CRMCOMM_API_PORT:-5295}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/crm-commission-check.XXXXXX")"

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
  release_port "${CRMCOMM_CRM_PORT:-5296}"
  mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --shutdown >/dev/null 2>&1 || true
  release_port "$MONGO_PORT"
  rm -rf "$WORK"
  exit $code
}
trap cleanup EXIT INT TERM

for port in "$MONGO_PORT" "$API_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Set CRMCOMM_MONGO_PORT / CRMCOMM_API_PORT." >&2
    exit 1
  fi
done

mkdir -p "$WORK/db" "$WORK/log" "$WORK/run"
echo "Starting a throwaway mongod on :$MONGO_PORT"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/log/mongod.log" >/dev/null

MONGO="mongodb://127.0.0.1:$MONGO_PORT"
export MONGODB_URI="$MONGO/root-crm-commission-e2e"
export PORT="$API_PORT"
export NODE_ENV=test
export JWT_SECRET="crm-commission-e2e-access-secret-0123456789abcdef"
export JWT_REFRESH_SECRET="crm-commission-e2e-refresh-secret-0123456789abcdef"
export CLIENT_URL="http://localhost:3100"
export SMTP_HOST="" SMTP_USER="" SMTP_PASS="" SMTP_EMAIL_FROM=""
export HRMS_API_URL="" HRMS_CLIENT_ID="" HRMS_INTEGRATION_SECRET="" HRMS_ORG_ID=""
# Sales and Draw answer My Pay through a stand-in the check starts; Remote's API is not set (its figures can't be had).
export E2E_CRM_PORT="${CRMCOMM_CRM_PORT:-5296}"
export DELTA_API_URL="http://127.0.0.1:$E2E_CRM_PORT/delta" DRAW_API_URL="http://127.0.0.1:$E2E_CRM_PORT/draw" BANGLORE_API_URL="" REMOTE_API_URL=""
# A CRM's secret is set so the check can show it does not open finance's door.
export DELTA_SSO_SECRET="crm-commission-e2e-delta-secret" DRAW_SSO_SECRET="crm-commission-e2e-draw-secret" BANGLORE_SSO_SECRET="" REMOTE_SSO_SECRET=""
export DELTA_MONGODB_URI="$MONGO/delta-crm-crm-commission-e2e" DRAW_MONGODB_URI="$MONGO/draw-crm-crm-commission-e2e" REMOTE_MONGODB_URI="$MONGO/remote-crm-crm-commission-e2e"
# Nothing listens on port 1: Banglore cannot be reached.
export BANGLORE_MONGODB_URI="mongodb://127.0.0.1:1/banglore-crm-crm-commission-e2e"
export LEAD_TRAFFIC_SHEET_KEY="" TRAFFIC_WORKER=false
# Finance is the caller: its secret is what it must present. Nothing is called out to.
export LMS_API_URL="" LMS_SSO_SECRET=""
export COMMISSION_API_URL="" COMMISSION_SSO_SECRET="" FINANCE_HQ_API_URL="" FINANCE_HQ_SSO_SECRET="crm-commission-e2e-finance-secret-0123456789"
export MEDIA_ERP_API_URL="" MEDIA_ERP_SSO_SECRET="" HRMS_SSO_SECRET=""
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
if ! grep -q "MongoDB connected: root-crm-commission-e2e" "$WORK/log/api.log"; then
  echo "The backend did not report connecting to the scratch database:" >&2
  tail -30 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi

echo "Asking it, as finance, for a month's commission"
if ! bun --no-env-file "$REPO/src/scripts/crm-commission-check.ts"; then
  echo
  echo "--- last 40 lines of the backend log ---" >&2
  tail -40 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi
