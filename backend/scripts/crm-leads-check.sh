#!/usr/bin/env bash
#
# End-to-end check of POST /api/v1/service/crm-leads: the LMS asking which
# sales CRMs its students are leads in, by email and by phone — read from the
# CRMs' databases by the real portal backend, behind the LMS's secret.
#
# Stands up a throwaway mongod holding the portal's database and three scratch
# CRM databases, starts the backend against them, and drives it. Banglore is
# pointed at a port nothing listens on, so the "cannot be read" path is taken.
# Nothing here touches a configured database: both processes start from a
# scratch directory with no .env, every setting is passed explicitly, and the
# driver refuses anything but scratch databases on 127.0.0.1.
#
#   ./scripts/crm-leads-check.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONGO_PORT="${CRMLEADS_MONGO_PORT:-27189}"
API_PORT="${CRMLEADS_API_PORT:-5293}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/crm-leads-check.XXXXXX")"

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

for port in "$MONGO_PORT" "$API_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Set CRMLEADS_MONGO_PORT / CRMLEADS_API_PORT." >&2
    exit 1
  fi
done

mkdir -p "$WORK/db" "$WORK/log" "$WORK/run"
echo "Starting a throwaway mongod on :$MONGO_PORT"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/log/mongod.log" >/dev/null

MONGO="mongodb://127.0.0.1:$MONGO_PORT"
export MONGODB_URI="$MONGO/root-crm-leads-e2e"
export PORT="$API_PORT"
export NODE_ENV=test
export JWT_SECRET="crm-leads-e2e-access-secret-0123456789abcdef"
export JWT_REFRESH_SECRET="crm-leads-e2e-refresh-secret-0123456789abcdef"
export CLIENT_URL="http://localhost:3100"
export SMTP_HOST="" SMTP_USER="" SMTP_PASS="" SMTP_EMAIL_FROM=""
export HRMS_API_URL="" HRMS_CLIENT_ID="" HRMS_INTEGRATION_SECRET="" HRMS_ORG_ID=""
export DELTA_API_URL="" DRAW_API_URL="" BANGLORE_API_URL="" REMOTE_API_URL=""
# A CRM's secret is set so the check can show it does not open the LMS's door.
export DELTA_SSO_SECRET="crm-leads-e2e-delta-secret" DRAW_SSO_SECRET="" BANGLORE_SSO_SECRET="" REMOTE_SSO_SECRET=""
export DELTA_MONGODB_URI="$MONGO/delta-crm-crm-leads-e2e" DRAW_MONGODB_URI="$MONGO/draw-crm-crm-leads-e2e" REMOTE_MONGODB_URI="$MONGO/remote-crm-crm-leads-e2e"
# Nothing listens on port 1: Banglore cannot be reached.
export BANGLORE_MONGODB_URI="mongodb://127.0.0.1:1/banglore-crm-crm-leads-e2e"
export LEAD_TRAFFIC_SHEET_KEY="" TRAFFIC_WORKER=false
# The LMS is the caller: its secret is what it must present. Nothing is called out to.
export LMS_API_URL="" LMS_SSO_SECRET="crm-leads-e2e-lms-secret-0123456789"
export COMMISSION_API_URL="" COMMISSION_SSO_SECRET="" FINANCE_HQ_API_URL="" FINANCE_HQ_SSO_SECRET=""
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
if ! grep -q "MongoDB connected: root-crm-leads-e2e" "$WORK/log/api.log"; then
  echo "The backend did not report connecting to the scratch database:" >&2
  tail -30 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi

echo "Asking it, as the LMS, about some people"
if ! bun --no-env-file "$REPO/src/scripts/crm-leads-check.ts"; then
  echo
  echo "--- last 40 lines of the backend log ---" >&2
  tail -40 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi
