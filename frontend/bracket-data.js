// bracket-data.js
// GAMES is empty by default — all games are defined via schedule.json / applySchedule()
// Primary key: slot ID e.g. 'R1.L.1', 'R2.R.3', 'QF.L.1', 'SF.R.1', 'CHAMP.C.1'
// Slot ID format: {ROUND}.{SIDE}.{NUM}  SIDE = L|R|C, NUM = 1-based
// Team source: { type:'winner'|'loser', slot:'R1.L.1' } or { type:'fixed', team:'...' }
// Time format: ISO local datetime 'YYYY-MM-DDTHH:MM' — set via admin panel

// IMPORTANT: Keep in sync with api/slot-defs.js (API container cannot import this file).
const SLOT_DEFS = {
  // 1-32: enough headroom for a tiered/three-game A or B bracket fed by a
  // 32-team Open (up to 5 rounds of drop-feed slots — see A_CHAIN/B_CHAIN
  // in api/schedule-formats.js).
  R0:   { L:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32],
           R:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32] },
  // Later rounds are deliberately WIDER than any generator needs. A round's
  // slot list is the set of rows a TD can move a card into (bracket Edit
  // mode offers exactly these), and a column that defines only as many slots
  // as it has games can never be rearranged — which is what made Edit useless
  // on the losers side, where byes leave the tree looking lopsided. Eight
  // rows is the bracket's own row grid (gridHeight's floor), so a card can be
  // parked anywhere down the column. Nothing else reads the LENGTH of these
  // lists: card positions come from the games actually present (slotTopVh),
  // and the admin editor keeps empty slots hidden until revealed.
  R1:   { L:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16], R:[1,2,3,4,5,6,7,8] },
  R2:   { L:[1,2,3,4,5,6,7,8],                        R:[1,2,3,4,5,6,7,8] },
  QF:   { L:[1,2,3,4,5,6,7,8],                        R:[1,2,3,4,5,6,7,8] },
  QF2:  { L:[1,2,3,4,5,6,7,8],                        R:[1,2,3,4,5,6,7,8] },
  SF:   { L:[1,2,3,4,5,6,7,8],                        R:[1,2,3,4,5,6,7,8] },
  SF3:  {                                              R:[1,2,3,4,5,6,7,8] },
  SF4:  {                                              R:[1,2,3,4,5,6,7,8] },
  SF2:  { L:[1,2,3,4,5,6,7,8],                        R:[1,2,3,4,5,6,7,8] },
  CHAMP:  { C:[1] },
  CHAMP2: { C:[1] }
};

const ROUND_ORDER  = ['R0','R1','R2','QF','QF2','SF','SF3','SF4','SF2','CHAMP','CHAMP2'];
const ROUND_LABELS = {
  R0:'Round 0', R1:'Round 1', R2:'Round 2', QF:'Round 3', QF2:'Round 4',
  SF:'Round 5', SF3:'Round 6', SF4:'Round 7', SF2:'Round 8',
  CHAMP:'Championship', CHAMP2:'If Necessary'
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
// `side` (optional): number the rounds populated on THAT side only. The
// losers bracket cannot start at R1 — its first games are fed by winners-round
// losers — so counting rounds across both sides labels the first losers column
// "Round 2" even though it sits in the same column as winners Round 1 and
// contains no winner-fed game at all. Numbering each side from its own first
// populated round is how a paper double-elim sheet reads: Losers Round 1 under
// Winners Round 1. Omit `side` for anything spanning both (the Schedule tab
// groups a round's games together regardless of side).
function roundLabel(round, side) {
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
  const n = roundIndex(round, side);
  return n ? 'Round ' + n : (ROUND_LABELS[round] || round);
}

// How far along its own side a round sits, 1-based, counting only populated
// rounds. 0 when the round holds nothing on that side. This is the number
// roundLabel prints, and it is also what pairs a losers round with the
// winners round it should sit under: the losers bracket starts at R2, so its
// FIRST round is winners round 1's partner, not round 2's.
function roundIndex(round, side) {
  let n = 0;
  for (const r of ROUND_ORDER) {
    if (r === 'CHAMP' || r === 'CHAMP2') continue;
    // Tiered A/B games are stored in R0 but aren't part of the tree —
    // they must not create or shift bracket round numbers.
    const has = Object.keys(GAMES).some(g => GAMES[g].round === r && !GAMES[g].tier
      && (!side || GAMES[g].side === side));
    if (has) n++;
    if (r === round) return has ? n : 0;
  }
  return 0;
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
  return { round:p[0], side:p[1], num:parseInt(p[2], 10) };
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
// The schedule GENERATOR lays tier brackets out in flat slot bands, each
// half the size of the one before (see feedChain in schedule-formats.js):
// for a 32-slot round that's 1-16 → band 0, 17-24 → band 1, 25-28 → band 2,
// 29-30 → band 3, 31-32 → band 4. A game's round is the later of its band
// and its winner/loser feed depth within the same tier — generated brackets
// have band === depth so nothing changes, but hand-wired games sort by
// whichever is deeper. Works for any slot id, including ones with no GAMES
// entry yet (revealed-but-empty or still-hidden slots), since the band
// alone comes from the slot number.
// Shared by bracket.js (flightColumns) and admin.js (the schedule editor).
function tierBand(num, capacity) {
  // Bands hold capacity/2, /4, … 1 slot(s). The last slot number is unused
  // by feedChain (a P-slot round fits a P/2-game bracket ending at P-1), so
  // clamp rather than returning a band past the end of the column list.
  const maxBand = Math.max(0, Math.round(Math.log2(capacity)) - 1);
  let band = 0, start = 1, size = capacity / 2;
  while (size >= 1) {
    if (num < start + size) return Math.min(band, maxBand);
    start += size; size /= 2; band++;
  }
  return maxBand;
}
function tierGameRound(sid) {
  const p = parseSlotId(sid);
  const defs = (SLOT_DEFS[p.round] && SLOT_DEFS[p.round][p.side]) || [];
  const band = tierBand(p.num, defs.length || 16);
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
      num:   ov.num != null ? parseInt(ov.num, 10) : parsed.num,
      time:  ov.time || '',
      field: typeof ov.field === 'string' ? ov.field.trim() : '',
      bye:   ov.bye === true,
      // 'A'|'B' for tiered drop brackets — in the schedule and team path but
      // NOT the bracket tree (their R0 storage slots would otherwise render
      // as extra leading columns and shift the Open's round numbering).
      tier:  (ov.tier === 'A' || ov.tier === 'B') ? ov.tier : null,
      // Where bracket Edit mode placed this card, as a fraction of its
      // column's height (0 = top, 1 = bottom); null means "wherever the
      // automatic layout puts it". A fraction rather than a row index because
      // a column's row count changes as games move, and an index would
      // silently re-space every other card in the column.
      layoutRow: (typeof ov.layoutRow === 'number' && isFinite(ov.layoutRow))
        ? Math.max(0, Math.min(1, ov.layoutRow))
        : null,
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

// ── Tiebreak order (documented; STANDINGS_TIEBREAKS is shown under the table)
// 1. Record — most wins, then fewest losses.
// 2. Head-to-head record among the teams that are still tied.
// 3. Run differential in those head-to-head games.
// 4. Overall run differential.
// 5. Fewest runs allowed.
// 6. Most runs scored.
// 7. Team name, so the order is stable rather than accidental.
//
// Steps 2 and 3 are computed WITHIN the tied group only, which is what makes
// them a tiebreak rather than another season stat: a team's record against
// opponents that aren't tied with it is irrelevant to breaking this tie. A
// three-way tie that head-to-head only partly resolves falls through to the
// later steps for whatever is still level, exactly like a paper sheet.
var STANDINGS_TIEBREAKS = 'Ties broken by: head-to-head record, then head-to-head run '
  + 'differential, then overall run differential, then fewest runs allowed, then runs scored.';

function rankStandings(rows, h2h) {
  // Group by identical record first — everything below only applies inside
  // one of these groups.
  var sorted = rows.slice().sort(function (a, b) {
    if (b.w !== a.w) return b.w - a.w;
    return a.l - b.l;
  });
  var out = [];
  for (var i = 0; i < sorted.length;) {
    var j = i;
    while (j < sorted.length && sorted[j].w === sorted[i].w && sorted[j].l === sorted[i].l) j++;
    var tied = sorted.slice(i, j);
    if (tied.length > 1) {
      var names = tied.map(function (r) { return r.name; });
      var mini = {};
      tied.forEach(function (r) {
        var w = 0, l = 0, rf = 0, ra = 0;
        names.forEach(function (opp) {
          var rec = opp !== r.name && h2h[r.name] && h2h[r.name][opp];
          if (!rec) return;
          w += rec.w; l += rec.l; rf += rec.rf; ra += rec.ra;
        });
        // Win pct, not raw wins: inside a partly played group two tied teams
        // may have met a different number of the others.
        mini[r.name] = { pct: (w + l) ? w / (w + l) : -1, diff: rf - ra };
      });
      tied.sort(function (a, b) {
        var ma = mini[a.name], mb = mini[b.name];
        if (mb.pct !== ma.pct) return mb.pct - ma.pct;
        if (mb.diff !== ma.diff) return mb.diff - ma.diff;
        var da = a.rf - a.ra, db = b.rf - b.ra;
        if (db !== da) return db - da;
        if (a.ra !== b.ra) return a.ra - b.ra;
        if (b.rf !== a.rf) return b.rf - a.rf;
        return a.name < b.name ? -1 : 1;
      });
    }
    out = out.concat(tied);
    i = j;
  }
  return out;
}

// ── scheduleHealth ────────────────────────────────────────────────────
// Pre-publish check over a RAW schedule object (not GAMES — applySchedule
// has already thrown away exactly the entries this is meant to catch).
// Returns [{ level:'error'|'warning', slot, label, message }], worst first.
//
// Every rule here corresponds to a real failure the app used to absorb in
// silence:
//   • incomplete    — applySchedule skips any entry missing a label or a
//                     team, so a half-wired game vanishes from the public
//                     bracket with no warning at all.
//   • dangling      — a feed pointing at a slot with no game can never
//                     resolve; the card shows "R2.L.3 (deleted game)".
//   • duplicate     — _nextSlotMap is last-write-wins, so two games
//                     consuming the same feed silently drop one edge and
//                     skew isEliminated + Team Path.
//   • self          — a game feeding itself never resolves.
//   • backwards     — the renderer lays columns out in ROUND_ORDER and only
//                     wires ADJACENT ones, so a feeder in a later round
//                     draws on the wrong side of its consumer with no
//                     connector line between them.
function scheduleHealth(schedule) {
  const out = [];
  const entries = Object.entries(schedule || {})
    .filter(([, ov]) => ov && typeof ov === 'object' && !ov.clear);
  const labelOf = (sid) => (schedule[sid] && schedule[sid].label) || sid;
  const add = (level, slot, message) =>
    out.push({ level, slot, label: labelOf(slot), message });

  // A game only reaches the bracket if applySchedule keeps it.
  const live = new Set(entries
    .filter(([, ov]) => ov.label && (ov.t1name || ov.t1slot) && (ov.t2name || ov.t2slot))
    .map(([sid]) => sid));

  const consumers = {};   // 'slot|type' → [consuming slot ids]

  for (const [sid, ov] of entries) {
    const me = parseSlotId(sid);
    const missing = [];
    if (!ov.label) missing.push('a name');
    if (!ov.t1name && !ov.t1slot) missing.push('a first team');
    if (!ov.t2name && !ov.t2slot) missing.push('a second team');
    if (missing.length) {
      add('error', sid, 'Needs ' + missing.join(' and ')
        + ' — until then this game is left off the public bracket.');
    }

    for (const n of [1, 2]) {
      const src = ov['t' + n + 'slot'];
      if (!src) continue;
      const type = ov['t' + n + 'type'] === 'loser' ? 'loser' : 'winner';
      if (src === sid) {
        add('error', sid, 'Team ' + n + ' is fed by this same game.');
        continue;
      }
      if (!live.has(src)) {
        add('error', sid, 'Team ' + n + ' comes from ' + src
          + ', which has no game — that slot will never fill.');
        continue;
      }
      (consumers[src + '|' + type] = consumers[src + '|' + type] || []).push(sid);

      // Column ordering. Tier (A/B) games all live in R0 and are laid out by
      // slot band instead, so they compare by slot number within their tier.
      const f = parseSlotId(src);
      const srcTier = schedule[src].tier;
      if (ov.tier) {
        if (srcTier === ov.tier && f.num >= me.num) {
          add('warning', sid, 'Fed by ' + labelOf(src)
            + ', which sits in a later column — no connector line is drawn.');
        }
      } else if (!srcTier) {
        const fi = ROUND_ORDER.indexOf(f.round), mi = ROUND_ORDER.indexOf(me.round);
        if (fi > mi || (fi === mi && f.side === me.side && f.num >= me.num)) {
          add('warning', sid, 'Fed by ' + labelOf(src)
            + ' (' + src + '), which sits in a later column — no connector line is drawn.');
        }
      }
    }
  }

  for (const [key, users] of Object.entries(consumers)) {
    if (users.length < 2) continue;
    const [src, type] = key.split('|');
    users.forEach(sid => add('error', sid, 'The ' + type + ' of ' + labelOf(src)
      + ' also feeds ' + users.filter(u => u !== sid).map(labelOf).join(', ')
      + ' — only one of them will receive the team.'));
  }

  return out.sort((a, b) => (a.level === b.level) ? 0 : (a.level === 'error' ? -1 : 1));
}

if (typeof module !== 'undefined') {
  module.exports = {
    GAMES, SLOT_DEFS, ROUND_ORDER, ROUND_LABELS, roundLabel, roundIndex, scheduleHealth,
    rankStandings, STANDINGS_TIEBREAKS,
    allSlotIds, parseSlotId, tierGameRound, occupiedSlots, slotsForRoundSide,
    resolveSlot, slotLabel, smartLabel, shortName,
    isEliminated, findNextSlot, applySchedule,
    formatTime, parseTimeVal,
    get gamesGeneration() { return gamesGeneration; }
  };
}
