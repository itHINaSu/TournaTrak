#!/bin/sh
# init-env.sh — first-run environment bootstrap.
#
# If .env.example exists but .env does not, copies it to .env and fills in
# freshly generated random values for SESSION_SECRET and POSTGRES_PASSWORD.
# The default ADMIN_PASSWORD_HASH (password "TournaTrak") is kept as-is;
# FORCE_PASSWORD_CHANGE=true makes the first admin login replace it.
#
# Safe to run repeatedly: an existing .env is never touched.

set -eu
cd "$(dirname "$0")"

if [ -f .env ]; then
  echo ".env already exists — leaving it untouched."
  exit 0
fi
if [ ! -f .env.example ]; then
  echo "Error: .env.example not found." >&2
  exit 1
fi

SESSION_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 32)

# Hex output is [0-9a-f] only, so it's safe inside a sed replacement and
# needs no "$"-escaping for Compose.
sed \
  -e "s/^SESSION_SECRET=.*/SESSION_SECRET=${SESSION_SECRET}/" \
  -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${POSTGRES_PASSWORD}/" \
  .env.example > .env
chmod 600 .env

echo "Created .env with generated SESSION_SECRET and POSTGRES_PASSWORD."
echo "Default admin login: admin / TournaTrak (you must change it on first login)."
echo "Next: docker compose up -d --build"
