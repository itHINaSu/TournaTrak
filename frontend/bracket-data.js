// bracket-data.js
// GAMES is empty by default — all games are defined via schedule.json / applySchedule()
// Primary key: slot ID e.g. 'R1.L.1', 'R2.R.3', 'QF.L.1', 'SF.R.1', 'CHAMP.C.1'
// Slot ID format: {ROUND}.{SIDE}.{NUM}  SIDE = L|R|C, NUM = 1-based
// Team source: { type:'winner'|'loser', slot:'R1.L.1' } or { type:'fixed', team:'...' }
// Time format: ISO local datetime 'YYYY-MM-DDTHH:MM' — set via admin panel

// IMPORTANT: Keep in sync with api/slot-defs.js (API container cannot import this file).
const SLOT_DEFS = {
  R0:   { L:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16], R:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16] },
  R1:   { L:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16], R:[1,2,3,4,5,6,7,8] },
  R2:   { L:[1,2,3,4,5,6,7,8],                        R:[1,2,3,4,5,6,7,8] },
  QF:   { L:[1,2,3,4],                                 R:[1,2,3,4] },
  QF2:  { L:[1,2],                                     R:[1,2,3,4] },
  SF:   { L:[1,2,3],                                   R:[1,2,3,4] },
  SF3:  {                                               R:[1,2] },
  SF2:  { L:[1],                                       R:[1,2] },
  CHAMP:  { C:[1] },
  CHAMP2: { C:[1] }
};

const ROUND_ORDER  = ['R0','R1','R2','QF','QF2','SF','SF3','SF2','CHAMP','CHAMP2'];
const ROUND_LABELS = {
  R0:'Round 0', R1:'Round 1', R2:'Round 2', QF:'Round 3', QF2:'Round 4',
  SF:'Round 5', SF3:'Round 6', SF2:'Round 7', CHAMP:'Championship', CHAMP2:'If Necessary'
};

// roundLabel — display name for a round, numbered by the populated rounds only.
// The static ROUND_LABELS above assume the full bracket structure, so a bracket
// smaller than the maximum (e.g. an 8-team single-elim using only QF/SF/CHAMP)
// would otherwise show "Round 3" as its first column. This numbers the
// populated pre-championship rounds sequentially instead, so any bracket reads
// "Round 1, Round 2, …". For the full structure every round is populated, so
// the result is identical to ROUND_LABELS (no change for existing brackets).
// NOTE: intended for the public bracket, which renders only populated rounds.
// The admin editor shows every defined round and keeps the static labels.
function roundLabel(round) {
  // A TD's custom name always wins, even over the automatic CHAMP2 '3rd
  // Place' relabel below.
  var custom = (typeof getSetting === 'function') ? getSetting('roundName' + round) : '';
  if (custom) return custom;
  if (round === 'CHAMP')  return ROUND_LABELS.CHAMP;
  if (round === 'CHAMP2') {
    // CHAMP2 is the double-elim "if necessary" reset, EXCEPT when its feeds
    // are semifinal losers — then it's a single-elim 3rd-place game.
    const g = GAMES['CHAMP2.C.1'];
    if (g && g.t1 && g.t1.type === 'loser' && g.t1.slot !== 'CHAMP.C.1') return '3rd Place';
    return ROUND_LABELS.CHAMP2;
  }
  let n = 0;
  for (const r of ROUND_ORDER) {
    if (r === 'CHAMP' || r === 'CHAMP2') continue;
    // Tiered A/B games are stored in R0 but aren't part of the tree —
    // they must not create or shift bracket round numbers.
    const has = Object.keys(GAMES).some(g => GAMES[g].round === r && !GAMES[g].tier);
    if (has) n++;
    if (r === round) return has ? 'Round ' + n : (ROUND_LABELS[round] || round);
  }
  return ROUND_LABELS[round] || round;
}

// GAMES starts empty — populated by applySchedule() on load
const GAMES = {};
// Incremented each time applySchedule() rebuilds GAMES so callers can
// invalidate derived caches (e.g. slotTopVh memoization in bracket.js).
let gamesGeneration = 0;

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

// tierGameRound(sid): display round for a tiered (A/B) drop-bracket game.
// The schedule GENERATOR lays tier brackets out in flat slot bands:
// 1-8 → band 0, 9-12 → band 1, 13-14 → band 2, 15-16 → band 3. A game's
// round is the later of its band and its winner/loser feed depth within
// the same tier — generated brackets have band === depth so nothing
// changes, but hand-wired games sort by whichever is deeper. Works for any
// slot id, including ones with no GAMES entry yet (revealed-but-empty or
// still-hidden slots), since the band alone comes from the slot number.
// Shared by bracket.js (flightColumns) and admin.js (the schedule editor).
function tierGameRound(sid) {
  const num = parseSlotId(sid).num;
  const band = num <= 8 ? 0 : num <= 12 ? 1 : num <= 14 ? 2 : 3;
  const g = GAMES[sid];
  if (!g) return band;
  const tier = g.tier;
  const seen = {};
  function depth(gid) {
    if (seen[gid]) return 0; // cycle guard
    seen[gid] = true;
    const gg = GAMES[gid];
    if (!gg) return 0;
    const feeders = [gg.t1, gg.t2].filter(s => s && s.slot && GAMES[s.slot] && GAMES[s.slot].tier === tier);
    return feeders.length ? 1 + Math.max(...feeders.map(s => depth(s.slot))) : 0;
  }
  return Math.max(band, depth(sid));
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
  if (teamSlot.type==='winner') {
    var w = (results[teamSlot.slot]||{}).winner;
    if (w) return w;
    // Bye game: no result is ever entered, but the lone team auto-advances.
    var g = GAMES[teamSlot.slot];
    if (g && g.bye) return resolveSlot(g.t1, results);
    return null;
  }
  if (teamSlot.type==='loser')  return (results[teamSlot.slot]||{}).loser  || null;
  return null;
}

function slotLabel(teamSlot) {
  if (!teamSlot) return '?';
  if (teamSlot.type==='fixed') return teamSlot.team || '?';
  const g = GAMES[teamSlot.slot];
  // A feed pointing at a slot with no game (the source was deleted or
  // moved in the editor) can never resolve — say so instead of leaking a
  // bare slot id like "Winner of SF.R.2", which reads as a glitch. The
  // slot id stays visible so the TD knows which feed to rewire.
  const lbl = g ? (g.label || teamSlot.slot) : teamSlot.slot + ' (deleted game)';
  return (teamSlot.type==='winner' ? 'Winner of ' : 'Loser of ') + lbl;
}

// shortName: ONLY for use in "Team A / Team B" display inside smartLabel.
// Truncates at "/" first (e.g. "Hoegeymeyer/Feld Fire" → "Hoegeymeyer").
// Names of 14 chars or fewer pass through whole regardless of word count
// ("Hall of Fame" stays intact); longer ones keep at most 2 words
// (e.g. "High Point Roofing" → "High Point").
// Never call this when displaying a single team name on its own.
function shortName(name) {
  if (!name) return '';
  var s = name.trim().split('/')[0].trim(); // drop everything from "/" onward
  if (s.length <= 14) return s;
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

// _nextSlotMap: reverse-lookup map built by applySchedule.
// Key: srcSid + '|' + type ('winner'/'loser') → destination gid or null.
// Provides O(1) findNextSlot vs. the original O(n) scan.
const _nextSlotMap = {};

function findNextSlot(sid, type) {
  const key = sid + '|' + type;
  return _nextSlotMap.hasOwnProperty(key) ? _nextSlotMap[key] : null;
}

function isEliminated(teamName, results) {
  // Format-agnostic: topology lives in the schedule, so elimination does too.
  // A team is out exactly when it loses a game whose loser advances nowhere.
  // That single structural rule covers every format: single elim and the
  // two-sided SE layout (no losses feed anywhere), double elim (the second
  // loss always lands in a game without a loser feed), and the tiered
  // Open→A→B format — where a team can be 0-2 or even 0-3 and still alive
  // because those losses feed the A/B drop brackets. (The old `losses >= 2`
  // fallback wrongly eliminated tiered teams and was redundant for
  // generated double-elim topologies.)
  for (const [sid, r] of Object.entries(results)) {
    if (!r || r.loser !== teamName) continue;
    if (!findNextSlot(sid, 'loser')) return true;
  }
  return false;
}

// ── applySchedule ─────────────────────────────────────────────────────
// Rebuilds GAMES from scratch on every call — idempotent, no stale state.
// { clear: true } entries are skipped so cleared slots stay empty.
// Time is NOT required to create a game — label + both teams are sufficient.
function applySchedule(schedule) {
  Object.keys(GAMES).forEach(k => delete GAMES[k]);
  gamesGeneration++;

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
      field: typeof ov.field === 'string' ? ov.field.trim() : '',
      bye:   ov.bye === true,
      // 'A'|'B' for tiered drop brackets — in the schedule and team path but
      // NOT the bracket tree (their R0 storage slots would otherwise render
      // as extra leading columns and shift the Open's round numbering).
      tier:  (ov.tier === 'A' || ov.tier === 'B') ? ov.tier : null,
      t1: ov.t1name
        ? { type:'fixed', team:ov.t1name }
        : { type:(ov.t1type||'winner'), slot:ov.t1slot },
      t2: ov.t2name
        ? { type:'fixed', team:ov.t2name }
        : { type:(ov.t2type||'winner'), slot:ov.t2slot },
    };
  }

  // Rebuild reverse-lookup map for O(1) findNextSlot.
  // Clear previous entries first.
  Object.keys(_nextSlotMap).forEach(k => delete _nextSlotMap[k]);
  for (const [nsid, ng] of Object.entries(GAMES)) {
    if (ng.t1 && (ng.t1.type === 'winner' || ng.t1.type === 'loser') && ng.t1.slot) {
      _nextSlotMap[ng.t1.slot + '|' + ng.t1.type] = nsid;
    }
    if (ng.t2 && (ng.t2.type === 'winner' || ng.t2.type === 'loser') && ng.t2.slot) {
      _nextSlotMap[ng.t2.slot + '|' + ng.t2.type] = nsid;
    }
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    GAMES, SLOT_DEFS, ROUND_ORDER, ROUND_LABELS, roundLabel,
    allSlotIds, parseSlotId, tierGameRound, occupiedSlots, slotsForRoundSide,
    resolveSlot, slotLabel, smartLabel, shortName,
    isEliminated, findNextSlot, applySchedule,
    formatTime, parseTimeVal,
    get gamesGeneration() { return gamesGeneration; }
  };
}
