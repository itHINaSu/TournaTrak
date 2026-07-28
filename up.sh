#!/bin/sh
# up.sh — bring the stack up and print the admin login in one command.
#
# `docker compose up -d --build` alone doesn't show anything: the container
# that generates and prints the first-boot admin password runs detached, so
# the message only exists in `docker compose logs api` — an easy thing to
# miss, especially when spinning up a second instance and reaching for
# muscle-memory credentials from the first one. This script waits for that
# first boot to finish and prints the credentials (or the real error) right
# here, no follow-up command needed.
#
# Safe to run again later: if the admin password has already been changed,
# it says so instead of pretending to have credentials to show.

set -eu
cd "$(dirname "$0")"

docker compose up -d --build

echo
echo "Waiting for the api container to finish booting..."
API_UP=0
for i in $(seq 1 60); do
  if docker compose exec -T api true 2>/dev/null; then API_UP=1; break; fi
  sleep 1
done

if [ "$API_UP" -ne 1 ]; then
  echo
  echo "api container never became reachable — recent logs:"
  echo "──────────────────────────────────────────────────────────────"
  docker compose logs --tail 50 api
  echo "──────────────────────────────────────────────────────────────"
  exit 1
fi

# entrypoint.sh writes this file only on a genuine first boot (no
# ADMIN_PASSWORD_HASH env, no admin_password_hash already in the secrets
# volume); it's deleted the moment the password is changed.
if docker compose exec -T api test -f /run/tt-secrets/initial_admin_password 2>/dev/null; then
  ADMIN_PW="$(docker compose exec -T api cat /run/tt-secrets/initial_admin_password)"
  echo
  echo "──────────────────────────────────────────────────────────────"
  echo " First-boot admin login:"
  echo "   username: ${ADMIN_USERNAME:-admin}"
  echo "   password: $ADMIN_PW"
  echo " You will be required to change it on first login."
  echo " Recoverable later with:"
  echo "   docker compose exec api cat /run/tt-secrets/initial_admin_password"
  echo "──────────────────────────────────────────────────────────────"
else
  echo
  echo "Admin password already set (not a first boot, or already changed) —"
  echo "sign in with your existing credentials."
fi
