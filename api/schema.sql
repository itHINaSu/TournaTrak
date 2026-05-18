-- schema.sql: TournaTrak Postgres schema
-- Designed for the regional multi-tournament model.
-- Phase 1: a single region and tournament are seeded on first startup.
-- All current queries use tournament_id = 1 (TOURNAMENT_ID constant in server.js).

CREATE TABLE IF NOT EXISTS regions (
  id         SERIAL      PRIMARY KEY,
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tournaments (
  id         SERIAL      PRIMARY KEY,
  region_id  INTEGER     NOT NULL REFERENCES regions(id),
  name       TEXT        NOT NULL,
  is_public  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  tournament_id   INTEGER NOT NULL PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
  tournament_name TEXT    NOT NULL DEFAULT 'Tournament Bracket',
  page_title      TEXT    NOT NULL DEFAULT 'Tournament Bracket',
  admin_name      TEXT    NOT NULL DEFAULT 'Tournament Admin',
  subtitle        TEXT    NOT NULL DEFAULT '',
  left_label      TEXT    NOT NULL DEFAULT 'Left Bracket',
  right_label     TEXT    NOT NULL DEFAULT 'Right Bracket'
);

CREATE TABLE IF NOT EXISTS users (
  id                   SERIAL      PRIMARY KEY,
  region_id            INTEGER     NOT NULL REFERENCES regions(id),
  username             TEXT        NOT NULL,
  password_hash        TEXT,
  role                 TEXT        NOT NULL CHECK (role IN ('admin','results','team','buckets')),
  is_global_admin      BOOLEAN     NOT NULL DEFAULT FALSE,
  must_change_password BOOLEAN     NOT NULL DEFAULT FALSE,
  setup_token          TEXT,
  access_token         TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(region_id, username)
);

-- Team/coach assignments per tournament (replaces teams[] on user JSON)
CREATE TABLE IF NOT EXISTS user_teams (
  user_id       INTEGER NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_name     TEXT    NOT NULL,
  PRIMARY KEY (user_id, tournament_id, team_name)
);

-- Future: per-tournament role overrides (Phase 2 — multi-tournament)
CREATE TABLE IF NOT EXISTS user_tournament_roles (
  user_id       INTEGER NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  role          TEXT    NOT NULL CHECK (role IN ('admin','results','team','buckets')),
  PRIMARY KEY (user_id, tournament_id, role)
);

CREATE TABLE IF NOT EXISTS schedule (
  id            SERIAL  PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  slot_id       TEXT    NOT NULL,
  label         TEXT,
  game_time     TEXT,       -- 'YYYY-MM-DDTHH:MM' — kept as text to match JS date inputs
  slot_num      INTEGER,
  t1_name       TEXT,
  t2_name       TEXT,
  t1_type       TEXT,
  t1_slot       TEXT,
  t2_type       TEXT,
  t2_slot       TEXT,
  is_cleared    BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(tournament_id, slot_id)
);

CREATE TABLE IF NOT EXISTS results (
  id            SERIAL      PRIMARY KEY,
  tournament_id INTEGER     NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  slot_id       TEXT        NOT NULL,
  winner        TEXT,
  loser         TEXT,
  t1_score      INTEGER,
  t2_score      INTEGER,
  saved_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, slot_id)
);

-- Mutable current lineup per game per team (coaches edit until game is complete)
CREATE TABLE IF NOT EXISTS lineups (
  id            SERIAL      PRIMARY KEY,
  tournament_id INTEGER     NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  slot_id       TEXT        NOT NULL,
  team_name     TEXT        NOT NULL,
  rows          JSONB       NOT NULL DEFAULT '[]',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, slot_id, team_name)
);

-- Append-only lineup history for cross-tournament import (Phase 2)
CREATE TABLE IF NOT EXISTS submitted_lineups (
  id            SERIAL      PRIMARY KEY,
  tournament_id INTEGER     NOT NULL REFERENCES tournaments(id),
  slot_id       TEXT        NOT NULL,
  team_name     TEXT        NOT NULL,
  rows          JSONB       NOT NULL,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bucket challenge data: JSONB for now, structured in Phase 2
CREATE TABLE IF NOT EXISTS buckets (
  tournament_id INTEGER NOT NULL PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
  data          JSONB   NOT NULL DEFAULT '{}'
);

-- Region-scoped team registry (populated in Phase 2 when teams register)
CREATE TABLE IF NOT EXISTS teams (
  id        SERIAL  PRIMARY KEY,
  region_id INTEGER NOT NULL REFERENCES regions(id),
  name      TEXT    NOT NULL,
  UNIQUE(region_id, name)
);

-- Win/loss records accumulated per team per tournament (Phase 2)
CREATE TABLE IF NOT EXISTS team_records (
  team_id       INTEGER NOT NULL REFERENCES teams(id)       ON DELETE CASCADE,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  wins          INTEGER NOT NULL DEFAULT 0,
  losses        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, tournament_id)
);
