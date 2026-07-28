// standings.test.js — tiebreak order for round-robin / pools / swiss tables.
//
// The ordering rules live in frontend/bracket-data.js (shared browser + node
// module) precisely so they can be asserted here: "why is that team above us"
// is the single most common question a TD gets on a pool sheet, and the answer
// has to be the documented order rather than whatever the sort happened to do.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { rankStandings, STANDINGS_TIEBREAKS } = require('../frontend/bracket-data.js');

// Build the per-opponent record map from a list of [teamA, teamB, scoreA, scoreB].
function h2hFrom(games) {
  const h = {};
  for (const [a, b, sa, sb] of games) {
    for (const [me, opp, mf, ma] of [[a, b, sa, sb], [b, a, sb, sa]]) {
      h[me] = h[me] || {};
      h[me][opp] = h[me][opp] || { w: 0, l: 0, rf: 0, ra: 0 };
      if (mf > ma) h[me][opp].w++; else h[me][opp].l++;
      h[me][opp].rf += mf; h[me][opp].ra += ma;
    }
  }
  return h;
}
const order = rows => rows.map(r => r.name);

describe('standings tiebreaks', () => {
  test('record comes first — more wins outranks every tiebreak', () => {
    const rows = [
      { name: 'Few',  w: 1, l: 0, rf: 1,  ra: 0 },
      { name: 'Many', w: 4, l: 1, rf: 99, ra: 0 },
    ];
    assert.deepEqual(order(rankStandings(rows, h2hFrom([]))), ['Many', 'Few']);
  });

  test('fewer losses breaks an equal-wins tie', () => {
    const rows = [
      { name: 'Played5', w: 3, l: 2, rf: 20, ra: 10 },
      { name: 'Played4', w: 3, l: 1, rf: 10, ra: 20 },
    ];
    assert.deepEqual(order(rankStandings(rows, h2hFrom([]))), ['Played4', 'Played5']);
  });

  test('head-to-head outranks overall run differential', () => {
    // Blue ran up the score on a weak team; Red beat Blue. Red places higher.
    const rows = [
      { name: 'Red',  w: 2, l: 1, rf: 12, ra: 10 },
      { name: 'Blue', w: 2, l: 1, rf: 30, ra: 5 },
    ];
    assert.deepEqual(order(rankStandings(rows, h2hFrom([['Red', 'Blue', 5, 4]]))), ['Red', 'Blue']);
  });

  test('with no head-to-head game played it falls through to run differential', () => {
    const rows = [
      { name: 'Red',  w: 2, l: 1, rf: 12, ra: 10 },
      { name: 'Blue', w: 2, l: 1, rf: 30, ra: 5 },
    ];
    assert.deepEqual(order(rankStandings(rows, h2hFrom([]))), ['Blue', 'Red']);
  });

  test('a three-way tie resolves by head-to-head record within the group', () => {
    const rows = ['A', 'B', 'C'].map(name => ({ name, w: 3, l: 1, rf: 10, ra: 9 }));
    const h = h2hFrom([['A', 'B', 3, 1], ['A', 'C', 3, 1], ['B', 'C', 3, 1]]);
    assert.deepEqual(order(rankStandings(rows, h)), ['A', 'B', 'C']);
  });

  test('a circular three-way tie falls through to overall run differential', () => {
    // Each team is 1-1 inside the group with the same head-to-head margin,
    // so nothing in the group separates them — exactly the case a paper
    // sheet punts to the next criterion.
    const rows = [
      { name: 'A', w: 2, l: 2, rf: 10, ra: 10 },
      { name: 'B', w: 2, l: 2, rf: 14, ra: 10 },
      { name: 'C', w: 2, l: 2, rf: 12, ra: 10 },
    ];
    const h = h2hFrom([['A', 'B', 5, 3], ['B', 'C', 5, 3], ['C', 'A', 5, 3]]);
    assert.deepEqual(order(rankStandings(rows, h)), ['B', 'C', 'A']);
  });

  test('head-to-head run differential separates a split head-to-head', () => {
    // Both 1-1 against each other, but one won by more across the two games.
    const rows = [
      { name: 'X', w: 2, l: 2, rf: 20, ra: 20 },
      { name: 'Y', w: 2, l: 2, rf: 20, ra: 20 },
    ];
    const h = h2hFrom([['X', 'Y', 10, 1], ['Y', 'X', 3, 2]]);
    assert.deepEqual(order(rankStandings(rows, h)), ['X', 'Y']);
  });

  test('fewest runs allowed breaks an equal differential', () => {
    const rows = [
      { name: 'Slugfest', w: 1, l: 1, rf: 20, ra: 18 },
      { name: 'Pitching', w: 1, l: 1, rf: 5,  ra: 3 },
    ];
    assert.deepEqual(order(rankStandings(rows, h2hFrom([]))), ['Pitching', 'Slugfest']);
  });

  test('identical teams order by name, never arbitrarily', () => {
    const rows = [
      { name: 'Zeta',  w: 1, l: 1, rf: 5, ra: 5 },
      { name: 'Alpha', w: 1, l: 1, rf: 5, ra: 5 },
    ];
    const out = order(rankStandings(rows, h2hFrom([])));
    assert.deepEqual(out, ['Alpha', 'Zeta']);
    // Stable regardless of the order they arrive in.
    assert.deepEqual(order(rankStandings(rows.slice().reverse(), h2hFrom([]))), out);
  });

  test('teams outside the tied group never affect the tiebreak', () => {
    // Weak is not tied with Red/Blue, so Blue's win over Weak must not count
    // as head-to-head credit against Red.
    const rows = [
      { name: 'Red',  w: 2, l: 1, rf: 12, ra: 10 },
      { name: 'Blue', w: 2, l: 1, rf: 12, ra: 10 },
      { name: 'Weak', w: 0, l: 3, rf: 1,  ra: 40 },
    ];
    const h = h2hFrom([['Red', 'Blue', 4, 3], ['Blue', 'Weak', 20, 0]]);
    assert.deepEqual(order(rankStandings(rows, h)), ['Red', 'Blue', 'Weak']);
  });

  test('does not mutate the array it is given', () => {
    const rows = [
      { name: 'B', w: 1, l: 0, rf: 0, ra: 0 },
      { name: 'A', w: 2, l: 0, rf: 0, ra: 0 },
    ];
    const snapshot = order(rows);
    rankStandings(rows, h2hFrom([]));
    assert.deepEqual(order(rows), snapshot);
  });

  test('the published tiebreak note names the criteria actually used', () => {
    for (const phrase of ['head-to-head', 'run differential', 'runs allowed']) {
      assert.ok(STANDINGS_TIEBREAKS.includes(phrase), 'note should mention ' + phrase);
    }
  });
});
