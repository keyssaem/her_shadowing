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
const { weekReport, streakInfo } = await import('../js/motivate.js');

test('streak freeze: one rest day per week keeps the streak; two in a row break it', () => {
  const on = { lines: 5, heard: 0, reviews: 0, recs: 0, ms: 120000 };
  const mk = (keys) => Object.fromEntries(keys.map((k) => [k, on]));
  const today = new Date(2026, 10, 27); // Fri 27 Nov 2026
  // Studied Mon–Thu except Wed (25th) → freeze bridges Wed.
  let r = streakInfo(mk(['2026-11-23', '2026-11-24', '2026-11-26', '2026-11-27']), today);
  assert.equal(r.n, 4);
  assert.deepEqual(r.frozen, ['2026-11-25']);
  assert.ok(r.freezeUsedThisWeek);
  // Two missed days in a row → only the days after the gap count.
  r = streakInfo(mk(['2026-11-23', '2026-11-26', '2026-11-27']), today);
  assert.equal(r.n, 2);
  // Second gap in the same week is not bridged.
  r = streakInfo(mk(['2026-11-23', '2026-11-25', '2026-11-27']), today);
  assert.equal(r.n, 2);
  // Today not studied yet: the streak up to yesterday still counts.
  r = streakInfo(mk(['2026-11-25', '2026-11-26']), today);
  assert.equal(r.n, 2);
});
const Q = await import('../js/quiz.js');

// Deterministic random for repeatable quiz tests.
const seeded = (seed = 7) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const sampleScenes = [{
  id: 'sc1', items: [
    { t: 'd', sp: 'THEODORE', text: "Maybe we should call it a night. I've had such an amazing time.", page: 39 },
    { t: 'd', sp: 'SAMANTHA', text: 'You can still wallow in your misery, just do it while getting dressed.', page: 31 },
    { t: 'a', text: 'He walks away.' },
    { t: 'd', sp: 'AMY', text: 'Charles and I split up after eight long years together.', page: 53 },
  ],
}];
const ex = (id, en, ko, cat, idx) => ({ id, en, ko, cat, source: { sceneId: 'sc1', index: idx, sp: sampleScenes[0].items[idx].sp, text: sampleScenes[0].items[idx].text } });
const sampleExprs = [
  ex('e1', 'Maybe we should call it a night.', '오늘은 이만하자', 'A', 0),
  ex('e2', 'You can still wallow in your misery', '슬픔에 빠져 있어도 돼', 'A', 1),
  ex('e3', 'Charles and I split up', '우리 헤어졌어', 'A', 3),
];

test('quiz: cloze blanks a key word of the expression inside the line', () => {
  const pool = Q.wordPool(sampleScenes);
  const q = Q.makeCloze(sampleExprs[1], pool, seeded());
  assert.equal(q.type, 'cloze');
  assert.ok(q.prompt.includes('_____'));
  assert.equal(q.options.length, 4);
  assert.equal(q.options[q.answer].toLowerCase(), Q.keyWord(sampleExprs[1].en).toLowerCase());
  assert.equal(Q.keyWord('Charles and I split up'), 'split'); // names are skipped
  assert.equal(new Set(q.options.map((o) => o.toLowerCase())).size, 4);
});

test('quiz: distractor pool skips names and fillers', () => {
  const pool = Q.wordPool([{ id: 's', items: [{ t: 'd', sp: 'AMY', text: 'Mmmm, Charles really wanted coffee. Hmmmm.' }] }]);
  assert.ok(pool.includes('wanted') && pool.includes('coffee'));
  assert.ok(!pool.includes('charles') && !pool.includes('mmmm') && !pool.includes('hmmmm'));
});

test('quiz: line pool keeps main-character dialogue of a usable length', () => {
  const cands = Q.lineCandidates(sampleScenes);
  assert.equal(cands.length, 3);
  assert.deepEqual(cands.map((c) => c.sp), ['THEODORE', 'SAMANTHA', 'AMY']);
  assert.equal(Q.makeWho, undefined); // the who-said-it game was removed
});

const P = await import('../js/pitch.js');
// Synthetic "voice": a sine wave whose pitch glides from f0 to f1, with silence around it.
const glide = (f0, f1, secs = 0.8, sr = 16000) => {
  const n = Math.floor(secs * sr), pad = Math.floor(0.15 * sr);
  const out = new Float32Array(n + pad * 2);
  let phase = 0;
  for (let i = 0; i < n; i++) { const f = f0 + (f1 - f0) * (i / n); phase += (2 * Math.PI * f) / sr; out[pad + i] = 0.5 * Math.sin(phase); }
  return out;
};

test('pitch: tracks a rising tone and ignores silence', () => {
  const tr = P.pitchTrack(glide(150, 250), 16000);
  const voiced = tr.filter((p) => p.hz);
  assert.ok(voiced.length > 20);
  assert.ok(Math.abs(voiced[2].hz - 150) < 20, `start ${voiced[2].hz}`);
  assert.ok(Math.abs(voiced.at(-3).hz - 250) < 25, `end ${voiced.at(-3).hz}`);
  assert.equal(tr[0].hz, null); // leading silence
});

test('pitch: same melody in a deeper voice matches; opposite melody does not', () => {
  const sr = 16000;
  const native = P.contour(P.pitchTrack(glide(200, 300), sr));
  const sameShapeLower = P.contour(P.pitchTrack(glide(110, 165), sr)); // same rise, an octave-ish lower
  const falling = P.contour(P.pitchTrack(glide(300, 200), sr));
  const same = P.similarity(native, sameShapeLower);
  const diff = P.similarity(native, falling);
  assert.ok(same >= 85, `same ${same}`);
  assert.ok(diff <= 20, `diff ${diff}`);
  assert.ok(P.contourPath(native).startsWith('M'));
});

test('quiz: sound-alike variants change exactly one misheard word', () => {
  const v = Q.soundAlikes("I'm going to tell you, and I can't wait.");
  assert.ok(v.includes("I'm gonna tell you, and I can't wait."));
  assert.ok(v.includes("I'm going to tell you, and I can wait."));
  assert.ok(v.every((s) => s !== "I'm going to tell you, and I can't wait."));
  const q = Q.makeListen({ sceneId: 's', itemIndex: 1, sp: 'AMY', text: "I'm going to tell you, and I can't wait for the party." }, seeded());
  assert.equal(q.options.length, 4);
  assert.equal(q.options[q.answer], "I'm going to tell you, and I can't wait for the party.");
});

test('quiz: word order and next-line questions', () => {
  const o = Q.makeOrder({ sceneId: 's', itemIndex: 0, sp: 'AMY', text: 'Charles and I split up.' }, seeded());
  assert.deepEqual(o.words, ['Charles', 'and', 'I', 'split', 'up']);
  assert.ok(Q.orderCorrect(o, [0, 1, 2, 3, 4]));
  assert.ok(!Q.orderCorrect(o, [1, 0, 2, 3, 4]));
  const pairs = Q.nextPairs(sampleScenes);
  assert.equal(pairs[0].sp, 'THEODORE');
  assert.equal(pairs[0].nextSp, 'SAMANTHA');
  const pool = [1, 2, 3, 4].map((k) => ({ sceneId: 'x' + k, text: `Another line number ${k} here.` }));
  const n = Q.makeNext(pairs[0], pool, seeded());
  assert.equal(n.options[n.answer], pairs[0].next);
  assert.equal(n.options.length, 4);
});

test('quiz: two-choice and match are well formed; stars scale with accuracy', () => {
  const q = Q.makeTwoChoice(sampleExprs[0], sampleExprs, seeded());
  assert.equal(q.options.length, 2);
  assert.equal(q.options[q.answer], sampleExprs[0].en);
  const m = Q.makeMatch(sampleExprs, seeded());
  assert.equal(m.pairs.length, 3);
  assert.deepEqual([...m.left].sort(), ['e1', 'e2', 'e3']);
  assert.equal(Q.starsFor(10, 10), 3);
  assert.equal(Q.starsFor(7, 10), 2);
  assert.equal(Q.starsFor(4, 10), 1);
  assert.equal(Q.starsFor(1, 10), 0);
});

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
