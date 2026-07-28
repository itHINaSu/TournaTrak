#!/usr/bin/env node
// import-schedule.js — one-shot import of a hand-wired tournament file.
//
// Takes a JSON file describing a complete tournament (schedule topology,
// team list, settings) — typically transcribed from a paper bracket — and
// pushes it to a running TournaTrak server through the normal admin API:
// no direct DB access, so validation and cache invalidation all apply.
//
//   node scripts/import-schedule.js <file.json> \
//     --url http://localhost:8080 --user admin [--slug <tournament>] [--replace]
//
// The admin password is read from the TT_ADMIN_PASS environment variable
// (never a CLI arg — those leak into shell history and process lists).
//
// SAFETY: if the target tournament already has a schedule, the import
// REFUSES to touch it unless --replace is passed. Replacing wipes every
// hand-edit and clears all results — that must never happen by accident.
//
// File shape:
//   {
//     "format":    "round-robin",            // optional; see below
//     "settings":  { ... },                  // optional; merged via POST /settings
//     "teams":     { "showSeeds": false, "teams": [{"name": "..."}] },  // optional
//     "schedule":  { "R1.L.2": { label, time, t1name|t1type+t1slot, ... } }
//   }
//
// "format" declares which format the transcribed schedule IS, for the
// behaviours that hang off it (schedule-first formats render no bracket tree
// and lead with the Schedule tab; standings only apply to those). Omit it for
// an ordinary hand-wired bracket — the import then CLEARS any format left
// over from whatever ran in this tournament before, which is the point:
// without that step, importing over a round robin left the Bracket tab
// refusing to draw the bracket it had just been given.
//
// Existing results/live scores for the replaced schedule are cleared first
// (same behavior as generating from the Builder), so stale scores from a
// previous tournament can't bleed into the imported bracket.

const fs = require('fs');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const file = process.argv[2];
const BASE = (arg('url', 'http://localhost:8080')).replace(/\/$/, '');
const USER = arg('user', 'admin');
const SLUG = arg('slug', '');
const PASS = process.env.TT_ADMIN_PASS || '';

if (!file || !fs.existsSync(file)) {
  console.error('Usage: TT_ADMIN_PASS=... node scripts/import-schedule.js <file.json> [--url URL] [--user USER] [--slug TOURNAMENT]');
  process.exit(1);
}
if (!PASS) {
  console.error('Set the admin password in the TT_ADMIN_PASS environment variable.');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!data.schedule || typeof data.schedule !== 'object') {
  console.error('File has no "schedule" object — nothing to import.');
  process.exit(1);
}

const api = SLUG ? BASE + '/api/t/' + encodeURIComponent(SLUG) : BASE + '/api';
let cookie = '';

async function req(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = r.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let out = {};
  try { out = await r.json(); } catch {}
  if (!r.ok) throw new Error(method + ' ' + path + ' -> ' + r.status + ' ' + (out.error || ''));
  return out;
}

const REPLACE = process.argv.includes('--replace');

(async () => {
  // 1. Login (auth is global, not tournament-scoped)
  await req('POST', '/api/login', { username: USER, password: PASS });
  console.log('logged in as', USER);

  // 1b. Guard: never silently destroy a saved bracket. An import replaces
  // the whole schedule and clears all results, so a non-empty target
  // requires the operator to say --replace explicitly.
  const current = await req('GET', api.replace(BASE, '') + '/schedule');
  const currentGames = Object.keys(current).length;
  if (currentGames && !REPLACE) {
    console.error('REFUSING: the target tournament already has a schedule ('
      + currentGames + ' entries). Importing would replace it and clear all'
      + ' results. Re-run with --replace if that is really what you want.');
    process.exit(2);
  }
  if (currentGames) console.log('replacing existing schedule (' + currentGames + ' entries) — --replace given');

  // 2. Clear results + live for every slot that currently has one
  const existing = await req('GET', api.replace(BASE, '') + '/results');
  const stale = Object.keys(existing);
  for (const sid of stale) {
    await req('DELETE', api.replace(BASE, '') + '/results/' + encodeURIComponent(sid));
  }
  if (stale.length) console.log('cleared', stale.length, 'old result(s)');

  // 3. Replace the schedule (server-side validateSchedule gates this)
  await req('POST', api.replace(BASE, '') + '/schedule', data.schedule);
  console.log('schedule imported:', Object.keys(data.schedule).length, 'games');

  // 4. Teams (optional)
  if (data.teams) {
    await req('POST', api.replace(BASE, '') + '/teams', data.teams);
    console.log('teams imported:', (data.teams.teams || []).length);
  }

  // 5. Format provenance. `settings.format` records which format produced the
  // schedule that is stored, and the public page hangs real behaviour off it:
  // a schedule-first format (round robin, pools, Swiss) renders NO bracket
  // tree and lands on the Schedule tab. Importing over one of those left the
  // stale value behind — the Bracket tab said "this format plays out on the
  // schedule" with a perfectly good bracket sitting behind it. An import
  // replaces the whole schedule, so it always resets this, to `data.format`
  // when the file declares one (a transcribed round robin would) and to
  // nothing otherwise, which is what a hand-wired bracket is.
  // Sent BEFORE /settings so an explicit setting in the file still wins.
  await req('POST', api.replace(BASE, '') + '/schedule/format', {
    format: data.format || '',
    teamCount: (data.teams && data.teams.teams) ? data.teams.teams.length : 0,
  });
  console.log('format set to:', data.format ? data.format : '(hand-wired — no generator format)');

  // 6. Settings (optional; POST /settings merges over existing)
  if (data.settings) {
    await req('POST', api.replace(BASE, '') + '/settings', data.settings);
    console.log('settings applied:', Object.keys(data.settings).join(', '));
  }

  console.log('done — open', BASE + (SLUG ? '/t/' + SLUG : '/'), 'to verify.');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
