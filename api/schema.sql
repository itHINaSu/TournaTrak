-- schema.sql — TournaTrak v3 Postgres schema.
-- Reconciled from the feature/regional prototype against the full v2/v4
-- feature set (live scoring, offsets, field/theme colors, builder teams).
-- Applied idempotently at startup by migrate.js.
--
-- Design notes vs the regional prototype:
--   * regions dropped (YAGNI for the v3 roadmap; tournaments are top-level).
--   * settings/offsets/colors/buckets/teams are JSONB config blobs — their
--     shape is owned by the app (settings-defaults.js allowlist) and evolves
--     often; rows for them bought nothing.
--   * schedule/results/lineups/live stay relational (row per slot) for
--     multi-tournament queries, the v4 stats layer, and lineup history.

CREATE TABLE IF NOT EXISTS tournaments (
  id         SERIAL      PRIMARY KEY,
  slug       TEXT        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name       TEXT        NOT NULL,
  is_public  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users are deployment-global; role grants and team assignments scope per
-- tournament (user_roles / user_teams). users.role is the account's BASE
-- role: 'superadmin' acts everywhere; for everyone else it records the
-- account type (v2 compat) while the effective per-tournament role comes
-- from user_roles.
CREATE TABLE IF NOT EXISTS users (
  id                   SERIAL      PRIMARY KEY,
  username             TEXT        NOT NULL UNIQUE,
  password_hash        TEXT,
  role                 TEXT        NOT NULL CHECK (role IN ('superadmin','admin','results','team','buckets')),
  must_change_password BOOLEAN     NOT NULL DEFAULT FALSE,
  setup_token          TEXT,
  access_token         TEXT,
  team_name            TEXT,        -- primary team (v2 compat)
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Refresh the role check on databases created before 'superadmin' existed.
-- Cheap (tiny table) and idempotent-in-effect, so it runs every boot.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('superadmin','admin','results','team','buckets'));

-- Per-tournament role grants. Superadmins need no rows here.
CREATE TABLE IF NOT EXISTS user_roles (
  user_id       INTEGER NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  role          TEXT    NOT NULL CHECK (role IN ('admin','results','team','buckets')),
  PRIMARY KEY (user_id, tournament_id)
);

CREATE TABLE IF NOT EXISTS user_teams (
  user_id       INTEGER NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_name     TEXT    NOT NULL,
  ord           INTEGER NOT NULL DEFAULT 0,  -- array order (teams[0] is the primary team)
  PRIMARY KEY (user_id, tournament_id, team_name)
);

CREATE TABLE IF NOT EXISTS schedule (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  slot_id       TEXT    NOT NULL,
  entry         JSONB   NOT NULL DEFAULT '{}',   -- label/time/field/t1*/t2*/num/bye/clear
  PRIMARY KEY (tournament_id, slot_id)
);

CREATE TABLE IF NOT EXISTS results (
  tournament_id INTEGER     NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  slot_id       TEXT        NOT NULL,
  winner        TEXT,
  loser         TEXT,
  t1_score      INTEGER,
  t2_score      INTEGER,
  saved_at      TIMESTAMPTZ,
  PRIMARY KEY (tournament_id, slot_id)
);

CREATE TABLE IF NOT EXISTS live (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  slot_id       TEXT    NOT NULL,
  period        TEXT    NOT NULL DEFAULT '',
  t1_score      TEXT    NOT NULL DEFAULT '',
  t2_score      TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (tournament_id, slot_id)
);

CREATE TABLE IF NOT EXISTS lineups (
  tournament_id INTEGER     NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  slot_id       TEXT        NOT NULL,
  team_name     TEXT        NOT NULL,
  rows          JSONB       NOT NULL DEFAULT '[]',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, slot_id, team_name)
);

-- Per-tournament config blobs: settings, offsets, field-colors,
-- theme-colors, buckets, teams (builder team list + seeds).
CREATE TABLE IF NOT EXISTS config (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  domain        TEXT    NOT NULL CHECK (domain IN
                  ('settings','offsets','field_colors','theme_colors','buckets','teams')),
  data          JSONB   NOT NULL DEFAULT '{}',
  PRIMARY KEY (tournament_id, domain)
);

-- Express sessions (replaces the JSON FileSessionStore).
CREATE TABLE IF NOT EXISTS sessions (
  sid     TEXT        PRIMARY KEY,
  data    JSONB       NOT NULL,
  expires TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires);
