#!/usr/bin/env bash
#
# End-to-end check of the Class TV: the open board (/public/class-tv), its
# recorded lines (/class-tv/voices, /public/class-tv/voice/:id), by the real
# portal backend.
#
# Stands up a throwaway mongod holding the portal's database, and a stand-in
# answering as the LMS's /api/v1/service/mentors and as HRMS's signed
# work-modes (the mentors' photos). Tears everything down
# afterwards. Takes about 70 seconds: it waits out the one-minute cache.
#
# Nothing here touches a configured database or the real LMS: the
# backend starts from a scratch directory with --no-env-file, every setting
# passed explicitly, and the driver refuses anything but a scratch database on
# 127.0.0.1.
#
#   ./scripts/class-tv-check.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONGO_PORT="${CLASSTV_MONGO_PORT:-27194}"
API_PORT="${CLASSTV_API_PORT:-5294}"
STANDIN_PORT="${CLASSTV_STANDIN_PORT:-5295}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/class-tv-check.XXXXXX")"

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
    echo "Port $port is already in use. Set CLASSTV_MONGO_PORT / CLASSTV_API_PORT / CLASSTV_STANDIN_PORT." >&2
    exit 1
  fi
done

mkdir -p "$WORK/db" "$WORK/log" "$WORK/run"
echo "Starting a throwaway mongod on :$MONGO_PORT"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/log/mongod.log" >/dev/null

MONGO="mongodb://127.0.0.1:$MONGO_PORT"
STANDIN="http://127.0.0.1:$STANDIN_PORT"
export MONGODB_URI="$MONGO/root-class-tv-e2e"
export PORT="$API_PORT"
export NODE_ENV=test
export JWT_SECRET="class-tv-e2e-access-secret-0123456789abcdef"
export JWT_REFRESH_SECRET="class-tv-e2e-refresh-secret-0123456789abcdef"
export CLIENT_URL="http://localhost:3100"
export SMTP_HOST="" SMTP_USER="" SMTP_PASS="" SMTP_EMAIL_FROM=""
# The mentors' photos: HRMS's signed work-modes — the stand-in again.
export HRMS_API_URL="$STANDIN/hrms" HRMS_CLIENT_ID="class-tv-e2e" HRMS_INTEGRATION_SECRET="class-tv-e2e-hrms-signing" HRMS_ORG_ID=""
export LMS_API_URL="$STANDIN/lms/api/v1" LMS_SSO_SECRET="class-tv-e2e-lms" LMS_REMOTE_ORG_ID="64a000000000000000000d0b"
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
if ! grep -q "MongoDB connected: root-class-tv-e2e" "$WORK/log/api.log"; then
  echo "The backend did not report connecting to the scratch database:" >&2
  tail -30 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi

echo "Asking it for the Class TV"
if ! bun --no-env-file "$REPO/src/scripts/class-tv-check.ts"; then
  echo
  echo "--- last 40 lines of the backend log ---" >&2
  tail -40 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi
