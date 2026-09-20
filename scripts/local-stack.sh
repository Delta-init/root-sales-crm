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
HRMS="${HRMS_REPO:-/Users/mhdabshar/delta/hrms}"

PORTAL_MONGO=27101
FINANCE_MONGO=27102
HRMS_MONGO=27103
PORTAL_API=5100
PORTAL_WEB=3100
FINANCE_API=4000
FINANCE_WEB=3000
HRMS_API=4100

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
  for p in "$PORTAL_WEB" "$PORTAL_API" "$FINANCE_WEB" "$FINANCE_API" "$HRMS_API"; do free_port "$p"; done
  mongod --dbpath "$WORK/hrms-db" --port "$HRMS_MONGO" --shutdown >/dev/null 2>&1 || true
  mongod --dbpath "$WORK/portal-db" --port "$PORTAL_MONGO" --shutdown >/dev/null 2>&1 || true
  mongod --dbpath "$WORK/finance-db" --port "$FINANCE_MONGO" --shutdown >/dev/null 2>&1 || true
  echo "Stopped. Databases kept at $WORK — delete it to start clean."
}

[ "${1:-}" = "stop" ] && { stop; exit 0; }
[ -d "$FINANCE" ] || { echo "Finance is not at $FINANCE. Set FINANCE_REPO." >&2; exit 1; }

echo "Clearing the ports…"
for p in "$PORTAL_WEB" "$PORTAL_API" "$FINANCE_WEB" "$FINANCE_API" "$HRMS_API"; do free_port "$p"; done
mkdir -p "$WORK/portal-db" "$WORK/finance-db" "$WORK/hrms-db" "$WORK/log"

echo "Starting three local mongods…"
lsof -ti:"$PORTAL_MONGO"  >/dev/null 2>&1 || mongod --dbpath "$WORK/portal-db"  --port "$PORTAL_MONGO"  --bind_ip 127.0.0.1 --fork --logpath "$WORK/log/portal-mongo.log" >/dev/null
lsof -ti:"$FINANCE_MONGO" >/dev/null 2>&1 || mongod --dbpath "$WORK/finance-db" --port "$FINANCE_MONGO" --bind_ip 127.0.0.1 --fork --logpath "$WORK/log/finance-mongo.log" >/dev/null
lsof -ti:"$HRMS_MONGO"    >/dev/null 2>&1 || mongod --dbpath "$WORK/hrms-db"    --port "$HRMS_MONGO"    --bind_ip 127.0.0.1 --fork --logpath "$WORK/log/hrms-mongo.log" >/dev/null

PORTAL_DB="mongodb://127.0.0.1:$PORTAL_MONGO/root-portal-local"
FINANCE_DB="mongodb://127.0.0.1:$FINANCE_MONGO/finance-local"
HRMS_DB="mongodb://127.0.0.1:$HRMS_MONGO/hrms-local"

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

# ── HRMS ────────────────────────────────────────────────────────────────────
#
# Where a person first exists: HR creates the employee here and the portal
# imports them. Run locally so that import can be tried without reading the
# real staff directory.
#
# HRMS has its own .env pointing at the production database and Bun loads it
# automatically. Variables given on the command line win over it, but "should
# win" is not good enough for a production database, so once it is up we check
# which mongod it actually connected to and refuse to go on if it is not ours.
echo "Seeding HRMS…"
mongosh --quiet --port "$HRMS_MONGO" hrms-local --eval '
  db.organizations.deleteMany({});
  db.employees.deleteMany({});
  const org = db.organizations.insertOne({
    name: "Delta Institutions (local)", code: "DELTA",
    country: "AE", currency: "AED", timezone: "Asia/Dubai",
    isActive: true, createdAt: new Date(), updatedAt: new Date(),
  });
  const orgId = org.insertedId;
  const people = [
    ["EMP001", "Basil Muhammed",  "basil@local.test",  "BDE",          "active"],
    ["EMP002", "Lubna Khanam",    "lubna@local.test",  "Team Leader",  "active"],
    ["EMP003", "Yamini",          "yamini@local.test", "BDE",          "active"],
    ["EMP004", "Arjun Nair",      "arjun@local.test",  "Accountant",   "active"],
    ["EMP005", "Priya Raman",     "priya@local.test",  "HR Executive", "active"],
    ["EMP006", "Former Employee", "gone@local.test",   "BDE",          "resigned"],
  ];
  db.employees.insertMany(people.map(function (p) {
    return {
      organization: orgId, employeeCode: p[0], name: p[1], email: p[2],
      designation: p[3], status: p[4], employmentType: "full_time",
      currency: "AED", joiningDate: new Date("2024-01-15"),
      createdAt: new Date(), updatedAt: new Date(),
    };
  }));
  print("  seeded " + db.employees.countDocuments({}) + " employees");
' || { echo "HRMS seed failed" >&2; exit 1; }

HRMS_ORG="$(mongosh --quiet --port "$HRMS_MONGO" hrms-local \
  --eval 'db.organizations.findOne({}, {_id:1})._id.toString()')"
echo "  hrms organization: $HRMS_ORG"

echo "Starting HRMS on :$HRMS_API…"
cd "$HRMS/hrms-backend"
MONGODB_URI="$HRMS_DB" PORT="$HRMS_API" NODE_ENV=development \
JWT_SECRET="$LONG" JWT_REFRESH_SECRET="$LONG" ACCESS_TOKEN_SECRET="$LONG" REFRESH_TOKEN_SECRET="$LONG" \
INTEGRATION_CLIENT_ID="root-portal" INTEGRATION_SECRET="$LONG" \
SMTP_HOST="" SMTP_USER="" SMTP_PASS="" \
RUN_SCHEDULERS=false RUN_JOBS=false \
  bun src/index.ts > "$WORK/log/hrms-api.log" 2>&1 &
HRMS_PID=$!

# Prove it is on the scratch database before anything touches it.
for _ in $(seq 1 40); do
  curl -s -o /dev/null "http://localhost:$HRMS_API/api/v1/health" && break
  sleep 0.5
done
if ! lsof -p "$HRMS_PID" -a -i TCP -n 2>/dev/null | grep -q ":$HRMS_MONGO"; then
  echo "" >&2
  echo "REFUSING TO CONTINUE: HRMS did not connect to the local mongod on $HRMS_MONGO." >&2
  echo "Its own .env points at the production database, so it may be on that instead." >&2
  lsof -p "$HRMS_PID" -a -i TCP -n 2>/dev/null | sed 's/^/  /' >&2
  kill "$HRMS_PID" 2>/dev/null
  exit 1
fi
echo "  confirmed: HRMS is on the local mongod, not production"

echo "Seeding the portal…"
cd "$PORTAL/backend"
MONGODB_URI="$PORTAL_DB" \
  bun src/scripts/seed-local.ts

# How the portal reaches finance. These live in the environment rather than in
# the database — see backend/src/config/targets.ts — so the rig has to set them
# the same way a real deployment does.
export FINANCE_HQ_APP_URL="http://localhost:$FINANCE_WEB"
export FINANCE_HQ_API_URL="http://localhost:$FINANCE_API"
export FINANCE_HQ_SSO_SECRET="$SECRET"
export FINANCE_HQ_REMOTE_ORG_ID="$FINANCE_ORG_ID"
export FINANCE_HQ_SERVICE_EMAIL="root@local.test"

# HRMS, both as a target and as the directory the import reads.
export HRMS_APP_URL="http://localhost:$HRMS_API"
export HRMS_API_URL="http://localhost:$HRMS_API"
export HRMS_SSO_SECRET="$SECRET"
export HRMS_SERVICE_EMAIL="root@local.test"
export HRMS_CLIENT_ID="root-portal"
export HRMS_INTEGRATION_SECRET="$LONG"
export HRMS_ORG_ID="$HRMS_ORG"

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
