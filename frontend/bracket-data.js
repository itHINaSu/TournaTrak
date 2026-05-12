// bracket-data.js
// Primary key: slot ID e.g. 'R1.L.1', 'R2.R.3', 'QF.L.1', 'SF.R.1', 'CHAMP.C.1'
// Slot ID format: {ROUND}.{SIDE}.{NUM}  SIDE = L|R|C, NUM = 1-based
// Team source: { type:'winner'|'loser', slot:'R1.L.1' } or { type:'fixed', team:'...' }
//
// Time format: ISO local datetime string 'YYYY-MM-DDTHH:MM'
// All game data (teams, times, structure) lives in schedule.json and is applied
// via applySchedule() on page load. Nothing is hardcoded here.
// formatTime(t) → 'm/d Day H:MM AM/PM'   parseTimeVal(t) → ms for sorting

const SLOT_DEFS = {
  R1:    { L:[1,2,3,4,5,6,7,8], R:[1,2,3,4,5,6,7,8] },
  R2:    { L:[1,2,3,4],         R:[1,2,3,4] },
  QF:    { L:[1,2],             R:[1,2] },
  SF:    { L:[1],               R:[1] },
  CHAMP: { C:[1] }
};

const ROUND_ORDER  = ['R1','R2','QF','SF','CHAMP'];
const ROUND_LABELS = {
  R1:'Round 1', R2:'Round 2', QF:'Quarter Finals', SF:'Semi Finals', CHAMP:'Championship'
};

// ── Time helpers ──────────────────────────────────────────────────────
// t should be 'YYYY-MM-DDTHH:MM' (ISO local, no timezone)
// Returns sortable ms; empty/invalid times sort to end.
function parseTimeVal(t) {
  if (!t) return Infinity;
  var d = new Date(t);
  return isNaN(d.getTime()) ? Infinity : d.getTime();
}

// Formats 'YYYY-MM-DDTHH:MM' → 'm/d Day H:MM AM/PM'  e.g. '7/19 Sun 11:30 AM'
// Returns empty string for empty input; raw string as fallback if unparseable.
function formatTime(t) {
  if (!t) return '';
  var d = new Date(t);
  if (isNaN(d.getTime())) return t;
  var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var m    = d.getMonth() + 1;
  var day  = d.getDate();
  var dow  = days[d.getDay()];
  var h    = d.getHours();
  var min  = d.getMinutes();
  var ampm = h >= 12 ? 'PM' : 'AM';
  var h12  = h % 12 || 12;
  var ms   = min < 10 ? '0' + min : '' + min;
  return m + '/' + day + ' ' + dow + ' ' + h12 + ':' + ms + ' ' + ampm;
}

// ── Slot ID helpers ───────────────────────────────────────────────────
function parseSlotId(sid) {
  const p = sid.split('.');
  return { round:p[0], side:p[1], num:parseInt(p[2]) };
}

function allSlotIds() {
  const ids = [];
  for (const round of ROUND_ORDER) {
    const sides = SLOT_DEFS[round] || {};
    for (const side of Object.keys(sides).sort()) {
      for (const n of sides[side]) ids.push(round+'.'+side+'.'+n);
    }
  }
  return ids;
}

function slotsForRoundSide(round, side) {
  return Object.keys(GAMES)
    .filter(s => GAMES[s].round===round && GAMES[s].side===side)
    .sort((a,b) => GAMES[a].num - GAMES[b].num);
}

function occupiedSlots() {
  return Object.keys(GAMES).sort((a,b) => {
    const pa=parseSlotId(a), pb=parseSlotId(b);
    const ri = ROUND_ORDER.indexOf(pa.round) - ROUND_ORDER.indexOf(pb.round);
    if (ri!==0) return ri;
    if (pa.side !== pb.side) return pa.side < pb.side ? -1 : 1;
    return pa.num - pb.num;
  });
}

// ── GAMES — live working object, fully populated by applySchedule() ───
// Starts empty. All game data comes from schedule.json via the admin panel.
const GAMES = {};

// ── Core helpers ──────────────────────────────────────────────────────
function resolveSlot(teamSlot, results) {
  if (!teamSlot) return null;
  if (teamSlot.type==='fixed')  return teamSlot.team;
  if (teamSlot.type==='winner') return (results[teamSlot.slot]||{}).winner || null;
  if (teamSlot.type==='loser')  return (results[teamSlot.slot]||{}).loser  || null;
  return null;
}

function slotLabel(teamSlot) {
  if (!teamSlot) return '';
  if (teamSlot.type==='fixed') return teamSlot.team;
  const g = GAMES[teamSlot.slot];
  const lbl = g ? (g.label || teamSlot.slot) : teamSlot.slot;
  return (teamSlot.type==='winner' ? 'Winner of ' : 'Loser of ') + lbl;
}

function shortName(name) {
  if (!name) return name;
  return name.trim().split(/\s+/).slice(0,2).join(' ');
}

function smartLabel(teamSlot, results) {
  if (!teamSlot) return '';
  const resolved = resolveSlot(teamSlot, results);
  if (resolved) return resolved;
  if (teamSlot.type==='fixed') return teamSlot.team;
  const sourceG = GAMES[teamSlot.slot];
  if (!sourceG) return slotLabel(teamSlot);
  const p1 = resolveSlot(sourceG.t1, results);
  const p2 = resolveSlot(sourceG.t2, results);
  if (p1 && p2) {
    return (teamSlot.type==='winner' ? 'Winner of ' : 'Loser of ')
      + shortName(p1) + ' / ' + shortName(p2);
  }
  return slotLabel(teamSlot);
}

function findNextSlot(sid, type) {
  for (const [nsid, ng] of Object.entries(GAMES)) {
    if (ng.t1.type===type && ng.t1.slot===sid) return nsid;
    if (ng.t2.type===type && ng.t2.slot===sid) return nsid;
  }
  return null;
}

function isEliminated(teamName, results) {
  for (const [sid, r] of Object.entries(results)) {
    if (r.loser===teamName && ['QF','SF','CHAMP'].includes(GAMES[sid]?.round)) return true;
  }
  let losses=0;
  for (const r of Object.values(results)) { if (r.loser===teamName) losses++; }
  return losses>=2;
}

// ── Schedule overrides ────────────────────────────────────────────────
// Rebuilds GAMES from scratch on every call — idempotent, no stale state.
// Entries with { clear: true } are skipped (slot remains empty).
function applySchedule(schedule) {
  // Wipe live object
  Object.keys(GAMES).forEach(k => delete GAMES[k]);

  for (const [sid, ov] of Object.entries(schedule)) {
    // { clear: true } means the slot should be empty — skip it
    if (ov.clear) continue;

    const parsed = parseSlotId(sid);
    if (!parsed.round || !parsed.side || isNaN(parsed.num)) continue;

    // Require at minimum a label and at least one team to create a game
    if (!ov.label) continue;

    const t1 = ov.t1name
      ? { type:'fixed', team:ov.t1name }
      : (ov.t1slot ? { type:(ov.t1type||'winner'), slot:ov.t1slot } : null);
    const t2 = ov.t2name
      ? { type:'fixed', team:ov.t2name }
      : (ov.t2slot ? { type:(ov.t2type||'winner'), slot:ov.t2slot } : null);

    if (!t1 || !t2) continue; // both teams required

    GAMES[sid] = {
      label: ov.label,
      round: parsed.round,
      side:  parsed.side,
      num:   ov.num != null ? parseInt(ov.num) : parsed.num,
      time:  ov.time || '',
      t1:    t1,
      t2:    t2,
    };
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    GAMES, SLOT_DEFS, ROUND_ORDER, ROUND_LABELS,
    allSlotIds, parseSlotId, occupiedSlots, slotsForRoundSide,
    resolveSlot, slotLabel, smartLabel, shortName,
    isEliminated, findNextSlot, applySchedule,
    formatTime, parseTimeVal
  };
}
