# docs/

**Agent-facing material only.** Everything here is written for whoever — human
or agent — picks this project up next: context, decisions, plans, and the
tooling an agent needs to see the app running.

**Nothing in this directory is required to build, deploy or run TournaTrak.**
Delete it all and the product still ships. That is the rule for the directory
(owner directive, 2026-07-31), so anything operational belongs elsewhere:

| Operational thing | Lives at |
|---|---|
| How to run and deploy the stack | `README.md` (repo root) |
| Configuration reference | `.env.example` |
| Stack definitions | `compose.yml`, `sales-site/demo/compose.demo.yml` |
| Web server config | `nginx/nginx.conf`, `sales-site/nginx.conf` |
| Database schema | `api/schema.sql` |
| Shipped public demo | `sales-site/demo/compose.demo.yml` + `sales-site/demo/demo-seed/`, reverse-proxied at `/demo/` by the sales site |
| Operator scripts (backup, restore, import) | `scripts/` |

Source comments may *cite* a doc here for rationale (`// See docs/ROLES.md`),
but no code reads a path under `docs/`, and none should start.

## What is here

| | |
|---|---|
| `HANDOFF.md` | **Start here.** Full project context for a fresh session: architecture, conventions, traps, outstanding work. Keep it current in the same commit as the work it describes. |
| `agent-demo/` | Tooling to stand up a seeded, running demo inside a Claude Code session — `bash docs/agent-demo/setup.sh`. Not the shipped demo. |
| `ROADMAP.md` | The v3/v4 plan. |
| `FEATURES.md` | What ships, written for the sales-site agent. Authoritative over `sales-site/SALES_SITE_BRIEF.md`. |
| `ROLES.md` | The permission model and why it is shaped that way. |
| `PENDING.md` | Work parked mid-flight. |
| `EVALUATION.md` | Phase 0 evaluation notes. |
| `GUEST_ACCOUNTS.md` | Guest/coach access design. |
| `LINEUP_STARTER.md` | Lineup feature notes. |
