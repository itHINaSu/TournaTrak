#!/bin/sh
# Dump the running stack's database to db-snapshot/tournatrak.sql so the
# exact instance state can be committed and reproduced on another machine
# (scripts/db-restore.sh loads it back). Login sessions are skipped — they
# are transient and tied to browser cookies that won't transfer anyway.
#
# Usage, from the repo root with `docker compose up` running:
#   ./scripts/db-snapshot.sh
#   git add db-snapshot && git commit -m "DB snapshot" && git push
#
# NOTE: the dump contains real account data (bcrypt password hashes, hashed
# team tokens). Fine for a private debugging branch; strip it from history
# before making the repository public.
set -e
cd "$(dirname "$0")/.."
mkdir -p db-snapshot
docker compose exec -T db pg_dump -U tournatrak --clean --if-exists \
  --exclude-table-data=sessions tournatrak > db-snapshot/tournatrak.sql
echo "Wrote db-snapshot/tournatrak.sql ($(wc -c < db-snapshot/tournatrak.sql | tr -d ' ') bytes)."
echo "Commit and push db-snapshot/ to share this exact instance state."
