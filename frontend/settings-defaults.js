// settings-defaults.js — THE single source of truth for tournament settings
// defaults, shared by browser and server (same dual-environment pattern as
// bracket-data.js):
//   - Browser: loaded before tt-common.js on every page; defines the
//     SETTINGS_DEFAULTS global used by getSetting() as offline fallback.
//   - Server: api/server.js require()s this file from the read-only
//     /frontend volume mount; the keys double as the POST /api/settings
//     allowlist, so adding a setting here is the only step needed to
//     persist it.
//
// Server-managed keys NOT listed here (intentional): `format` and
// `swissRounds` are written by /api/schedule/generate via store.put, which
// bypasses the allowlist. Keeping them out of SETTINGS_DEFAULTS means an
// admin can't overwrite them through the Settings form; POST /api/settings
// merges over stored values, so partial saves never drop them either.
const SETTINGS_DEFAULTS = {
  tournamentName:   'Tournament Bracket',
  pageTitle:        'Tournament Bracket',
  adminName:        'Tournament Admin',
  subtitle:         '',
  leftLabel:        'Left Bracket',
  rightLabel:       'Right Bracket',
  playInLabel:      'Play-In',
  showSideDividers: 'true',
  periodLabel:      'Inning',
  showDate:         'true',
  showDay:          'true',
  dateFormat:       'short',
  dayFormat:        'long',
  lineupPreset:     'softball',
  lineupCustomCols: '',
  // 'true' makes the number column mandatory for every named player before a
  // coach can submit. Umpires and scorekeepers need jersey numbers to call a
  // game, and a lineup missing them is a phone call the TD has to make.
  lineupRequireNumbers: 'false',
  defaultTab:           'bracket',
  defaultTabScope:      'both',
  defaultScheduleGroup: 'day',
  // What occupies the fourth public tab: the Bucket Challenge, an all-teams
  // Standings table, or nothing. Plenty of tournaments run no bucket
  // challenge and would rather show records.
  fourthTab:            'buckets',
  // Custom display names for storage rounds; '' = use the built-in label.
  roundNameR0:     '',
  roundNameR1:     '',
  roundNameR2:     '',
  roundNameQF:     '',
  roundNameQF2:    '',
  roundNameSF:     '',
  roundNameSF3:    '',
  roundNameSF4:    '',
  roundNameSF2:    '',
  roundNameCHAMP:  '',
  roundNameCHAMP2: '',
  // Custom display names for the two extra/drop brackets; '' = "A Bracket"/"B Bracket".
  bracketNameA: '',
  bracketNameB: '',
  // Title over each flight's final game (the consolation championship);
  // blank derives "<bracket name> Championship".
  bracketChampLabelA: '',
  bracketChampLabelB: '',
};

if (typeof module !== 'undefined') {
  module.exports = { SETTINGS_DEFAULTS };
}
