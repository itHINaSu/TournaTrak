// bracket-data.js
// GAMES is empty by default — all games are defined via schedule.json / applySchedule()
// Primary key: slot ID e.g. 'R1.L.1', 'R2.R.3', 'QF.L.1', 'SF.R.1', 'CHAMP.C.1'
// Slot ID format: {ROUND}.{SIDE}.{NUM}  SIDE = L|R|C, NUM = 1-based
// Team source: { type:'winner'|'loser', slot:'R1.L.1' } or { type:'fixed', team:'...' }
// Time format: ISO local datetime 'YYYY-MM-DDTHH:MM' — set via admin panel

// IMPORTANT: Keep in sync with api/slot-defs.js (API container cannot import this file).
const SLOT_DEFS = {
  R1:    { L:[1,2,3,4,5,6,7,8], R:[1,2,3,4,5,6,7,8] },
  R2:    { L:[1,2,3,4],         R:[1,2,3,4] },
  QF:    { L:[1,2,3,4],         R:[1,2,3,4] },
  QF2:   { L:[1,2],             R:[1,2] },
  SF:    { L:[1,2,3],           R:[1,2,3] },
  CHAMP: { C:[1] }
};

const ROUND_ORDER  = ['R1','R2','QF','QF2','SF','CHAMP'];
const ROUND_LABELS = {
  R1:'Round 1', R2:'Round 2', QF:'Quarter Finals', QF2:'Quarter Finals 2', SF:'Semi Finals', CHAMP:'Championship'
};

// GAMES starts empty — populated by applySchedule() on load
const GAMES = {};

// ── Time helpers ──────────────────────────────────────────────────────
// t: 'YYYY-MM-DDTHH:MM' (ISO local, no timezone)
// Returns ms for sorting; empty/unparseable times sort to end.
function parseTimeVal(t) {
  if (!t) return Infinity;
  var d = new Date(t);
  return isNaN(d.getTime()) ? Infinity : d.getTime();
}

// Formats 'YYYY-MM-DDTHH:MM' → 'm/d Sunday 11:30 AM'
// Full day name used everywhere — no abbreviations.
// Returns empty string for empty input; raw string as fallback if unparseable.
function formatTime(t) {
  if (!t) return '';
  var d = new Date(t);
  if (isNaN(d.getTime())) return t;
  var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
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

// ── Core helpers ──────────────────────────────────────────────────────
function resolveSlot(teamSlot, results) {
  if (!teamSlot) return null;
  if (teamSlot.type==='fixed')  return teamSlot.team || null;
  if (teamSlot.type==='winner') return (results[teamSlot.slot]||{}).winner || null;
  if (teamSlot.type==='loser')  return (results[teamSlot.slot]||{}).loser  || null;
  return null;
}

function slotLabel(teamSlot) {
  if (!teamSlot) return '?';
  if (teamSlot.type==='fixed') return teamSlot.team || '?';
  const g = GAMES[teamSlot.slot];
  const lbl = g ? (g.label || teamSlot.slot) : teamSlot.slot;
  return (teamSlot.type==='winner' ? 'Winner of ' : 'Loser of ') + lbl;
}

// shortName: ONLY for use in "Team A / Team B" display inside smartLabel.
// Truncates at "/" first (e.g. "Hoegeymeyer/Feld Fire" → "Hoegeymeyer"),
// then keeps at most 2 words (e.g. "High Point Roofing" → "High Point").
// Never call this when displaying a single team name on its own.
function shortName(name) {
  if (!name) return '';
  var s = name.trim().split('/')[0].trim(); // drop everything from "/" onward
  return s.split(/\s+/).slice(0, 2).join(' '); // max 2 words
}

// smartLabel: returns the best available label for a team slot.
// When both source teams are known but the slot isn't resolved yet,
// returns "Winner/Loser of ShortA / ShortB".
// shortName is ONLY applied inside the "X / Y" composition here.
function smartLabel(teamSlot, results) {
  if (!teamSlot) return '?';
  const resolved = resolveSlot(teamSlot, results);
  if (resolved) return resolved;
  if (teamSlot.type==='fixed') return teamSlot.team || '?';
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
    if (ng.t1 && ng.t1.type===type && ng.t1.slot===sid) return nsid;
    if (ng.t2 && ng.t2.type===type && ng.t2.slot===sid) return nsid;
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

// ── applySchedule ─────────────────────────────────────────────────────
// Rebuilds GAMES from scratch on every call — idempotent, no stale state.
// { clear: true } entries are skipped so cleared slots stay empty.
// Time is NOT required to create a game — label + both teams are sufficient.
function applySchedule(schedule) {
  Object.keys(GAMES).forEach(k => delete GAMES[k]);

  for (const [sid, ov] of Object.entries(schedule)) {
    if (!ov || typeof ov !== 'object') continue;
    if (ov.clear) continue;

    const parsed = parseSlotId(sid);
    if (!parsed.round || !parsed.side || isNaN(parsed.num)) continue;

    const hasT1 = ov.t1name || ov.t1slot;
    const hasT2 = ov.t2name || ov.t2slot;
    if (!ov.label || !hasT1 || !hasT2) continue;

    GAMES[sid] = {
      label: ov.label,
      round: parsed.round,
      side:  parsed.side,
      num:   ov.num != null ? parseInt(ov.num) : parsed.num,
      time:  ov.time || '',
      t1: ov.t1name
        ? { type:'fixed', team:ov.t1name }
        : { type:(ov.t1type||'winner'), slot:ov.t1slot },
      t2: ov.t2name
        ? { type:'fixed', team:ov.t2name }
        : { type:(ov.t2type||'winner'), slot:ov.t2slot },
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
