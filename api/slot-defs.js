// slot-defs.js — canonical bracket structure for server-side validation.
// MUST stay in sync with the SLOT_DEFS definition in frontend/bracket-data.js.
const SLOT_DEFS = {
  // 1-32: enough headroom for a tiered/three-game A or B bracket fed by a
  // 32-team Open (up to 5 rounds of drop-feed slots — see A_CHAIN/B_CHAIN
  // in schedule-formats.js).
  R0:   { L:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32],
           R:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32] },
  R1:   { L:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16], R:[1,2,3,4,5,6,7,8] },
  R2:   { L:[1,2,3,4,5,6,7,8],                        R:[1,2,3,4,5,6,7,8] },
  QF:   { L:[1,2,3,4],                                 R:[1,2,3,4] },
  QF2:  { L:[1,2],                                     R:[1,2,3,4] },
  SF:   { L:[1,2,3],                                   R:[1,2,3,4] },
  SF3:  {                                               R:[1,2] },
  SF4:  {                                               R:[1,2] },
  SF2:  { L:[1],                                       R:[1,2] },
  CHAMP:  { C:[1] },
  CHAMP2: { C:[1] },
};

module.exports = { SLOT_DEFS };
