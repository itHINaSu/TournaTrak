#!/bin/sh
# entrypoint.sh — zero-touch first-boot secrets.
#
# Goal: `git clone && docker compose up` yields a working, SECURE install
# with nothing else touched. The database password and session secret are
# generated randomly per install on first boot and persisted in the
# tt-secrets volume (never in the image or repo) — see secrets-init in
# compose.yml. The admin account is deliberately NOT auto-generated: the
# operator creates it themselves through the browser on first visit to
# /admin (POST /api/setup), so there's no secret to generate, print, or dig
# out of `docker compose logs`. Explicit env vars always win, so .env
# overrides (a pre-set ADMIN_PASSWORD_HASH for scripted deployments) keep
# working, as do external databases.
#
# Files in $SECRETS_DIR (written by the secrets-init service):
#   pg_password              database password (also read by postgres via
#                            POSTGRES_PASSWORD_FILE)
#   session_secret           express-session signing key
#   admin_password_hash      only present on deployments upgraded from a
#                            version that generated one here; new installs
#                            never write this — with no ADMIN_PASSWORD_HASH
#                            and no users yet, server.js boots with zero
#                            users and /admin shows a "create your admin
#                            account" form (POST /api/setup) instead of a
#                            login form, so there is no secret to generate
#                            or print in the first place.
set -eu

SECRETS_DIR="${SECRETS_DIR:-/run/tt-secrets}"

read_secret() {  # $1 = filename → stdout (empty if missing)
  if [ -f "$SECRETS_DIR/$1" ]; then cat "$SECRETS_DIR/$1"; fi
}

# ── Database password ─────────────────────────────────────────────────
if [ -z "${PGPASSWORD:-}" ]; then
  PGPASSWORD="$(read_secret pg_password)"
  if [ -z "$PGPASSWORD" ]; then
    echo "Fatal: no PGPASSWORD env and no $SECRETS_DIR/pg_password (did secrets-init run?)" >&2
    exit 1
  fi
  export PGPASSWORD
fi

# ── Session secret ────────────────────────────────────────────────────
if [ -z "${SESSION_SECRET:-}" ]; then
  SESSION_SECRET="$(read_secret session_secret)"
  if [ -z "$SESSION_SECRET" ]; then
    echo "Fatal: no SESSION_SECRET env and no $SECRETS_DIR/session_secret (did secrets-init run?)" >&2
    exit 1
  fi
  export SESSION_SECRET
fi

# ── Initial admin credentials ─────────────────────────────────────────
# Only when the operator didn't provide a hash. Honors a hash left over
# from an older version of this script (upgrade case) so an existing
# deployment never loses its bootstrap account; a genuinely new install
# leaves this unset entirely — server.js then boots with zero users and
# the web setup form (POST /api/setup) takes over.
if [ -z "${ADMIN_PASSWORD_HASH:-}" ]; then
  ADMIN_PASSWORD_HASH="$(read_secret admin_password_hash)"
  if [ -n "$ADMIN_PASSWORD_HASH" ]; then
    export ADMIN_PASSWORD_HASH
    export FORCE_PASSWORD_CHANGE="${FORCE_PASSWORD_CHANGE:-true}"
  fi
fi

exec node server.js
