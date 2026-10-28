#!/usr/bin/env bash
#
# Root's revenue figures with a Bangalore enrolment's money (services/bangaloreRevenue.ts), through the services, on
# a throwaway mongod holding the portal's database and three scratch CRM databases. Tears it down afterwards.
#
# Nothing here touches a configured database: bun reads no .env, every setting is passed explicitly, and the
# driver refuses anything but scratch databases on 127.0.0.1.
#
#   ./scripts/bangalore-revenue-check.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONGO_PORT="${BLR_MONGO_PORT:-27114}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/bangalore-revenue-check.XXXXXX")"

cleanup() {
  local code=$? pids
  pids="$(lsof -nP -iTCP:"$MONGO_PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
  # shellcheck disable=SC2086
  [ -n "$pids" ] && kill $pids 2>/dev/null || true
  for _ in $(seq 1 40); do lsof -nP -iTCP:"$MONGO_PORT" -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.25; done
  rm -rf "$WORK"
  exit $code
}

if lsof -nP -iTCP:"$MONGO_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $MONGO_PORT is already in use. Set BLR_MONGO_PORT." >&2
  rm -rf "$WORK"
  exit 1
fi
trap cleanup EXIT INT TERM

mkdir -p "$WORK/db" "$WORK/log"
mongod --dbpath "$WORK/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/log/mongod.log" >/dev/null

MONGO="mongodb://127.0.0.1:$MONGO_PORT"
export MONGODB_URI="$MONGO/root-blr-revenue-e2e"
export NODE_ENV=test
export JWT_SECRET="blr-e2e-access-secret-0123456789abcdef"
export JWT_REFRESH_SECRET="blr-e2e-refresh-secret-0123456789abcdef"
export CLIENT_URL="http://localhost:3100"
export DELTA_MONGODB_URI="$MONGO/delta-crm-blr-e2e" REMOTE_MONGODB_URI="$MONGO/remote-crm-blr-e2e" BANGLORE_MONGODB_URI="$MONGO/banglore-crm-blr-e2e" DRAW_MONGODB_URI=""
export DELTA_API_URL="" DRAW_API_URL="" BANGLORE_API_URL="" REMOTE_API_URL=""

cd "$REPO"
DOTENV_CONFIG_PATH=/nonexistent bun --no-env-file run src/scripts/bangalore-revenue-check.ts
