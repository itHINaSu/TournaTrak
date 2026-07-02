// settings-defaults.js — THE single source of truth for tournament settings
// defaults, shared by browser and server (same dual-environment pattern as
// bracket-data.js):
//   - Browser: loaded before tt-common.js on every page; defines the
//     SETTINGS_DEFAULTS global used by getSetting() as offline fallback.
//   - Server: api/server.js require()s this file from the read-only
//     /frontend volume mount; the keys double as the POST /api/settings
//     allowlist, so adding a setting here is the only step needed to
//     persist it.
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
  defaultTab:           'bracket',
  defaultTabScope:      'both',
  defaultScheduleGroup: 'day',
};

if (typeof module !== 'undefined') {
  module.exports = { SETTINGS_DEFAULTS };
}
