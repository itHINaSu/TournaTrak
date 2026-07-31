# Agent demo harness

Tooling for **agents working this repo in Claude Code**. Nothing here is
needed to build, deploy or run TournaTrak — delete the whole directory and the
product is unaffected.

```
bash docs/agent-demo/setup.sh
```

Run it with the Bash tool's `run_in_background`. It blocks in the foreground
so the servers it starts stay alive; when the call ends, everything is torn
down. In about 40 seconds you get a seeded tournament at
**http://127.0.0.1:3398**.

| | |
|---|---|
| public bracket | `http://127.0.0.1:3398/` |
| admin panel | `http://127.0.0.1:3398/admin` |
| coach panel | `http://127.0.0.1:3398/coach` |
| API | `http://127.0.0.1:3399/api` |

| account | password | role |
|---|---|---|
| `demo` | `demopass1` | tournament admin |
| `scorer` | `scorepw1` | scorekeeper |
| `coach_lopez` | `coachpw1` | coach, Northside Eagles |
| `admin` | `demopass1` | superadmin |

Flags: `--reset` drops the database first, `--prep` builds everything and
prints the commands to run the servers yourself. Ports and paths come from
`TT_DEMO_WEB_PORT`, `TT_DEMO_API_PORT`, `TT_DEMO_DB`, `TT_DEMO_WORK`.

## Why this exists

The product's demo is `compose.demo.yml` + `demo-seed/`, and it needs Docker.
A Claude Code container has none, so this assembles the same thing by hand:
a local Postgres, the API, and a small static server standing in for nginx.

## What is in here

- **`setup.sh`** — Postgres, dependencies, database, API, seed, web.
- **`proxy.js`** — the nginx stand-in. It reproduces the one behaviour of
  `nginx/nginx.conf` a demo depends on: **which paths the API renders** rather
  than serving off disk. `/`, the public tab paths, `/t/:slug`, `/admin`,
  `/coach` and `/lineup` all get their title, OG tags, tab icon, header name,
  logo and theme stylesheet injected server-side. Serve those from disk and
  the page still loads wearing stock branding — so a branding bug looks fixed
  when it isn't. Keep the list in step with `nginx.conf`.
- **`seed.js`** — 8 teams, a two-sided bracket, one round played, one game
  live, three accounts, and a 9-player roster. Everything goes through the
  HTTP API, never SQL.

## Traps this encodes

Each of these cost real time before it was written down.

- **Background servers die silently.** The Bash tool kills a call's process
  group when the call returns, so `&`, `nohup` and even `setsid` all leave you
  with a log saying `API listening` next to a `curl` getting connection
  refused. Use `run_in_background`.
- **The API caches users in memory.** Change a password with SQL and login
  keeps failing until the process restarts. Seed through the API.
- **The API renders and caches HTML.** Editing `admin.html`, `coach.html`,
  `index.html` or `lineup.html` changes nothing until the API restarts —
  the same `docker compose restart api` rule as production.
- **Postgres:** config lives in `/etc/postgresql`, not the data directory;
  `pg_ctl` will not run as root; a stale `postmaster.pid` survives a container
  restart and makes it refuse to start. `su postgres` also inherits
  `PGUSER=root`, which breaks peer auth — hence `env -u` in `as_pg()`.
- **`PGUSER=postgres` fails peer auth.** Peer auth checks the OS user, so the
  role must be named after whoever is running (root, here).
- **Missing `node_modules` reads as a database error.** The API suite reports
  "server did not start", which is a missing module, not Postgres.
- **Never run `playwright install`.** The browsers are already at
  `/opt/pw-browsers`; launch with
  `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`.
- **`POST /schedule` takes the schedule as the body**, keyed by slot id
  (`R1.L.1`), not `{schedule: [...]}`. Times must be `YYYY-MM-DDTHH:MM`.
  Passwords are 8 characters minimum.

## Tests

The API suite is independent of this harness — it builds and drops its own
scratch database:

```
PGUSER=root PGHOST=/var/run/postgresql node --test \
  api/routes.test.js api/schedule-formats.test.js \
  api/standings.test.js api/schedule-health.test.js
```

It needs Postgres running (`setup.sh` starts it) and `api/node_modules`
installed, or every route test **skips** rather than fails — which reads as
green. Check the skipped count, not just the failure count.
