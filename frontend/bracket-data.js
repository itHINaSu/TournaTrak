// bracket-data.js
// GAMES is empty by default — all games are defined via schedule.json / applySchedule()
// Primary key: slot ID e.g. 'R1.L.1', 'R2.R.3', 'QF.L.1', 'SF.R.1', 'CHAMP.C.1'
// Slot ID format: {ROUND}.{SIDE}.{NUM}  SIDE = L|R|C, NUM = 1-based
// Team source: { type:'winner'|'loser', slot:'R1.L.1' } or { type:'fixed', team:'...' }

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

// GAMES starts empty — populated by applySchedule() on load
const GAMES = {};

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

function shortName(name) {
  if (!name) return name;
  return name.trim().split(/\s+/).slice(0,2).join(' ');
}

function smartLabel(teamSlot, results) {
  const resolved = resolveSlot(teamSlot, results);
  if (resolved) return resolved;
  if (!teamSlot) return '?';
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
// Builds / updates GAMES from schedule overrides.
// Handles slot moves: if num changes, the game moves to the new slot ID.
// Clears: an entry with { clear: true } removes a game from GAMES.
function applySchedule(schedule) {
  // First pass: handle clears and slot moves
  for (const [sid, ov] of Object.entries(schedule)) {
    if (!ov || typeof ov !== 'object') continue;

    // Clear a slot
    if (ov.clear) {
      delete GAMES[sid];
      continue;
    }

    const parsed = parseSlotId(sid);
    if (!parsed.round || !parsed.side || !parsed.num) continue;

    // Slot move: if num override differs from current key, move to new slot ID
    if (ov.num != null && parseInt(ov.num) !== parsed.num) {
      const newSid = parsed.round + '.' + parsed.side + '.' + parseInt(ov.num);
      if (GAMES[sid]) {
        // Move existing game to new slot
        GAMES[newSid] = Object.assign({}, GAMES[sid], {
          num: parseInt(ov.num)
        });
        delete GAMES[sid];
        // Continue applying other overrides to the new slot
        const remaining = Object.assign({}, ov);
        delete remaining.num;
        if (Object.keys(remaining).length) {
          schedule[newSid] = Object.assign({}, schedule[newSid]||{}, remaining);
        }
        continue;
      }
    }

    // Create or update game at this slot
    if (!GAMES[sid]) {
      // Only create a new game if it has time AND at least one team defined
      const hasT1 = ov.t1name || ov.t1slot;
      const hasT2 = ov.t2name || ov.t2slot;
      if (!ov.time || !hasT1 || !hasT2) continue;

      GAMES[sid] = {
        label: ov.label || sid,
        round: parsed.round,
        side:  parsed.side,
        num:   parsed.num,
        time:  ov.time || '',
        t1: ov.t1name
          ? {type:'fixed', team:ov.t1name}
          : (ov.t1slot ? {type:(ov.t1type||'winner'), slot:ov.t1slot} : {type:'fixed', team:'TBD'}),
        t2: ov.t2name
          ? {type:'fixed', team:ov.t2name}
          : (ov.t2slot ? {type:(ov.t2type||'winner'), slot:ov.t2slot} : {type:'fixed', team:'TBD'}),
      };
    } else {
      // Update existing game
      if (ov.label)  GAMES[sid].label = ov.label;
      if (ov.time)   GAMES[sid].time  = ov.time;
      if (ov.num != null) GAMES[sid].num = parseInt(ov.num);

      for (const tk of ['t1','t2']) {
        const nameKey=tk+'name', slotKey=tk+'slot', typeKey=tk+'type';
        if (ov[nameKey]) {
          GAMES[sid][tk] = {type:'fixed', team:ov[nameKey]};
        } else if (ov[slotKey] || ov[typeKey]) {
          if (!GAMES[sid][tk] || GAMES[sid][tk].type!=='fixed') {
            GAMES[sid][tk] = GAMES[sid][tk] || {type:'winner', slot:''};
            if (ov[slotKey])  GAMES[sid][tk].slot = ov[slotKey];
            if (ov[typeKey])  GAMES[sid][tk].type = ov[typeKey];
          }
        }
      }
    }
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    GAMES, SLOT_DEFS, ROUND_ORDER, ROUND_LABELS,
    allSlotIds, parseSlotId, occupiedSlots, slotsForRoundSide,
    resolveSlot, slotLabel, smartLabel, shortName,
    isEliminated, findNextSlot, applySchedule
  };
}
