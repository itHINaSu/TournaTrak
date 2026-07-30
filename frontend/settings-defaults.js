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
  // Which lineup columns a coach must fill in. Independent, and all off by
  // default: what a tournament needs varies (an umpire needs numbers to call
  // a game; a league that publishes rosters needs names) and requiring
  // something nobody collects just blocks submissions.
  //
  // A row counts as IN USE when any of its fields has content, and only rows
  // in use are checked — a team batting nine into an eleven-row table must
  // still be able to submit.
  lineupRequireJersey:   'false',
  lineupRequireName:     'false',
  lineupRequirePosition: 'false',
  // DEPRECATED, kept so tournaments that set it keep their rule: the original
  // single toggle, equivalent to lineupRequireJersey. Read as an alias by
  // lineupRequiredFrom() and no longer offered in the admin UI. Removing it
  // would silently switch the requirement off for anyone who had it on.
  lineupRequireNumbers: 'false',
  // Installed-app name. Blank = derive from tournamentName, which is what
  // this always did — but short_name gets 12 characters and that truncation is
  // blunt ("Summer Classic 2026" -> "Summer Class"), so a TD can override the
  // home-screen label without renaming the tournament.
  pwaName:              '',
  pwaShortName:         '',
  defaultTab:           'bracket',
  defaultTabScope:      'both',
  defaultScheduleGroup: 'day',
  // What occupies the fourth public tab: the Bucket Challenge, an all-teams
  // Standings table, or nothing. Plenty of tournaments run no bucket
  // challenge and would rather show records.
  fourthTab:            'buckets',
  // Whether anyone (not just staff) can pick hypothetical winners on the
  // Bracket tab. On by default: people work out who plays whom regardless, and
  // a picker inside the app is the version we can mark as hypothetical — every
  // affected card carries a "Potential Outcome" watermark, which a screenshot
  // of a hand-drawn guess or a rival site would not. Turn it off for a
  // tournament where even a marked what-if would cause arguments.
  publicProjections:    'true',
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

// ── Lineup column layout + required fields (shared browser/server) ─────
// The column set is derived from the same settings in both places, so the
// server can tell whether a required field is even a column the coach was
// shown — requiring Position under a preset that has no position column would
// otherwise reject every submission with no way to satisfy it.
const LINEUP_PRESETS = {
  softball: { rows: 11, subs: true, cols: [
    { key: 'jersey',   label: '#',           kind: 'num'  },
    { key: 'name',     label: 'Player Name', kind: 'text' },
    { key: 'position', label: 'Position',    kind: 'pos', options: ['', '1st', '2nd', '3rd', 'SS', 'C', 'P', 'LF', 'CF', 'RF', 'R', 'EH'] },
  ]},
  volleyball: { rows: 6, subs: true, cols: [
    { key: 'jersey',   label: '#',           kind: 'num'  },
    { key: 'name',     label: 'Player Name', kind: 'text' },
    { key: 'position', label: 'Position',    kind: 'pos', options: ['', 'S', 'OH', 'MB', 'OPP', 'L', 'DS'] },
  ]},
  basketball: { rows: 5, subs: true, cols: [
    { key: 'jersey',   label: '#',           kind: 'num'  },
    { key: 'name',     label: 'Player Name', kind: 'text' },
    { key: 'position', label: 'Position',    kind: 'pos', options: ['', 'PG', 'SG', 'SF', 'PF', 'C'] },
  ]},
  generic: { rows: 10, subs: false, cols: [
    { key: 'jersey', label: '#',           kind: 'num'  },
    { key: 'name',   label: 'Player Name', kind: 'text' },
  ]},
};
const LINEUP_CUSTOM_KEYS = ['jersey', 'name', 'position', 'extra'];

function lineupConfigFrom(settings) {
  const s = settings || {};
  const preset = s.lineupPreset || SETTINGS_DEFAULTS.lineupPreset;
  if (preset === 'custom') {
    const labels = String(s.lineupCustomCols || '')
      .split(',').map(x => x.trim()).filter(Boolean).slice(0, 4);
    if (labels.length) {
      return { rows: 10, subs: false, cols: labels.map((lbl, i) => ({
        key: LINEUP_CUSTOM_KEYS[i], label: lbl,
        kind: (i === 0 && /(^#|#$|\bno\.?$)/i.test(lbl)) ? 'num' : 'text',
      })) };
    }
  }
  return LINEUP_PRESETS[preset] || LINEUP_PRESETS.softball;
}

// Which of jersey/name/position a coach must fill in, limited to columns that
// actually exist in the active layout.
function lineupRequiredFrom(settings) {
  const s = settings || {};
  const on = v => String(v) === 'true';
  const keys = new Set(lineupConfigFrom(s).cols.map(c => c.key));
  return {
    jersey:   keys.has('jersey')   && (on(s.lineupRequireJersey) || on(s.lineupRequireNumbers)),
    name:     keys.has('name')     && on(s.lineupRequireName),
    position: keys.has('position') && on(s.lineupRequirePosition),
  };
}

const LINEUP_FIELD_LABELS = { jersey: 'number', name: 'name', position: 'position' };

// 1-based row numbers that are in use but missing a required field, grouped by
// field. Returns [] when nothing is required or every used row is complete.
// One message per field reads better than one per row: "Player name required —
// check rows 3, 7" is what a coach can act on.
function lineupRowIssues(rows, settings) {
  const req = lineupRequiredFrom(settings);
  const wanted = Object.keys(req).filter(k => req[k]);
  if (!wanted.length) return [];
  const out = [];
  wanted.forEach(field => {
    const bad = [];
    (rows || []).forEach((r, i) => {
      const used = ['jersey', 'name', 'position', 'extra']
        .some(k => String((r && r[k]) || '').trim());
      if (!used) return;                                    // blank row, not a player
      if (!String((r && r[field]) || '').trim()) bad.push(i + 1);
    });
    if (bad.length) out.push({ field: field, label: LINEUP_FIELD_LABELS[field], rows: bad });
  });
  return out;
}

// One sentence a coach can act on, from lineupRowIssues() output.
function lineupIssueMessage(issues) {
  return (issues || []).map(i =>
    'Player ' + i.label + ' required — check row' + (i.rows.length > 1 ? 's ' : ' ') + i.rows.join(', ')
  ).join('. ');
}

if (typeof module !== 'undefined') {
  module.exports = {
    SETTINGS_DEFAULTS, LINEUP_PRESETS, LINEUP_CUSTOM_KEYS,
    lineupConfigFrom, lineupRequiredFrom, lineupRowIssues, lineupIssueMessage,
  };
}
