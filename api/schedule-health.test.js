// schedule-health.test.js — the pre-publish schedule analyzer.
//
// scheduleHealth() runs over a RAW schedule object, before applySchedule has
// thrown away the malformed entries it exists to catch. Every rule here maps
// to a failure the app otherwise absorbs in silence, so each gets a test that
// would fail if the rule were deleted.
//
// The clock rules are the reason this file exists: a game timed at or before
// the game feeding it draws perfectly, passes every structural check, and
// only shows up on the day — a field waiting on a team from a game nobody has
// played yet.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { scheduleHealth } = require('../frontend/bracket-data.js');

// Minimal two-round schedule: R1.L.1 and R1.L.2 feed QF.L.1.
function base(overrides) {
  const s = {
    'R1.L.1': { label: 'Game 1', time: '2026-08-01T09:00', t1name: 'Alpha', t2name: 'Bravo' },
    'R1.L.2': { label: 'Game 2', time: '2026-08-01T10:00', t1name: 'Cassie', t2name: 'Delta' },
    'QF.L.1': {
      label: 'Game 3', time: '2026-08-01T12:00',
      t1type: 'winner', t1slot: 'R1.L.1',
      t2type: 'winner', t2slot: 'R1.L.2',
    },
  };
  for (const [sid, patch] of Object.entries(overrides || {})) {
    s[sid] = Object.assign({}, s[sid], patch);
  }
  return s;
}

const timeIssues = (s) => scheduleHealth(s).filter(i => /BEFORE|same time as/.test(i.message));

describe('schedule health — clock ordering', () => {
  test('a well-ordered schedule reports nothing', () => {
    assert.deepEqual(scheduleHealth(base()), []);
  });

  test('a game before its feeder is an error naming both games', () => {
    // QF.L.1 at 09:30 is half an hour before Game 2, which supplies team 2.
    const issues = timeIssues(base({ 'QF.L.1': { time: '2026-08-01T09:30' } }));
    assert.equal(issues.length, 1, 'exactly one feed is violated');
    const i = issues[0];
    assert.equal(i.level, 'error');
    assert.equal(i.slot, 'QF.L.1');
    assert.match(i.message, /30 min BEFORE/);
    assert.match(i.message, /Game 2/, 'names the feeding game');
    assert.match(i.message, /R1\.L\.2/, 'gives the feeding slot id');
  });

  test('both feeds are reported when both are violated', () => {
    const issues = timeIssues(base({ 'QF.L.1': { time: '2026-08-01T08:00' } }));
    assert.equal(issues.length, 2, 'one per feeding game');
    assert.deepEqual(issues.map(i => i.slot), ['QF.L.1', 'QF.L.1']);
  });

  test('starting at the same time as a feeder is an error', () => {
    const issues = timeIssues(base({ 'QF.L.1': { time: '2026-08-01T10:00' } }));
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /same time as/);
    assert.doesNotMatch(issues[0].message, /BEFORE/, 'equal is its own message, not a 0 min gap');
  });

  test('one minute later is enough — the rule is ordering, not a gap policy', () => {
    assert.deepEqual(timeIssues(base({ 'QF.L.1': { time: '2026-08-01T10:01' } })), []);
  });

  test('a missing time is not an error', () => {
    // Half-built schedules are normal; only two parseable times can conflict.
    assert.deepEqual(timeIssues(base({ 'QF.L.1': { time: '' } })), []);
    assert.deepEqual(timeIssues(base({ 'R1.L.2': { time: '' } })), []);
    assert.deepEqual(timeIssues(base({ 'QF.L.1': { time: 'not a date' } })), []);
  });

  test('loser feeds are checked too, not just winner feeds', () => {
    const s = base();
    s['R2.R.1'] = {
      label: 'Game 4', time: '2026-08-01T08:00',
      t1type: 'loser', t1slot: 'R1.L.1',
      t2name: 'Echo',
    };
    const issues = timeIssues(s).filter(i => i.slot === 'R2.R.1');
    assert.equal(issues.length, 1, 'a team dropping down still has to be decided first');
    assert.match(issues[0].message, /BEFORE/);
  });

  test('dates are compared, not just clock times', () => {
    // 09:00 the NEXT day is later than 12:00 today, despite the smaller time.
    assert.deepEqual(timeIssues(base({ 'QF.L.1': { time: '2026-08-02T09:00' } })), []);
    // ...and 12:00 the day BEFORE is earlier, despite the larger time.
    const issues = timeIssues(base({ 'QF.L.1': { time: '2026-07-31T12:00' } }));
    assert.equal(issues.length, 2);
    assert.match(issues[0].message, /BEFORE/);
  });

  test('a feed pointing at a game that does not exist reports the dangling feed, not a time', () => {
    // The dangling rule owns this case; a time comparison against a missing
    // game would be a second, confusing error for one mistake.
    const s = base({ 'QF.L.1': { t1slot: 'R1.L.9' } });
    const issues = scheduleHealth(s);
    assert.ok(issues.some(i => /has no game/.test(i.message)), 'dangling feed reported');
    assert.equal(timeIssues(s).length, 0, 'no time error piled on top');
  });

  test('errors sort ahead of warnings', () => {
    // Backwards column ordering is a warning; a clock inversion is an error.
    const s = base({ 'QF.L.1': { time: '2026-08-01T08:00' } });
    s['R1.L.3'] = {
      label: 'Game 5', time: '2026-08-02T09:00',
      t1type: 'winner', t1slot: 'QF.L.1', t2name: 'Foxtrot',
    };
    const levels = scheduleHealth(s).map(i => i.level);
    assert.ok(levels.includes('error') && levels.includes('warning'), 'both kinds present');
    assert.deepEqual(levels, levels.slice().sort((a, b) => (a === b ? 0 : a === 'error' ? -1 : 1)));
  });
});

describe('schedule health — the structural rules still hold', () => {
  test('a game feeding itself is an error', () => {
    const s = base({ 'QF.L.1': { t1slot: 'QF.L.1' } });
    assert.ok(scheduleHealth(s).some(i => /fed by this same game/.test(i.message)));
  });

  test('two games consuming one feed is an error', () => {
    const s = base();
    s['QF.L.2'] = {
      label: 'Game 6', time: '2026-08-01T13:00',
      t1type: 'winner', t1slot: 'R1.L.1', t2name: 'Golf',
    };
    assert.ok(scheduleHealth(s).some(i => /only one of them will receive/.test(i.message)));
  });

  test('an incomplete game is an error', () => {
    const s = base({ 'QF.L.1': { label: '' } });
    assert.ok(scheduleHealth(s).some(i => /Needs a name/.test(i.message)));
  });

  test('a real tournament file is clean', () => {
    const issa = require('../scripts/issa-state-2026.json');
    assert.deepEqual(scheduleHealth(issa.schedule), [],
      'the shipped ISSA transcription must pass every rule');
  });
});
