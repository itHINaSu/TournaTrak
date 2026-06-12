// validation.js — slot ID constants and input validators shared by API routes
const { SLOT_DEFS } = require('./slot-defs');

const _VALID_ROUNDS = new Set(['R1','R2','QF','QF2','SF','CHAMP']);

function isValidSlotId(sid) {
  if (typeof sid !== 'string') return false;
  const p = sid.split('.');
  if (p.length !== 3) return false;
  const [round, side, numStr] = p;
  if (!_VALID_ROUNDS.has(round)) return false;
  if (round === 'CHAMP' ? side !== 'C' : side !== 'L' && side !== 'R') return false;
  const num = parseInt(numStr, 10);
  return !isNaN(num) && num >= 1 && num <= 20;
}

function validateResult({ game, winner, loser, t1score, t2score } = {}) {
  if (!game || !winner || !loser)                    return 'game, winner, loser required';
  if (!isValidSlotId(game))                          return 'invalid slot ID';
  if (typeof winner !== 'string' || !winner.trim())  return 'winner must be a non-empty string';
  if (typeof loser  !== 'string' || !loser.trim())   return 'loser must be a non-empty string';
  if (winner.length > 100 || loser.length > 100)     return 'team name too long (max 100)';
  if (winner.trim() === loser.trim())                return 'winner and loser must differ';
  if (t1score !== undefined && t1score !== null) {
    const n = parseInt(t1score, 10);
    if (isNaN(n) || n < 0 || n > 9999)              return 't1score must be an integer 0–9999';
  }
  if (t2score !== undefined && t2score !== null) {
    const n = parseInt(t2score, 10);
    if (isNaN(n) || n < 0 || n > 9999)              return 't2score must be an integer 0–9999';
  }
  return null;
}

function validateSchedule(updates) {
  if (typeof updates !== 'object' || Array.isArray(updates) || updates === null)
    return 'schedule must be a plain object';
  if (Object.keys(updates).length > 200)
    return 'too many entries';
  for (const [sid, entry] of Object.entries(updates)) {
    if (!isValidSlotId(sid))
      return `invalid slot ID: ${sid}`;
    if (typeof entry !== 'object' || Array.isArray(entry) || entry === null)
      return `entry for ${sid} must be an object`;
    if (entry.clear === true) continue;
    for (const f of ['label','t1name','t2name','t1type','t2type','t1slot','t2slot']) {
      if (entry[f] !== undefined) {
        if (typeof entry[f] !== 'string') return `${f} for ${sid} must be a string`;
        if (entry[f].length > 200)        return `${f} for ${sid} too long (max 200)`;
      }
    }
    if (entry.time !== undefined && entry.time !== '' &&
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(entry.time))
      return `invalid time format for ${sid}: expected YYYY-MM-DDTHH:MM`;
    if (entry.t1slot && !isValidSlotId(entry.t1slot)) return `invalid t1slot for ${sid}`;
    if (entry.t2slot && !isValidSlotId(entry.t2slot)) return `invalid t2slot for ${sid}`;
    if (entry.t1type && !['winner','loser'].includes(entry.t1type)) return `invalid t1type for ${sid}`;
    if (entry.t2type && !['winner','loser'].includes(entry.t2type)) return `invalid t2type for ${sid}`;
    if (entry.num !== undefined) {
      const n = parseInt(entry.num);
      if (isNaN(n) || n < 1) return `invalid num for ${sid}`;
    }
  }
  return null;
}

module.exports = { SLOT_DEFS, isValidSlotId, validateResult, validateSchedule };
