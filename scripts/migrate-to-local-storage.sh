#!/bin/sh
# Move an EXISTING instance's data out of Docker named volumes and into the
# host directories compose.yml now uses (./pgdata and ./secrets).
#
# Why: named volumes are deleted by `docker compose down -v`, which is the
# first thing anyone tries when a stack misbehaves. It took a live tournament
# once. Host directories are outside Docker's volume lifecycle, so the same
# command is harmless — and the database becomes a directory you can copy.
#
# You only need this on a machine that ran the stack BEFORE the change. A
# fresh clone starts on host directories already and needs nothing.
#
# Usage, from the repo root:
#   docker compose down          # NOT -v — that is what deletes the volumes
#   ./scripts/migrate-to-local-storage.sh
#   docker compose up -d
#
# The old volumes are left untouched, so this is reversible: if anything looks
# wrong, `rm -rf ./pgdata ./secrets`, put the previous compose.yml back, and
# the original volumes are still there.
set -e
cd "$(dirname "$0")/.."

# Compose derives the project name from the directory: lowercased, with
# anything that isn't alphanumeric/underscore/hyphen dropped.
PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]_-')}"

find_volume() {
  # $1 = suffix. Prefer this project's volume; fall back to a unique match so
  # a renamed directory doesn't strand the data.
  if docker volume inspect "${PROJECT}_$1" >/dev/null 2>&1; then
    echo "${PROJECT}_$1"; return 0
  fi
  matches=$(docker volume ls -q | grep -E "_$1\$" || true)
  count=$(printf '%s\n' "$matches" | grep -c . || true)
  if [ "$count" = "1" ]; then echo "$matches"; return 0; fi
  return 1
}

copy_volume() {   # $1 = volume name, $2 = destination directory
  echo "  $1  ->  ./$2"
  mkdir -p "$2"
  # An alpine helper with both sides mounted; -a preserves ownership and
  # permissions, which Postgres checks on startup and refuses to run without.
  docker run --rm \
    -v "$1:/from:ro" \
    -v "$PWD/$2:/to" \
    alpine:3.20 sh -ec 'cp -a /from/. /to/'
}

for dir in pgdata secrets; do
  if [ -d "$dir" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then
    echo "./$dir already has contents — refusing to overwrite it."
    echo "Move it aside first if you really mean to re-migrate."
    exit 1
  fi
done

if docker compose ps --status running -q 2>/dev/null | grep -q .; then
  echo "The stack is still running. Stop it first (docker compose down — NOT -v)."
  exit 1
fi

PG=$(find_volume pgdata) || { echo "No *_pgdata volume found. Nothing to migrate — a fresh install needs no migration."; exit 0; }
SEC=$(find_volume tt-secrets) || { echo "Found $PG but no *_tt-secrets volume."; echo "Both must move together: the password Postgres was initialised with lives in the secrets volume, and without it the API cannot log in to its own database."; exit 1; }

echo "Project: $PROJECT"
echo "Copying:"
copy_volume "$PG"  pgdata
copy_volume "$SEC" secrets

echo
echo "Done. The old volumes are untouched — delete them once you have"
echo "confirmed the site works:"
echo "  docker volume rm $PG $SEC"
echo
echo "Now: docker compose up -d"
