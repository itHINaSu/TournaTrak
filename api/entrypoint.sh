#!/bin/sh
# entrypoint.sh — zero-touch first-boot secrets.
#
# Goal: `git clone && docker compose up` yields a working, SECURE install
# with nothing else touched. Secrets are generated randomly per install on
# first boot and persisted in the tt-secrets volume (never in the image or
# repo). Explicit env vars always win, so .env overrides keep working and
# external databases stay possible.
#
# Files in $SECRETS_DIR (written by the secrets-init service or by us):
#   pg_password              database password (also read by postgres via
#                            POSTGRES_PASSWORD_FILE)
#   session_secret           express-session signing key
#   admin_password_hash      bcrypt hash of the initial admin password
#   initial_admin_password   plaintext of that password — kept ONLY until the
#                            first successful password change, for
#                            `docker compose exec api cat …` recovery
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
# Only when the operator didn't provide a hash. Generated once per install;
# FORCE_PASSWORD_CHANGE makes the first login replace it.
if [ -z "${ADMIN_PASSWORD_HASH:-}" ]; then
  ADMIN_PASSWORD_HASH="$(read_secret admin_password_hash)"
  if [ -z "$ADMIN_PASSWORD_HASH" ]; then
    ADMIN_PW="$(node -e "console.log(require('crypto').randomBytes(9).toString('base64url'))")"
    ADMIN_PASSWORD_HASH="$(node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" "$ADMIN_PW")"
    umask 077
    printf '%s' "$ADMIN_PASSWORD_HASH" > "$SECRETS_DIR/admin_password_hash"
    printf '%s' "$ADMIN_PW" > "$SECRETS_DIR/initial_admin_password"
    echo "──────────────────────────────────────────────────────────────"
    echo " First boot: generated admin credentials"
    echo "   username: ${ADMIN_USERNAME:-admin}"
    echo "   password: $ADMIN_PW"
    echo " You will be required to change it on first login."
    echo " Recover later: docker compose exec api cat $SECRETS_DIR/initial_admin_password"
    echo "──────────────────────────────────────────────────────────────"
  fi
  export ADMIN_PASSWORD_HASH
  export FORCE_PASSWORD_CHANGE="${FORCE_PASSWORD_CHANGE:-true}"
fi

exec node server.js
