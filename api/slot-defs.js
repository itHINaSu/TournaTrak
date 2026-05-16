// slot-defs.js — canonical bracket structure for server-side validation.
// MUST stay in sync with the SLOT_DEFS definition in frontend/bracket-data.js.
const SLOT_DEFS = {
  R1:    { L:[1,2,3,4,5,6,7,8], R:[1,2,3,4,5,6,7,8] },
  R2:    { L:[1,2,3,4],         R:[1,2,3,4] },
  QF:    { L:[1,2],             R:[1,2] },
  SF:    { L:[1],               R:[1] },
  CHAMP: { C:[1] },
};

module.exports = { SLOT_DEFS };
