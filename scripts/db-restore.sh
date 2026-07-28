#!/bin/sh
# Restore the database from a backup, REPLACING its current contents (the
# dumps carry --clean drop statements).
#
# Usage, from the repo root with `docker compose up` running:
#   ./scripts/db-restore.sh                 # list what's available
#   ./scripts/db-restore.sh latest          # newest rolling backup in ./backups
#   ./scripts/db-restore.sh backups/tournatrak-20260728-060000Z.sql.gz
#   ./scripts/db-restore.sh db-snapshot/tournatrak.sql
#
# Handles both the rolling gzipped backups written by the `backup` compose
# service and the plain .sql produced by scripts/db-snapshot.sh.
set -e
cd "$(dirname "$0")/.."

list() {
  echo "Available backups (newest first):"
  found=""
  for f in $(ls -1t backups/tournatrak-*.sql.gz 2>/dev/null | head -20); do
    echo "  $f"; found=1
  done
  if [ -f db-snapshot/tournatrak.sql ]; then
    echo "  db-snapshot/tournatrak.sql (committed snapshot)"; found=1
  fi
  [ -n "$found" ] || echo "  (none — is the backup service running? docker compose ps backup)"
}

SRC="${1:-}"
if [ -z "$SRC" ]; then
  list; echo; echo "Re-run with a path, or 'latest'."; exit 0
fi

if [ "$SRC" = "latest" ]; then
  SRC="$(ls -1t backups/tournatrak-*.sql.gz 2>/dev/null | head -1)"
  [ -n "$SRC" ] || { echo "No rolling backups in ./backups." >&2; exit 1; }
fi
[ -f "$SRC" ] || { echo "No such file: $SRC" >&2; exit 1; }

if ! docker compose ps --status running -q postgres 2>/dev/null | grep -q .; then
  echo "Postgres isn't running — start the stack first (docker compose up -d)." >&2
  exit 1
fi

echo "About to REPLACE the current database with:"
echo "  $SRC"
printf "Type the word yes to continue: "
read -r reply
[ "$reply" = "yes" ] || { echo "Aborted."; exit 1; }

# Restoring the wrong file should not be the end of it: snapshot the CURRENT
# database first, so there is always a way back to the state you had a moment
# ago. This is the step whose absence made the down -v incident final.
mkdir -p backups
pre="backups/pre-restore-$(date -u +%Y%m%d-%H%M%SZ).sql.gz"
echo "Saving the CURRENT database to $pre first..."
docker compose exec -T postgres pg_dump -U tournatrak --clean --if-exists \
  --exclude-table-data=sessions tournatrak | gzip -9 > "$pre"

case "$SRC" in
  *.gz) gzip -dc "$SRC" ;;
  *)    cat "$SRC" ;;
esac | docker compose exec -T postgres psql -q -U tournatrak -d tournatrak

# The API caches every domain in memory; restart it so it re-reads the DB.
docker compose restart api
echo "Restored from $SRC. Previous contents saved to $pre."
