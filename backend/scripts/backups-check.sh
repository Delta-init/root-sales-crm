#!/usr/bin/env bash
#
# End-to-end check of Backups (2026-10-16): every portal's database into R2,
# a download, and the restore putting it back exactly.
#
# Stands up a throwaway mongod holding the portal's database and scratch
# databases for the portals, an R2 stand-in (src/scripts/fake-r2.ts) keeping
# files in a scratch directory, and the real backend against them; then backs
# up, downloads, restores and compares. Tears everything down afterwards.
#
# Nothing here touches a configured database or bucket. backend/.env names the
# real ones, and src/config/env.ts loads it through dotenv whatever bun is
# told — so every process starts from a scratch directory with no .env, and
# every setting is passed explicitly. The driver refuses anything but scratch
# databases on 127.0.0.1.
#
#   ./scripts/backups-check.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONGO_PORT="${BACKUPS_MONGO_PORT:-27097}"
API_PORT="${BACKUPS_API_PORT:-5197}"
R2_PORT="${BACKUPS_R2_PORT:-5198}"
# Nothing listens here: Draw's "server" is down, so its backup fails.
DEAD_PORT="${BACKUPS_DEAD_PORT:-27099}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/backups-check.XXXXXX")"

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
  release_port "$MONGO_PORT"
  # BACKUPS_KEEP=1 leaves the scratch directory (logs, files) to look at.
  if [ -n "${BACKUPS_KEEP:-}" ]; then echo "Kept $WORK"; else rm -rf "$WORK"; fi
  exit $code
}
trap cleanup EXIT INT TERM

for port in "$MONGO_PORT" "$API_PORT" "$R2_PORT" "$DEAD_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Set BACKUPS_MONGO_PORT / BACKUPS_API_PORT / BACKUPS_R2_PORT / BACKUPS_DEAD_PORT." >&2
    exit 1
  fi
done

mkdir -p "$WORK/db" "$WORK/log" "$WORK/run" "$WORK/r2" "$WORK/out"
echo "Starting a throwaway mongod on :$MONGO_PORT"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/log/mongod.log" >/dev/null

MONGO="mongodb://127.0.0.1:$MONGO_PORT"
export MONGODB_URI="$MONGO/root-backups-e2e"
export PORT="$API_PORT"
export NODE_ENV=test
export JWT_SECRET="backups-e2e-access-secret-0123456789abcdef"
export JWT_REFRESH_SECRET="backups-e2e-refresh-secret-0123456789abcdef"
export CLIENT_URL="http://localhost:3100"
export SMTP_HOST="" SMTP_USER="" SMTP_PASS="" SMTP_EMAIL_FROM=""
export HRMS_API_URL="" HRMS_CLIENT_ID="" HRMS_INTEGRATION_SECRET="" HRMS_ORG_ID=""
export LEAD_TRAFFIC_SHEET_KEY="" TRAFFIC_WORKER=false
# The portals' databases, as each case wants them:
export DELTA_MONGODB_URI="$MONGO/delta-bk-e2e"
export DRAW_MONGODB_URI="mongodb://drawuser:secretpw-e2e@127.0.0.1:$DEAD_PORT/draw-bk-e2e?authSource=admin"
export REMOTE_MONGODB_URI=""                                  # not set up
export BANGLORE_MONGODB_URI="$MONGO/banglore-bk-e2e"
export FINANCE_HQ_MONGODB_URI="$MONGO/finance-bk-e2e"
export FINANCE_BANGLORE_MONGODB_URI="$MONGO/finance-bk-e2e?appName=x"   # the same database: not twice
export LMS_MONGODB_URI="$MONGO/lms-bk-e2e"
export COMMISSION_MONGODB_URI="$MONGO/?authSource=admin" COMMISSION_MONGODB_DB="tc-bk-e2e"  # the name given apart
export HRMS_MONGODB_URI="$MONGO/hrms-bk-e2e"
export MEDIA_ERP_MONGODB_URI="$MONGO"                         # no database named
export BACKUP_R2_ENDPOINT="http://127.0.0.1:$R2_PORT" BACKUP_R2_ACCOUNT_ID=""
export BACKUP_R2_ACCESS_KEY_ID="e2e-key" BACKUP_R2_SECRET_ACCESS_KEY="e2e-secret" BACKUP_R2_BUCKET="delta-backups-e2e"
export BACKUP_TIMES="02:30,13:30" BACKUP_KEEP_DAYS="30" BACKUP_WORKER=false BACKUP_ALERT_EMAIL=""
# A run with no "still alive" mark for 8 s is dead here (2 min in production), so the check can wait it out.
export BACKUP_DEAD_AFTER_SECONDS=8
export E2E_API_PORT="$API_PORT" E2E_R2_DIR="$WORK/r2/delta-backups-e2e" E2E_OUT="$WORK/out" E2E_MONGO="$MONGO"

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
if ! grep -q "MongoDB connected: root-backups-e2e" "$WORK/log/api.log"; then
  echo "The backend did not report connecting to the scratch database:" >&2
  tail -30 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi

echo "Backing up, downloading, restoring"
if ! bun --no-env-file "$REPO/src/scripts/backups-check.ts"; then
  echo
  echo "--- last 40 lines of the backend log ---" >&2
  tail -40 "$WORK/log/api.log" | sed -E 's#mongodb(\+srv)?://[^ ]*#<uri>#g' >&2
  exit 1
fi
