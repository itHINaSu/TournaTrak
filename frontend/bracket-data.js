// bracket-data.js
// Primary key: slot ID e.g. 'R1.L.1', 'R2.R.3', 'QF.L.1', 'SF.R.1', 'CHAMP.C.1'
// Slot ID format: {ROUND}.{SIDE}.{NUM}  SIDE = L|R|C, NUM = 1-based
// Team source: { type:'winner'|'loser', slot:'R1.L.1' } or { type:'fixed', team:'...' }
//
// Time format: ISO local datetime string 'YYYY-MM-DDTHH:MM'
// Set all game times via the admin panel → schedule.json.
// formatTime(t) → '7/19 Sun 11:30'   parseTimeVal(t) → ms for sorting

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
// Returns sortable ms value; empty/invalid times sort to end.
function parseTimeVal(t) {
  if (!t) return Infinity;
  var d = new Date(t);
  return isNaN(d.getTime()) ? Infinity : d.getTime();
}

// Formats 'YYYY-MM-DDTHH:MM' → 'm/d Day H:MM'  e.g. '7/19 Sun 11:30'
// Returns raw string as-is if not parseable (graceful fallback).
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

// ── GAMES keyed by slot ID ────────────────────────────────────────────
// Times are intentionally blank — set them via the admin panel.
// Format: 'YYYY-MM-DDTHH:MM'
const GAMES = {
  // Round 1 Left
  'R1.L.1': { label:'G1',  round:'R1', side:'L', num:1, time:'',
    t1:{type:'fixed', team:'High Point Roofing'}, t2:{type:'fixed', team:'Dollys'} },
  'R1.L.3': { label:'G3',  round:'R1', side:'L', num:3, time:'',
    t1:{type:'fixed', team:'Brew Crew'}, t2:{type:'fixed', team:'Electric Motor Supply'} },
  'R1.L.5': { label:'G5',  round:'R1', side:'L', num:5, time:'',
    t1:{type:'fixed', team:'Hoegeymeyer Seeds/Feld Fire'}, t2:{type:'fixed', team:'Kerps/Budweiser'} },

  // Round 1 Right
  'R1.R.1': { label:'G2',  round:'R1', side:'R', num:1, time:'',
    t1:{type:'fixed', team:'Shreck Bin Co Red'}, t2:{type:'fixed', team:'WP Trucking'} },
  'R1.R.2': { label:'G4',  round:'R1', side:'R', num:2, time:'',
    t1:{type:'fixed', team:'Michaels Shoes'}, t2:{type:'fixed', team:'Wittrock Electric/Weitl Auto'} },
  'R1.R.3': { label:'G6',  round:'R1', side:'R', num:3, time:'',
    t1:{type:'fixed', team:'Templeton Distillery'}, t2:{type:'fixed', team:'Tropics'} },

  // Round 2 Left
  'R2.L.1': { label:'G7',  round:'R2', side:'L', num:1, time:'',
    t1:{type:'fixed',  team:'Wasted Grain'}, t2:{type:'loser',  slot:'R1.L.5'} },
  'R2.L.2': { label:'G9',  round:'R2', side:'L', num:2, time:'',
    t1:{type:'winner', slot:'R1.L.1'}, t2:{type:'winner', slot:'R1.L.3'} },
  'R2.L.3': { label:'G11', round:'R2', side:'L', num:3, time:'',
    t1:{type:'winner', slot:'R1.L.5'}, t2:{type:'loser',  slot:'R1.L.1'} },
  'R2.L.4': { label:'G13', round:'R2', side:'L', num:4, time:'',
    t1:{type:'loser',  slot:'R1.L.3'}, t2:{type:'loser',  slot:'R2.R.1'} },

  // Round 2 Right
  'R2.R.1': { label:'G8',  round:'R2', side:'R', num:1, time:'',
    t1:{type:'fixed',  team:'Coors Light'}, t2:{type:'loser',  slot:'R1.R.3'} },
  'R2.R.2': { label:'G10', round:'R2', side:'R', num:2, time:'',
    t1:{type:'winner', slot:'R1.R.1'}, t2:{type:'winner', slot:'R1.R.2'} },
  'R2.R.3': { label:'G12', round:'R2', side:'R', num:3, time:'',
    t1:{type:'winner', slot:'R1.R.3'}, t2:{type:'loser',  slot:'R1.R.1'} },
  'R2.R.4': { label:'G14', round:'R2', side:'R', num:4, time:'',
    t1:{type:'loser',  slot:'R1.R.2'}, t2:{type:'loser',  slot:'R2.L.1'} },

  // Quarter Finals Left
  'QF.L.1': { label:'G15', round:'QF', side:'L', num:1, time:'',
    t1:{type:'winner', slot:'R2.L.1'}, t2:{type:'winner', slot:'R2.L.2'} },
  'QF.L.2': { label:'G17', round:'QF', side:'L', num:2, time:'',
    t1:{type:'winner', slot:'R2.L.3'}, t2:{type:'winner', slot:'R2.L.4'} },

  // Quarter Finals Right
  'QF.R.1': { label:'G16', round:'QF', side:'R', num:1, time:'',
    t1:{type:'winner', slot:'R2.R.1'}, t2:{type:'winner', slot:'R2.R.2'} },
  'QF.R.2': { label:'G18', round:'QF', side:'R', num:2, time:'',
    t1:{type:'winner', slot:'R2.R.3'}, t2:{type:'winner', slot:'R2.R.4'} },

  // Semi Finals
  'SF.L.1': { label:'G19', round:'SF', side:'L', num:1, time:'',
    t1:{type:'winner', slot:'QF.L.1'}, t2:{type:'winner', slot:'QF.L.2'} },
  'SF.R.1': { label:'G20', round:'SF', side:'R', num:1, time:'',
    t1:{type:'winner', slot:'QF.R.1'}, t2:{type:'winner', slot:'QF.R.2'} },

  // Championship
  'CHAMP.C.1': { label:'G21', round:'CHAMP', side:'C', num:1, time:'',
    t1:{type:'winner', slot:'SF.L.1'}, t2:{type:'winner', slot:'SF.R.1'} },
};

// ── Core helpers ──────────────────────────────────────────────────────
function resolveSlot(teamSlot, results) {
  if (teamSlot.type==='fixed')  return teamSlot.team;
  if (teamSlot.type==='winner') return (results[teamSlot.slot]||{}).winner || null;
  if (teamSlot.type==='loser')  return (results[teamSlot.slot]||{}).loser  || null;
  return null;
}

function slotLabel(teamSlot) {
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
function applySchedule(schedule) {
  for (const [sid, ov] of Object.entries(schedule)) {
    const parsed = parseSlotId(sid);
    if (!parsed.round || !parsed.side || !parsed.num) continue;

    if (!GAMES[sid]) {
      // Create new game from empty slot if enough info provided
      if (!ov.label && !ov.time && !ov.t1name && !ov.t2name) continue;
      GAMES[sid] = {
        label: ov.label || sid,
        round: parsed.round,
        side:  parsed.side,
        num:   parsed.num,
        time:  ov.time || '',
        t1: ov.t1name ? {type:'fixed', team:ov.t1name}
          : (ov.t1slot ? {type:(ov.t1type||'winner'), slot:ov.t1slot} : {type:'fixed', team:'TBD'}),
        t2: ov.t2name ? {type:'fixed', team:ov.t2name}
          : (ov.t2slot ? {type:(ov.t2type||'winner'), slot:ov.t2slot} : {type:'fixed', team:'TBD'}),
      };
      continue;
    }

    // Update existing game
    if (ov.label)      GAMES[sid].label = ov.label;
    if (ov.time)       GAMES[sid].time  = ov.time;
    if (ov.num != null) GAMES[sid].num  = parseInt(ov.num);

    for (const tk of ['t1','t2']) {
      const nameKey=tk+'name', slotKey=tk+'slot', typeKey=tk+'type';
      if (ov[nameKey] && GAMES[sid][tk].type==='fixed') GAMES[sid][tk].team = ov[nameKey];
      if (ov[slotKey] || ov[typeKey]) {
        if (GAMES[sid][tk].type!=='fixed') {
          if (ov[slotKey])  GAMES[sid][tk].slot = ov[slotKey];
          if (ov[typeKey])  GAMES[sid][tk].type = ov[typeKey];
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
    isEliminated, findNextSlot, applySchedule,
    formatTime, parseTimeVal
  };
}
