// validation.js — slot ID constants and input validators shared by API routes
const { SLOT_DEFS } = require('./slot-defs');

function isValidSlotId(sid) {
  if (typeof sid !== 'string') return false;
  const p = sid.split('.');
  if (p.length !== 3) return false;
  const [round, side, numStr] = p;
  // Validate against the ACTUAL per-round/side slot list, not a single global
  // max. This rejects num-in-range-but-nonexistent slots like CHAMP.C.9 or
  // SF3.L.1 (SF3 has no L side), so orphan data can't be stored at slots no
  // game will ever occupy. Every generator output stays within these lists.
  const nums = SLOT_DEFS[round] && SLOT_DEFS[round][side];
  if (!nums) return false;
  const num = parseInt(numStr, 10);
  return !isNaN(num) && nums.includes(num);
}

function validateResult({ game, winner, loser, t1score, t2score } = {}) {
  if (!game || !winner || !loser)                    return 'game, winner, loser required';
  if (!isValidSlotId(game))                          return 'invalid slot ID';
  if (typeof winner !== 'string' || !winner.trim())  return 'winner must be a non-empty string';
  if (typeof loser  !== 'string' || !loser.trim())   return 'loser must be a non-empty string';
  if (winner.length > 100 || loser.length > 100)     return 'team name too long (max 100)';
  if (winner.trim() === loser.trim())                return 'winner and loser must differ';
  // Empty string means "no score entered" — a valid way to record just a
  // winner. Treat it the same as an omitted field (the POST /results handler
  // already skips '' when building the stored entry); validating it here as a
  // number would 400 a legitimate winner-only save.
  if (t1score !== undefined && t1score !== null && t1score !== '') {
    const n = parseInt(t1score, 10);
    if (isNaN(n) || n < 0 || n > 9999)              return 't1score must be an integer 0–9999';
  }
  if (t2score !== undefined && t2score !== null && t2score !== '') {
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
    for (const f of ['label','field','t1name','t2name','t1type','t2type','t1slot','t2slot']) {
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
    // A game feeding from its own result can never resolve.
    if (entry.t1slot === sid || entry.t2slot === sid)
      return `${sid} cannot take a team from its own result`;
    if (entry.t1type && !['winner','loser'].includes(entry.t1type)) return `invalid t1type for ${sid}`;
    if (entry.t2type && !['winner','loser'].includes(entry.t2type)) return `invalid t2type for ${sid}`;
    // Tiered drop brackets (Open→A→B): games marked with a tier render in
    // the schedule/team path but stay out of the bracket tree.
    if (entry.tier !== undefined && !['A','B'].includes(entry.tier)) return `invalid tier for ${sid}`;
    // Bye marker: lone team auto-advances; opponent slot renders as BYE.
    if (entry.bye !== undefined && typeof entry.bye !== 'boolean') return `bye for ${sid} must be a boolean`;
    // Layout position: where bracket Edit mode placed this card, as a
    // fraction of its column's height (0 = top edge, 1 = bottom). Absent
    // means "wherever the automatic layout puts it". A fraction rather than a
    // row index on purpose — a column's row count changes as games move, so
    // an index would silently re-space every other card in the column.
    // Presentation only: no effect on feeds or results.
    if (entry.layoutRow !== undefined && entry.layoutRow !== null) {
      const v = entry.layoutRow;
      if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 1)
        return `layoutRow for ${sid} must be a number 0–1`;
    }
    // Legacy pin flag from the first cut of Edit mode; superseded by
    // layoutRow. Still accepted so an older stored schedule validates.
    if (entry.pinned !== undefined && typeof entry.pinned !== 'boolean') return `pinned for ${sid} must be a boolean`;
    // Swiss round bookkeeping: which round this pairing belongs to. A real
    // field so label edits/find-replace can't break "Pair next round".
    if (entry.swissRound !== undefined) {
      const n = parseInt(entry.swissRound, 10);
      if (isNaN(n) || n < 1 || n > 99) return `invalid swissRound for ${sid}`;
    }
    if (entry.num !== undefined) {
      const n = parseInt(entry.num, 10);
      if (isNaN(n) || n < 1) return `invalid num for ${sid}`;
    }
  }
  return null;
}

module.exports = { isValidSlotId, validateResult, validateSchedule };
