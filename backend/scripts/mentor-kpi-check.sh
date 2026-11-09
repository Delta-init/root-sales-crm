#!/usr/bin/env bash
#
# End-to-end check of Mentor KPIs (2026-11-09): the plan kept in Root (draft, targets suggested from history,
# approval, versions) and the points Root works out with it.
#
# Stands up a throwaway mongod and a fake CS Portal (inside the driver — it answers /service/mentor-report with
# made-up mentors), starts the backend against them, and drives it. Nothing here touches a configured database or a
# real portal: both processes start from a scratch directory with no .env, every setting is passed explicitly, and the
# driver refuses anything but a scratch database on 127.0.0.1.
#
#   ./scripts/mentor-kpi-check.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONGO_PORT="${KPI_MONGO_PORT:-27207}"
API_PORT="${KPI_API_PORT:-5311}"
FAKE_PORT="${KPI_FAKE_PORT:-5312}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mentor-kpi-check.XXXXXX")"

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
  release_port "$FAKE_PORT"
  mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --shutdown >/dev/null 2>&1 || true
  release_port "$MONGO_PORT"
  rm -rf "$WORK"
  exit $code
}
trap cleanup EXIT INT TERM

for port in "$MONGO_PORT" "$API_PORT" "$FAKE_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Set KPI_MONGO_PORT / KPI_API_PORT / KPI_FAKE_PORT." >&2
    exit 1
  fi
done

mkdir -p "$WORK/db" "$WORK/log" "$WORK/run"
echo "Starting a throwaway mongod on :$MONGO_PORT"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/log/mongod.log" >/dev/null

MONGO="mongodb://127.0.0.1:$MONGO_PORT"
export MONGODB_URI="$MONGO/root-mentor-kpi-e2e"
export PORT="$API_PORT"
export NODE_ENV=test
export JWT_SECRET="mentor-kpi-e2e-access-secret-0123456789abcdef"
export JWT_REFRESH_SECRET="mentor-kpi-e2e-refresh-secret-0123456789abcdef"
export CLIENT_URL="http://localhost:3100"
export SMTP_HOST="" SMTP_USER="" SMTP_PASS="" SMTP_EMAIL_FROM=""
export HRMS_API_URL="" HRMS_CLIENT_ID="" HRMS_INTEGRATION_SECRET="" HRMS_ORG_ID=""
export DELTA_API_URL="" DRAW_API_URL="" BANGLORE_API_URL="" REMOTE_API_URL=""
export DELTA_SSO_SECRET="" DRAW_SSO_SECRET="" BANGLORE_SSO_SECRET="" REMOTE_SSO_SECRET=""
export DELTA_MONGODB_URI="" DRAW_MONGODB_URI="" BANGLORE_MONGODB_URI="" REMOTE_MONGODB_URI=""
export LEAD_TRAFFIC_SHEET_KEY="" TRAFFIC_WORKER=false
# The LMS asks for mentor KPIs too (its own secret).
export LMS_API_URL="" LMS_SSO_SECRET="mentor-kpi-e2e-lms-secret"
# CS Portal is the fake one the driver serves.
export COMMISSION_API_URL="http://127.0.0.1:$FAKE_PORT/api/v1" COMMISSION_SSO_SECRET="mentor-kpi-e2e-portal-secret"
export FINANCE_HQ_API_URL="" FINANCE_HQ_SSO_SECRET=""
export MEDIA_ERP_API_URL="" MEDIA_ERP_SSO_SECRET="" HRMS_SSO_SECRET=""
# The driver freezes months itself (autoFreeze), so the server's own timer stays off.
export MENTOR_KPI_WORKER=false
export E2E_API_PORT="$API_PORT" E2E_FAKE_PORT="$FAKE_PORT" E2E_REPO="$REPO"

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
if ! grep -q "MongoDB connected: root-mentor-kpi-e2e" "$WORK/log/api.log"; then
  echo "The backend did not report connecting to the scratch database:" >&2
  tail -30 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi

echo "Scoring mentors"
if ! bun --no-env-file "$REPO/src/scripts/mentor-kpi-check.ts"; then
  echo
  echo "--- last 40 lines of the backend log ---" >&2
  tail -40 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi
