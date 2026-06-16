# TournaTrak — Code Review & Recommendation Document

Generated from a deep-dive session covering `api/`, `frontend/`, `nginx/`, and the sales site.
Intended for a follow-up session to prioritize and implement changes.

---

## 1. Security

### 1.1 Strengths (keep as-is)

| Item | Location | Notes |
|------|----------|-------|
| bcrypt cost-12 hashing | `api/server.js` | Correct and sufficient |
| Rate limiting on `/api/login` | `api/server.js` | 10 attempts / 15-min window, in-memory |
| Session regeneration on login | `api/server.js` | Prevents session fixation |
| SENTINEL_HASH timing safety | `api/server.js` | Prevents username enumeration via timing |
| httpOnly + sameSite:strict cookies | `api/server.js` | Strong defense against session theft |
| JSON body size limit (10kb) | `api/server.js` | Prevents request flooding |
| Input validation (slot IDs, scores, names) | `api/validation.js` | Allowlist-based, auto-derived from SLOT_DEFS |
| Role middleware (requireAdmin, requireResults…) | `api/server.js` | Correctly layered |
| CSP + security headers in nginx | `nginx/nginx.conf` | SAMEORIGIN, nosniff, Referrer-Policy |
| Lineup locked after result posted | `api/server.js:708` | Prevents late lineup changes |
| Admin page served by nginx, not Express | nginx config | Separation of auth surface is clean |

### 1.2 Issues to Fix

#### HIGH — `files/results.json` and `files/schedule.json` in git

**Location:** `.gitignore`

These were temporarily un-ignored for development. They contain live tournament data (team names, results). Re-add both to `.gitignore` and remove the committed files before any public push. See ROADMAP "Rectify before starting v3."

```bash
git rm --cached files/results.json files/schedule.json
# Add back to .gitignore
git commit -m "Re-ignore live data files"
```

---

#### MEDIUM — `unsafe-inline` in CSP weakens XSS protection

**Location:** `nginx/nginx.conf:34`

```
script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
```

`unsafe-inline` allows any inline script or style to run, including injected ones. The app currently uses inline `<script>` blocks in HTML and inline `<style>` tags. To fix:
- Move inline JS to external `.js` files
- Move inline styles to CSS classes
- Then switch CSP to `script-src 'self'; style-src 'self'`

This is a refactor task — track as a v2 cleanup item before any public exposure.

---

#### MEDIUM — In-memory rate limiter and session store reset on API restart

**Location:** `api/server.js`

The login rate limiter (`loginAttempts` Map) and the session store (MemoryStore) are both in-memory. A container restart clears both. An attacker who can trigger restarts (e.g., resource exhaustion, OOM) can bypass rate limiting.

**Mitigations (pick one per issue):**
- Rate limiter: Replace with Redis or a filesystem-backed store (e.g., `rate-limit-redis`), or move to nginx `limit_req_zone`
- Session store: Replace MemoryStore with `express-session` + `connect-redis` or `better-sqlite3-session-store`

For the current use case (single low-traffic instance), the risk is low but worth noting for v3 planning.

---

#### LOW — No CSRF protection beyond `sameSite: strict`

**Location:** `api/server.js`

`sameSite: strict` blocks cross-origin cookie sending, which effectively prevents CSRF from external sites. However, this assumes no subdomain compromise and browser compliance. Formally correct for this architecture. For belt-and-suspenders, consider adding a `csrf` token check on state-mutating API endpoints in v3.

---

#### LOW — `FORCE_PASSWORD_CHANGE` enforced client-side only

**Location:** `frontend/admin.js`

The server returns `mustChangePassword: true` in the login response. The admin JS redirects to the change-password UI. But the API itself does not block non-change-password routes when this flag is set. A motivated attacker with the session could skip the redirect and use admin endpoints directly.

**Fix:** Add a middleware check on admin routes that returns 403 if `req.session.mustChangePassword === true` and the route is not the change-password endpoint.

---

### 1.3 Sales-site specific security (when self-hosting)

The sales site (`sales-site/`) is a separate nginx container. Its nginx.conf is already configured with:
- `autoindex off`
- Security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- 1h CSS/JS cache, 30d image cache

**Missing from sales site nginx.conf:** CSP header. Add:
```nginx
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self';" always;
```
The sales site uses no inline scripts or styles (script.js and style.css are external), so a strict CSP is achievable immediately.

---

## 2. Code Consistency

### 2.1 Three copies of SETTINGS_DEFAULTS

**Locations:**
- `api/server.js:SETTINGS_DEFAULTS` (authoritative — served to clients)
- `frontend/admin.js:SETTING_DEFAULTS` (used to render settings form)
- `frontend/bracket.js:SETTING_DEFAULTS` (used as fallback when API is unavailable)

All three must be kept in sync manually. They diverged in the v3 branch (`feature/regional`) and will need reconciliation. **Recommendation:** In v3, serve settings defaults from the API only, and have the frontend fetch them once on init with a short-lived cache.

### 2.2 SW cache version must be manually bumped

**Location:** `frontend/sw.js` (cache name `tournatrak-v2.15`)

Any change to a precached asset requires bumping the version string. There's no tooling to enforce this. **Risk:** Stale cache if the version is forgotten. **Recommendation:** Add a comment block at the top of sw.js listing which files are precached, and add "bump sw version" to the commit checklist in HANDOFF.md (already partially there).

### 2.3 Slot ID max validation derives from SLOT_DEFS

**Location:** `api/validation.js:_MAX_SLOT_NUM`

The max slot number is computed dynamically from `SLOT_DEFS`. This is correct and avoids a hardcoded constant. Keep this pattern.

### 2.4 Lineup: softball-specific field names

**Location:** `api/server.js:716`, `frontend/lineup.html`

The lineup row fields (`jersey`, `name`, `position`) are softball/baseball-specific. For multi-sport use in v3/v4, these should be configurable or use generic labels. **Noted in HANDOFF.md and ROADMAP.md** — do not change in v2.

---

## 3. Efficiency

### 3.1 JSON file cache (good pattern — keep)

The in-memory JSON cache keyed by file path with SHA1 ETags and `structuredClone` for mutation safety is well-implemented. ETags allow 304 responses on the public endpoints, reducing bandwidth for repeat polls.

**One optimization:** The ETag (`etagForFile`) recomputes SHA1 on every call. Consider storing the ETag alongside the cached value and invalidating it only when `writeJSON` is called on that path.

### 3.2 Client-side polling for live scores

**Location:** `frontend/bracket.js` — polls `/api/live` and `/api/results`

Polling interval appears to be every few seconds. This is fine for the current load but would not scale to many concurrent users. For v3, consider Server-Sent Events (SSE) or WebSocket push instead of polling.

### 3.3 Service worker precache covers all static assets

This means first load after install is fully offline-capable. Good for spotty tournament-field Wi-Fi. No change needed.

### 3.4 `generateUsers` called on every startup

**Location:** `api/server.js:bootstrapUsers`

The users.json bootstrap runs on every server start and reads the file. It's fast (one read) and safe (no-op if file exists), but the timing creates a minor opportunity for a TOCTOU if the file is being written simultaneously. For the single-instance use case this is not a real concern.

---

## 4. Visual Appeal

### 4.1 Strengths

- **Dark theme with gold + blue** — distinctive and legible. The gold-for-time, blue-for-scores semantic is a nice detail.
- **Pulsing LIVE badge** — immediately draws attention. No layout shift (replaces time text in place).
- **Mobile bracket two-column swipe** — clever use of horizontal scroll per bracket side. `earlyY`/`lateY` convergence is non-obvious but the UX result is good.
- **Oswald + Barlow font pairing** — bold labels with readable team names. Works well at small sizes.
- **Win (green) / Loss (red) card backgrounds** — color instantly communicates status without reading.
- **Team Path connector lines** — the vertical card chains with win/loss connectors are clean.

### 4.2 Suggestions

#### Light theme polish
The light theme (`prefers-color-scheme: light`) is functional but not as refined as the dark theme. Colors like `--gold: #a07800` on white backgrounds should be checked for WCAG AA contrast. Consider a dedicated light-theme design pass in v3.

#### Admin panel mobile layout
The admin panel (`admin.html`) is usable on mobile but was not designed mobile-first. The result card layout with multiple buttons gets cramped on narrow screens. A v3 admin redesign should start from mobile.

#### Score input affordance
The score fields in the live-scoring flow are small form inputs. On a phone, fat-finger mistakes are easy. Consider larger input targets or a +/- stepper for live score entry.

#### Bracket card minimum size
On very small phones (< 360px), bracket cards can get clipped or overflow. The `em`-based sizing adapts well but testing at 360px width would be worthwhile.

#### Icons
The current trophy icon (`frontend/icons/trophy-*.png`) is clean and works well as a PWA icon. The admin icon (`admin-*.png`) is placeholder-quality. Consider matching the trophy style for v3.

---

## 5. Summary Priority Table

| Priority | Area | Item |
|----------|------|------|
| 🔴 HIGH | Security | Re-add `results.json` / `schedule.json` to .gitignore before any public push |
| 🟠 MEDIUM | Security | Eliminate `unsafe-inline` from CSP (requires moving inline scripts/styles) |
| 🟠 MEDIUM | Security | Add CSP to sales-site nginx.conf |
| 🟠 MEDIUM | Security | Server-enforce `mustChangePassword` (currently client-side only) |
| 🟡 LOW | Security | Rate limiter persistence across restarts (low risk for current use) |
| 🟡 LOW | Security | CSRF tokens (low risk, sameSite:strict covers most cases) |
| 🟠 MEDIUM | Consistency | Add "bump sw version" to PR/commit checklist |
| 🟡 LOW | Consistency | Single source of truth for SETTINGS_DEFAULTS (v3 scope) |
| 🟡 LOW | Efficiency | Cache ETag alongside JSON to avoid SHA1 recomputation |
| 🟡 LOW | Efficiency | Consider SSE/WebSocket for live score push (v3 scope) |
| 🟡 LOW | Visual | Light theme WCAG contrast audit |
| 🟡 LOW | Visual | Admin panel mobile-first redesign (v3 scope) |
| 🟡 LOW | Visual | Larger score input targets for live scoring on mobile |

---

## 6. What Not to Change

- The JSON file persistence layer — it's clean and purpose-appropriate for v2
- The slot ID system and SLOT_DEFS — well-designed and auto-deriving
- The ETag + structuredClone cache pattern — keep for v3 Postgres caching layer too
- The bcrypt + SENTINEL_HASH + session regen auth stack — solid
- The mobile bracket two-column swipe UX — users will expect this in v3
- The service worker PWA setup — works well, don't break it in v3
