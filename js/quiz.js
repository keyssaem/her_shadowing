// Quiz question generators. Pure functions over the imported script and the
// curated expressions, so they run offline and are unit-tested.
//
// Every question: { type, key, ref, prompt..., options[], answer (index) }
//   key: stable id for wrong-answer notes;  ref: expression id when it maps to one

const STOP = new Set(('a an the to of in on at for and or but if so is are was were be been am i you he she it we they me my your ' +
  'his her our their this that with as do does did not no yes just what how why who when where there here can will would could ' +
  'should have has had get got go going let us up out about from by all some any one oh okay well really very much too').split(' '));

export const MAIN_SPEAKERS = ['THEODORE', 'SAMANTHA', 'AMY', 'CATHERINE', 'PAUL', 'CHARLES'];

const shuffleWith = (rand) => (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const wordsIn = (s) => s.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || [];

/** All distinct "content" words of the script (for plausible distractors). */
export function wordPool(scenes) {
  const set = new Set();
  for (const sc of scenes) for (const it of sc.items) if (it.t === 'd') for (const w of wordsIn(it.text)) {
    // Only words seen in lower case (skips names like "Charles"), no fillers like "mmmm".
    if (w !== w.toLowerCase()) continue;
    if (w.length < 3 || w.length > 12 || STOP.has(w) || w.includes("'") || /(.)\1\1/.test(w)) continue;
    set.add(w);
  }
  return [...set];
}

const suffixOf = (w) => (/ing$/.test(w) ? 'ing' : /ed$/.test(w) ? 'ed' : /ly$/.test(w) ? 'ly' : /s$/.test(w) ? 's' : '');

/** Distractor words shaped like the answer (same ending, similar length). */
function distractors(answer, pool, n, rand) {
  const a = answer.toLowerCase();
  const suf = suffixOf(a);
  const close = pool.filter((w) => w !== a && suffixOf(w) === suf && Math.abs(w.length - a.length) <= 2);
  const loose = pool.filter((w) => w !== a && !close.includes(w));
  const pick = shuffleWith(rand)(close).slice(0, n);
  if (pick.length < n) pick.push(...shuffleWith(rand)(loose).slice(0, n - pick.length));
  return pick;
}

/** The key word to blank inside an expression: longest non-stopword. */
export function keyWord(en) {
  const all = wordsIn(en).filter((w) => !STOP.has(w.toLowerCase()) && !w.includes("'"));
  // Prefer ordinary words over names (capitalised mid-sentence words like "Charles").
  const plain = all.filter((w, i) => !(/^[A-Z]/.test(w) && (i > 0 || all.length > 1)));
  const ws = plain.length ? plain : all;
  if (!ws.length) return null;
  return ws.sort((x, y) => y.length - x.length)[0];
}

/** 1) Fill in the blank inside the original line. */
export function makeCloze(expr, pool, rand = Math.random) {
  const line = expr.source?.text || expr.en;
  const kw = keyWord(expr.en);
  if (!kw) return null;
  const re = new RegExp(`\\b${kw}\\b`, 'i');
  if (!re.test(line)) return null;
  const blanked = line.replace(re, '_____');
  const correct = line.match(re)[0];
  const options = shuffleWith(rand)([correct, ...distractors(correct, pool, 3, rand)]);
  return {
    type: 'cloze', key: 'cloze:' + expr.id, ref: expr.id,
    prompt: blanked, hint: expr.ko, sp: expr.source?.sp, line,
    options, answer: options.indexOf(correct),
  };
}

/** 2) Match five Korean meanings to five English expressions. */
export function makeMatch(exprs, rand = Math.random) {
  const five = exprs.slice(0, 5);
  if (five.length < 3) return null;
  return {
    type: 'match', key: 'match:' + five.map((e) => e.id).join(','),
    pairs: five.map((e) => ({ id: e.id, ko: e.ko, en: e.en })),
    left: shuffleWith(rand)(five.map((e) => e.id)),
    right: shuffleWith(rand)(five.map((e) => e.id)),
  };
}

/** Lines that make good "who said it?" questions. */
export function whoCandidates(scenes) {
  const out = [];
  for (const sc of scenes) sc.items.forEach((it, i) => {
    if (it.t !== 'd' || !MAIN_SPEAKERS.includes(it.sp)) return;
    const n = wordsIn(it.text).length;
    if (n >= 5 && n <= 28) out.push({ sceneId: sc.id, itemIndex: i, sp: it.sp, text: it.text, page: it.page });
  });
  return out;
}

/** 3) Who said this line? */
export function makeWho(cand, rand = Math.random) {
  const others = shuffleWith(rand)(MAIN_SPEAKERS.filter((s) => s !== cand.sp));
  // Theodore and Samantha are always plausible, so keep them among the options.
  const must = ['THEODORE', 'SAMANTHA'].filter((s) => s !== cand.sp);
  const rest = others.filter((s) => !must.includes(s));
  const options = shuffleWith(rand)([cand.sp, ...must, ...rest].slice(0, 4));
  return {
    type: 'who', key: `who:${cand.sceneId}:${cand.itemIndex}`, ref: null,
    prompt: cand.text, sceneId: cand.sceneId, itemIndex: cand.itemIndex, page: cand.page,
    options, answer: options.indexOf(cand.sp),
  };
}

/** 4) Audio two-choice: Korean meaning → which English is right? */
export function makeTwoChoice(expr, all, rand = Math.random) {
  const len = expr.en.length;
  const same = all.filter((e) => e.id !== expr.id && e.cat === expr.cat);
  const pool = (same.length ? same : all.filter((e) => e.id !== expr.id))
    .sort((a, b) => Math.abs(a.en.length - len) - Math.abs(b.en.length - len)).slice(0, 6);
  const wrong = shuffleWith(rand)(pool)[0];
  if (!wrong) return null;
  const options = shuffleWith(rand)([expr.en, wrong.en]);
  return {
    type: 'two', key: 'two:' + expr.id, ref: expr.id,
    prompt: expr.ko, options, answer: options.indexOf(expr.en), line: expr.source?.text || '',
    sp: expr.source?.sp,
  };
}

/** Stars for a finished round. */
export const starsFor = (correct, total) => {
  const r = total ? correct / total : 0;
  return r >= 0.9 ? 3 : r >= 0.7 ? 2 : r >= 0.4 ? 1 : 0;
};
