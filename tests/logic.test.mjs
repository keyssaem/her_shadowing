// Unit tests for the app's pure logic. Run:  node --test tests/
// (No dependencies; uses Node's built-in test runner.)
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage for modules that persist state.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};

const { scoreAgainst } = await import('../js/recorder.js');
const { chunkLine } = await import('../js/player.js');
const { makeSrs, keyOf, guessPos } = await import('../js/dict.js');
const { speedFor, isFullSpeed } = await import('../js/speed.js');
const { parseScript } = await import('../js/parser.js');
const { weekReport } = await import('../js/motivate.js');

test('scoring: contractions and slang count as the same words', () => {
  const r = scoreAgainst("I'm sorry, you go first. What were you going to say?", ['I am sorry you go first what were you gonna say']);
  assert.equal(r.score, 100);
  assert.ok(r.words.every((w) => w.ok));
});

test('scoring: missed words are marked on the original text', () => {
  const r = scoreAgainst("I'm sorry, you go first. What were you going to say?", ['sorry you go first what you going to say']);
  assert.deepEqual(r.words.filter((w) => !w.ok).map((w) => w.text), ["I'm", 'were']);
  assert.equal(r.score, 75);
});

test('scoring: picks the best recognition alternative and ignores number commas', () => {
  assert.equal(scoreAgainst('How many others? 8,316.', ['how many brothers', 'how many others 8316']).score, 100);
});

test('dictation: apostrophes and capitals do not matter', () => {
  assert.equal(scoreAgainst("Hey, how's it going?", ['hey hows it going']).score, 100);
  assert.equal(scoreAgainst("I don't know. I'm not ready.", ['i dont know im not ready']).score, 100);
  assert.equal(scoreAgainst("It's well.", ['its well']).score, 100);
});

test('chunkLine keeps short lines whole and splits long ones by sentence', () => {
  assert.deepEqual(chunkLine('Hey, how is it going?'), ['Hey, how is it going?']);
  const long = 'One two three four five six seven eight. Nine ten eleven twelve thirteen. Fourteen fifteen sixteen seventeen eighteen.';
  const parts = chunkLine(long, 10);
  assert.ok(parts.length >= 2);
  assert.equal(parts.join(' '), long);
});

test('SRS: good moves up a box, hard resets and is due now, easy jumps two', () => {
  const srs = makeSrs('test-srs');
  assert.ok(srs.isNew('a'));
  const a1 = srs.review('a', 'good');
  assert.equal(a1.box, 1);
  assert.ok(a1.due > Date.now());
  const a2 = srs.review('a', 'hard');
  assert.equal(a2.box, 0);
  assert.ok(srs.isDue('a'));
  assert.equal(srs.review('b', 'easy').box, 2);
  for (let i = 0; i < 10; i++) srs.review('c', 'good');
  assert.equal(srs.get('c').box, 6); // capped at the 1-month box
});

test('dictionary helpers', () => {
  assert.equal(keyOf('  Up Front! '), 'up front');
  const meanings = [{ pos: 'noun' }, { pos: 'verb' }];
  assert.equal(guessPos('to', meanings), 'verb');
  assert.equal(guessPos('the', meanings), 'noun');
});

test('speed steps follow the base speed', () => {
  assert.equal(speedFor(0, 0.95), 0.8);
  assert.equal(speedFor(1, 0.95), 0.9);
  assert.equal(speedFor(2, 0.95), 0.95);
  assert.equal(speedFor(9, 1.1), 1.1);
  assert.equal(speedFor(0, 0.6), 0.5); // never below 0.5
  assert.equal(speedFor(0, 0.95, false), 0.95);
  assert.ok(isFullSpeed(2) && !isFullSpeed(1));
});

test('parser: cues, parentheticals, dual dialogue and actions', () => {
  // Synthetic positioned lines in standard screenplay layout (action x=108).
  let y = 700, row = 0;
  const L = (x, text, sameRow = false) => { if (!sameRow) { y -= 12; row++; } return { x, y, row, text, page: 1 }; };
  const lines = [
    L(108, 'INT. TEST ROOM - DAY'),
    L(108, 'A long action line that describes the room in enough detail to be long.'),
    L(252, 'ANNA'),
    L(180, 'Hello there,'),
    L(180, 'how are you?'),
    L(216, '(beat)'),
    L(180, 'Fine.'),
    L(152, "BOB (CONT'D)"), L(408, 'CARL', true),
    L(108, 'Left side'), L(333, 'Right side', true),
  ];
  const r = parseScript(lines);
  assert.equal(r.scenes.length, 1);
  const d = r.scenes[0].items.filter((i) => i.t === 'd');
  assert.deepEqual(d.map((i) => [i.sp, i.text, i.paren || null]), [
    ['ANNA', 'Hello there, how are you?', null],
    ['ANNA', 'Fine.', 'beat'],
    ['BOB', 'Left side', null],
    ['CARL', 'Right side', null],
  ]);
  assert.equal(r.scenes[0].items[0].t, 'a');
});

test('weekly report summarises the seven days ending on a Sunday', () => {
  const day = (lines, ms, reviews = 0, grad = 0) => ({ lines, heard: 0, reviews, recs: 0, ms, scenes: 0, grad });
  const days = { '2026-11-16': day(10, 600000), '2026-11-22': day(5, 300000, 4, 1), '2026-11-23': day(99, 9e6) };
  const w = weekReport(days, new Date(2026, 10, 22)); // Sunday 22 Nov 2026
  assert.equal(w.minutes, 15);
  assert.equal(w.lines, 15);
  assert.equal(w.reviews, 4);
  assert.equal(w.graduated, 1);
  assert.equal(w.activeDays, 2);
});
