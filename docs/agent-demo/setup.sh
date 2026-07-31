#!/usr/bin/env bash
# setup.sh — stand up a working TournaTrak demo inside a Claude Code session.
#
# This is AGENT TOOLING, not part of the product. The shipped demo is
# sales-site/demo/compose.demo.yml + sales-site/demo/demo-seed/ and needs
# Docker; a Claude Code container may not have working Docker registry access
# (image pulls can be blocked even when the daemon itself runs), so everything
# here is assembled by hand instead: a local Postgres, the API on one port,
# and a small static server standing in for nginx on another. Nothing in this
# directory is required to build, deploy or run the real site.
#
#   bash docs/agent-demo/setup.sh            # build it and serve until stopped
#   bash docs/agent-demo/setup.sh --reset    # throw the database away first
#   bash docs/agent-demo/setup.sh --prep     # build it, print the env, exit
#
# IMPORTANT, and the thing that wastes the most time if you skip it: run this
# with the Bash tool's run_in_background, not a trailing `&`. The tool kills a
# call's whole process group when the call returns, so a backgrounded server
# started any other way (`&`, `nohup`, even `setsid`) is dead by the time you
# curl it — while its log still cheerfully says "API listening". This script
# blocks in the foreground on purpose so its children outlive the call.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${TT_DEMO_WORK:-/tmp/tt-demo}"
DB="${TT_DEMO_DB:-tt_demo}"
API_PORT="${TT_DEMO_API_PORT:-3399}"
WEB_PORT="${TT_DEMO_WEB_PORT:-3398}"
PGBIN="${TT_PGBIN:-}"

RESET=0
PREP_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    --prep|--prep-only) PREP_ONLY=1 ;;
    -h|--help) sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

# Run something as the postgres OS user. `env -u` matters: this script
# exports PGUSER=root for the API, and `su` carries the environment across —
# so a plain `su postgres -c createdb` tries to authenticate as root while the
# OS user is postgres, and peer auth refuses it.
as_pg() { su postgres -c "env -u PGUSER -u PGHOST -u PGDATABASE $*"; }

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m!!\033[0m %s\n' "$*" >&2; exit 1; }

mkdir -p "$WORK/data"

# ── 1. Postgres ───────────────────────────────────────────────────────
# Three things bite here every single time:
#   * the config lives in /etc/postgresql, NOT in the data directory, so a
#     bare `pg_ctl -D ...` dies with "could not access the server
#     configuration file";
#   * pg_ctl refuses to run as root, so it has to go through the postgres user;
#   * a container restart leaves a stale postmaster.pid and socket behind,
#     which makes pg_ctl report "another server might be running" and give up.
start_postgres() {
  if pg_isready -q 2>/dev/null; then say "postgres already up"; return; fi

  if [ -z "$PGBIN" ]; then
    PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
  fi
  [ -n "$PGBIN" ] && [ -x "$PGBIN/pg_ctl" ] || die "no postgres install found (set TT_PGBIN)"
  local ver; ver="$(basename "$(dirname "$PGBIN")")"
  local data="/var/lib/postgresql/$ver/main"
  local conf="/etc/postgresql/$ver/main/postgresql.conf"
  [ -d "$data" ] || die "no cluster at $data — run initdb first"

  say "starting postgres $ver"
  rm -f "$data/postmaster.pid" /var/run/postgresql/.s.PGSQL.*
  # pg_ctl runs as `postgres` and cannot create a file in this root-owned
  # work directory — it fails before writing a single line, so the log you
  # then go looking for does not exist either. Create it first and hand it
  # over.
  : >"$WORK/postgres.log"; chown postgres "$WORK/postgres.log" 2>/dev/null
  as_pg "$PGBIN/pg_ctl -D $data -l $WORK/postgres.log \
    -o '-c config_file=$conf' start" >"$WORK/pg_ctl.log" 2>&1

  for _ in $(seq 1 20); do pg_isready -q 2>/dev/null && break; sleep 0.5; done
  pg_isready -q 2>/dev/null || {
    cat "$WORK/pg_ctl.log" >&2 2>/dev/null
    [ -s "$WORK/postgres.log" ] && tail -20 "$WORK/postgres.log" >&2
    die "postgres did not start"
  }
}

# The API connects over a unix socket with peer auth, which checks the OS
# user — so the role has to be named after whoever is running this (root, in
# a Claude Code container). PGUSER=postgres fails peer auth; don't "fix" it
# that way.
ensure_role() {
  local me; me="$(id -un)"
  as_pg "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='$me'\"" 2>/dev/null | grep -q 1 \
    || { say "creating role $me"; as_pg "psql -qc \"CREATE ROLE $me SUPERUSER LOGIN\"" >/dev/null; }
  export PGUSER="$me" PGHOST=/var/run/postgresql
}

ensure_db() {
  if [ "$RESET" = 1 ]; then
    say "dropping $DB"
    as_pg "dropdb --if-exists $DB" 2>/dev/null
  fi
  as_pg "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$DB'\"" 2>/dev/null | grep -q 1 \
    || { say "creating database $DB"
         as_pg "createdb -O $PGUSER $DB" || die "could not create $DB"; }
}

# ── 2. Dependencies ───────────────────────────────────────────────────
# node_modules is gitignored, so a fresh clone has none. The symptom if you
# skip this is misleading: the API test suite reports "server did not start",
# which reads like a database problem and is actually a missing module.
ensure_deps() {
  if [ -d "$REPO/api/node_modules/express" ] && [ -d "$REPO/api/node_modules/web-push" ]; then
    say "api deps present"; return
  fi
  say "installing api deps (npm install)"
  (cd "$REPO/api" && npm install --no-audit --no-fund >"$WORK/npm.log" 2>&1) \
    || { tail -20 "$WORK/npm.log" >&2; die "npm install failed"; }
}

# Playwright is only needed if you intend to drive the demo in a browser. The
# browsers are ALREADY on the image at /opt/pw-browsers — never run
# `playwright install`, it downloads a second copy and can pick a build that
# does not match.
ensure_playwright() {
  [ -d "$WORK/node_modules/playwright" ] && return
  say "installing playwright (browser download skipped — /opt/pw-browsers)"
  (cd "$WORK" && npm init -y >/dev/null 2>&1 \
    && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright --no-audit --no-fund >>"$WORK/npm.log" 2>&1) \
    || warn "playwright install failed — browser specs will not run"
}

# ── 3. Serve ──────────────────────────────────────────────────────────
ADMIN_PASS="demopass1"
COACH_PASS="coachpw1"
SCORER_PASS="scorepw1"

start_api() {
  local hash
  hash="$(cd "$REPO/api" && node -e 'console.log(require("bcryptjs").hashSync(process.argv[1],10))' "$ADMIN_PASS")"
  say "starting api on :$API_PORT"
  (cd "$REPO/api" && \
    PGUSER="$PGUSER" PGHOST="$PGHOST" PGDATABASE="$DB" \
    DATA_DIR="$WORK/data" FRONTEND_DIR="$REPO/frontend" \
    ADMIN_PASSWORD_HASH="$hash" \
    SESSION_SECRET="tt-demo-secret-tt-demo-secret-1234" \
    DEMO_MODE=false PORT="$API_PORT" \
    node server.js >"$WORK/api.log" 2>&1) &
  API_PID=$!
  for _ in $(seq 1 40); do
    curl -sf -o /dev/null "http://127.0.0.1:$API_PORT/api/session" && return 0
    kill -0 "$API_PID" 2>/dev/null || { tail -20 "$WORK/api.log" >&2; die "api exited"; }
    sleep 0.5
  done
  tail -20 "$WORK/api.log" >&2; die "api never answered"
}

start_web() {
  say "starting web on :$WEB_PORT"
  (cd "$WORK" && TT_FRONTEND="$REPO/frontend" TT_API_PORT="$API_PORT" TT_WEB_PORT="$WEB_PORT" \
    node "$REPO/docs/agent-demo/proxy.js" >"$WORK/web.log" 2>&1) &
  WEB_PID=$!
  for _ in $(seq 1 20); do
    curl -sf -o /dev/null "http://127.0.0.1:$WEB_PORT/" && return 0
    sleep 0.5
  done
  tail -20 "$WORK/web.log" >&2; die "web never answered"
}

seed() {
  say "seeding tournament data"
  TT_API="http://127.0.0.1:$API_PORT" \
  TT_ADMIN_PASS="$ADMIN_PASS" TT_COACH_PASS="$COACH_PASS" TT_SCORER_PASS="$SCORER_PASS" \
    node "$REPO/docs/agent-demo/seed.js" || die "seeding failed"
}

cleanup() {
  [ -n "${WEB_PID:-}" ] && kill "$WEB_PID" 2>/dev/null
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

start_postgres
ensure_role
ensure_db
ensure_deps
ensure_playwright
start_api
seed

if [ "$PREP_ONLY" = 1 ]; then
  say "prep done — start the servers yourself with:"
  cat <<EOF

  cd $REPO/api && PGUSER=$PGUSER PGHOST=$PGHOST PGDATABASE=$DB \\
    DATA_DIR=$WORK/data FRONTEND_DIR=$REPO/frontend \\
    ADMIN_PASSWORD_HASH="\$(node -e 'console.log(require("bcryptjs").hashSync("$ADMIN_PASS",10))')" \\
    SESSION_SECRET=tt-demo-secret-tt-demo-secret-1234 DEMO_MODE=false PORT=$API_PORT node server.js

  TT_FRONTEND=$REPO/frontend node $REPO/docs/agent-demo/proxy.js
EOF
  exit 0
fi

start_web

cat <<EOF

  ── TournaTrak demo ────────────────────────────────────────────────
   public bracket   http://127.0.0.1:$WEB_PORT/
   admin panel      http://127.0.0.1:$WEB_PORT/admin
   coach panel      http://127.0.0.1:$WEB_PORT/coach
   api (direct)     http://127.0.0.1:$API_PORT/api

   admin            demo        / $ADMIN_PASS
   scorekeeper      scorer      / $SCORER_PASS
   coach            coach_lopez / $COACH_PASS   (Northside Eagles)
   superadmin       admin       / $ADMIN_PASS

   logs             $WORK/{api,web,postgres}.log
   playwright       require('$WORK/node_modules/playwright')
                    chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

   Restart the API after editing server.js OR any served .html — the API
   renders and CACHES /, /admin, /coach and /lineup, so markup changes are
   invisible until it reboots.
  ───────────────────────────────────────────────────────────────────

EOF

say "serving — this call blocks so the servers stay up; stop it to tear down"
wait
