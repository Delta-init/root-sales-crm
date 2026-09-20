#!/usr/bin/env bash
#
# Brings up the whole thing on this machine, against its own databases.
#
#   ./scripts/local-stack.sh          start everything
#   ./scripts/local-stack.sh stop     stop it again
#
# Why its own databases: the .env files in these repositories point at the
# production servers, so "running it locally" would otherwise mean granting
# yourself access and creating accounts in the live systems. This stands up two
# throwaway mongods under /tmp, seeds them with something realistic, and leaves
# production untouched.
#
set -euo pipefail

PORTAL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FINANCE="${FINANCE_REPO:-/Users/mhdabshar/delta/deltainstitutions/root/finanace-delta}"

PORTAL_MONGO=27101
FINANCE_MONGO=27102
PORTAL_API=5100
PORTAL_WEB=3100
FINANCE_API=4000
FINANCE_WEB=3000

WORK="/tmp/delta-local-stack"
SECRET="local-sandbox-portal-secret"
LONG="$(printf 'x%.0s' {1..40})"

free_port() {
  local pids; pids="$(lsof -ti:"$1" 2>/dev/null || true)"
  # shellcheck disable=SC2086
  [ -n "$pids" ] && kill $pids 2>/dev/null || true
  sleep 0.3
}

stop() {
  echo "Stopping…"
  for p in "$PORTAL_WEB" "$PORTAL_API" "$FINANCE_WEB" "$FINANCE_API"; do free_port "$p"; done
  mongod --dbpath "$WORK/portal-db" --port "$PORTAL_MONGO" --shutdown >/dev/null 2>&1 || true
  mongod --dbpath "$WORK/finance-db" --port "$FINANCE_MONGO" --shutdown >/dev/null 2>&1 || true
  echo "Stopped. Databases kept at $WORK — delete it to start clean."
}

[ "${1:-}" = "stop" ] && { stop; exit 0; }
[ -d "$FINANCE" ] || { echo "Finance is not at $FINANCE. Set FINANCE_REPO." >&2; exit 1; }

echo "Clearing the ports…"
for p in "$PORTAL_WEB" "$PORTAL_API" "$FINANCE_WEB" "$FINANCE_API"; do free_port "$p"; done
mkdir -p "$WORK/portal-db" "$WORK/finance-db" "$WORK/log"

echo "Starting two local mongods…"
lsof -ti:"$PORTAL_MONGO"  >/dev/null 2>&1 || mongod --dbpath "$WORK/portal-db"  --port "$PORTAL_MONGO"  --bind_ip 127.0.0.1 --fork --logpath "$WORK/log/portal-mongo.log" >/dev/null
lsof -ti:"$FINANCE_MONGO" >/dev/null 2>&1 || mongod --dbpath "$WORK/finance-db" --port "$FINANCE_MONGO" --bind_ip 127.0.0.1 --fork --logpath "$WORK/log/finance-mongo.log" >/dev/null

PORTAL_DB="mongodb://127.0.0.1:$PORTAL_MONGO/root-portal-local"
FINANCE_DB="mongodb://127.0.0.1:$FINANCE_MONGO/finance-local"

echo "Seeding finance…"
cd "$FINANCE/apps/api"
MONGODB_URI="$FINANCE_DB" \
JWT_ACCESS_SECRET="$LONG" JWT_REFRESH_SECRET="$LONG" \
SEED_ORG_NAME="Delta HQ" \
SEED_ADMIN_NAME="Root Admin" SEED_ADMIN_EMAIL="root@local.test" SEED_ADMIN_PASSWORD="Password123!" \
SEED_SUPER_ADMIN_NAME="Super Admin" SEED_SUPER_ADMIN_EMAIL="super@local.test" SEED_SUPER_ADMIN_PASSWORD="Password123!" \
FROM_EMAIL="billing@local.test" \
  bun src/scripts/seed.ts > "$WORK/log/finance-seed.log" 2>&1 || {
    echo "Finance seed failed:" >&2; tail -25 "$WORK/log/finance-seed.log" >&2; exit 1; }

FINANCE_ORG_ID="$(mongosh --quiet --port "$FINANCE_MONGO" finance-local \
  --eval 'db.organizations.findOne({}, {_id:1})._id.toString()')"
echo "  finance organization: $FINANCE_ORG_ID"

echo "Starting the finance API on :$FINANCE_API…"
cd "$FINANCE/apps/api"
MONGODB_URI="$FINANCE_DB" API_PORT="$FINANCE_API" NODE_ENV=development \
JWT_ACCESS_SECRET="$LONG" JWT_REFRESH_SECRET="$LONG" \
WEB_ORIGIN="http://localhost:$FINANCE_WEB" \
FROM_EMAIL="billing@local.test" RUN_SCHEDULERS=false \
ROOT_ERP_API_URL="http://localhost:$PORTAL_API" ROOT_ERP_SECRET="$SECRET" \
  bun src/index.ts > "$WORK/log/finance-api.log" 2>&1 &

echo "Starting the finance web on :$FINANCE_WEB…"
cd "$FINANCE/apps/web"
NEXT_PUBLIC_API_URL="http://localhost:$FINANCE_API/api/v1" \
API_INTERNAL_URL="http://localhost:$FINANCE_API/api/v1" \
AUTH_SECRET="$LONG" NEXTAUTH_SECRET="$LONG" NEXTAUTH_URL="http://localhost:$FINANCE_WEB" \
  bun run dev --port "$FINANCE_WEB" > "$WORK/log/finance-web.log" 2>&1 &

echo "Seeding the portal…"
cd "$PORTAL/backend"
MONGODB_URI="$PORTAL_DB" \
LOCAL_FINANCE_API="http://localhost:$FINANCE_API" \
LOCAL_FINANCE_APP="http://localhost:$FINANCE_WEB" \
LOCAL_FINANCE_ORG_ID="$FINANCE_ORG_ID" \
LOCAL_PORTAL_SECRET="$SECRET" \
  bun src/scripts/seed-local.ts

echo "Starting the portal API on :$PORTAL_API…"
MONGODB_URI="$PORTAL_DB" PORT="$PORTAL_API" NODE_ENV=development \
JWT_SECRET="$LONG" JWT_REFRESH_SECRET="$LONG" \
CLIENT_URL="http://localhost:$PORTAL_WEB" RUN_SCHEDULERS=false \
  bun src/index.ts > "$WORK/log/portal-api.log" 2>&1 &

echo "Starting the portal web on :$PORTAL_WEB…"
cd "$PORTAL/web"
NEXT_PUBLIC_API_URL="http://localhost:$PORTAL_API/api/v1" \
  bun run dev --port "$PORTAL_WEB" > "$WORK/log/portal-web.log" 2>&1 &

echo
echo "Waiting for everything to answer…"
for _ in $(seq 1 120); do
  curl -sf "http://localhost:$FINANCE_API/health" >/dev/null 2>&1 \
    && curl -sf "http://localhost:$PORTAL_WEB" >/dev/null 2>&1 \
    && curl -sf "http://localhost:$FINANCE_WEB" >/dev/null 2>&1 && break
  sleep 1
done

cat <<INFO

  ────────────────────────────────────────────────────────────────
   Portal    http://localhost:$PORTAL_WEB      root@local.test / Password123!
   Finance   http://localhost:$FINANCE_WEB      root@local.test / Password123!
  ────────────────────────────────────────────────────────────────

   What to try:

     1. Sign in to the portal as root@local.test
     2. Registry — "Delta HQ Finance (local)" already points at :$FINANCE_API
     3. Access   — Yamini is a member with nothing granted.
                   Give her Delta HQ Finance as "salesperson",
                   then use Create account (she has none there yet).
     4. Sign out, sign in as yamini@local.test, open finance from the
        dashboard. She should land in finance as herself.

   Logs      $WORK/log/
   Stop      ./scripts/local-stack.sh stop

INFO
