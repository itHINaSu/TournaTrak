#!/bin/sh
# Load db-snapshot/tournatrak.sql into the running stack's database,
# REPLACING its current contents (the dump carries --clean drop statements).
#
# Usage, from the repo root with `docker compose up` running:
#   ./scripts/db-restore.sh
set -e
cd "$(dirname "$0")/.."
[ -f db-snapshot/tournatrak.sql ] || { echo "No db-snapshot/tournatrak.sql — run scripts/db-snapshot.sh where the data lives."; exit 1; }
docker compose exec -T postgres psql -q -U tournatrak -d tournatrak < db-snapshot/tournatrak.sql
# The API caches every domain in memory; restart it so it re-reads the DB.
docker compose restart api
echo "Snapshot restored and API restarted."
