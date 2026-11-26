// English-English dictionary lookup (Free Dictionary API, Wiktionary data)
// plus the personal "Drill Dictionary" with simple spaced repetition.

const API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const DAY = 86400000;
const INTERVALS = [0, 1, 2, 4, 7, 15, 30]; // days per box

const ls = {
  get(k, d) { try { const v = localStorage.getItem('her.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('her.' + k, JSON.stringify(v)); } catch { /* full or blocked */ } },
};

export const keyOf = (s) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' -]/g, '').replace(/\s+/g, ' ').trim();

// ---------- lookup ----------
const cache = ls.get('dictcache', {});
const saveCache = () => {
  const keys = Object.keys(cache);
  if (keys.length > 200) keys.slice(0, keys.length - 200).forEach((k) => delete cache[k]);
  ls.set('dictcache', cache);
};

const IRREGULAR = {
  was: 'be', were: 'be', is: 'be', are: 'be', am: 'be', been: 'be', "i'm": 'be',
  did: 'do', done: 'do', does: 'do', had: 'have', has: 'have', went: 'go', gone: 'go',
  said: 'say', made: 'make', took: 'take', taken: 'take', got: 'get', gotten: 'get', saw: 'see', seen: 'see',
  knew: 'know', known: 'know', thought: 'think', felt: 'feel', left: 'leave', told: 'tell', found: 'find',
  came: 'come', gave: 'give', given: 'give', fell: 'fall', fallen: 'fall', woke: 'wake', hid: 'hide', hidden: 'hide',
  grew: 'grow', grown: 'grow', wrote: 'write', written: 'write', lost: 'lose', meant: 'mean', brought: 'bring',
  bought: 'buy', caught: 'catch', taught: 'teach', sat: 'sit', stood: 'stand', ran: 'run', began: 'begin',
  gonna: 'going to', wanna: 'want to', gotta: 'got to', gimme: 'give me', kinda: 'kind of', 'cause': 'because', cause: 'because',
};

function candidates(phrase) {
  const k = keyOf(phrase);
  const out = [k];
  if (k.includes(' ')) return out;
  const w = k.replace(/'s$/, '').replace(/n't$/, '');
  if (IRREGULAR[k]) out.push(IRREGULAR[k]);
  if (w !== k) out.push(w);
  if (/ies$/.test(w)) out.push(w.replace(/ies$/, 'y'));
  if (/ied$/.test(w)) out.push(w.replace(/ied$/, 'y'));
  if (/(ches|shes|sses|xes|zes|oes)$/.test(w)) out.push(w.replace(/es$/, ''));
  if (/s$/.test(w) && !/ss$/.test(w)) out.push(w.replace(/s$/, ''));
  if (/ing$/.test(w)) {
    const b = w.replace(/ing$/, '');
    out.push(b, b + 'e');
    if (/(.)\1$/.test(b)) out.push(b.slice(0, -1));
  }
  if (/ed$/.test(w)) {
    const b = w.replace(/ed$/, '');
    out.push(b, b + 'e', w.replace(/d$/, ''));
    if (/(.)\1$/.test(b)) out.push(b.slice(0, -1));
  }
  if (/ly$/.test(w)) out.push(w.replace(/ly$/, ''), w.replace(/ily$/, 'y'));
  if (/er$/.test(w)) out.push(w.replace(/er$/, ''), w.replace(/r$/, ''));
  return [...new Set(out)].filter((c) => c.length > 0);
}

function simplify(entries) {
  const e = entries[0];
  const meanings = [];
  for (const en of entries) {
    for (const m of en.meanings || []) {
      let slot = meanings.find((x) => x.pos === m.partOfSpeech);
      if (!slot) { slot = { pos: m.partOfSpeech, defs: [] }; meanings.push(slot); }
      for (const d of m.definitions || []) {
        if (slot.defs.length < 4) slot.defs.push({ d: d.definition, ex: d.example || '' });
      }
    }
  }
  const phonetic = e.phonetic || (e.phonetics || []).find((p) => p.text)?.text || '';
  return { headword: e.word, phonetic, meanings };
}

/** Look up a word or phrase; tries simple lemma forms. Returns null if not found. */
export async function lookup(phrase) {
  const cands = candidates(phrase);
  for (const c of cands) {
    if (cache[c] !== undefined) { if (cache[c]) return cache[c]; continue; }
    try {
      const res = await fetch(API + encodeURIComponent(c));
      if (res.status === 404) { cache[c] = null; saveCache(); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const r = simplify(await res.json());
      cache[c] = r; saveCache();
      return r;
    } catch (err) {
      if (!navigator.onLine) throw new Error('오프라인 상태라 사전을 불러올 수 없습니다.');
      throw err;
    }
  }
  return null;
}

/** Guess the most likely part of speech from the word before it. */
export function guessPos(prevWord, meanings) {
  const p = (prevWord || '').toLowerCase();
  const has = (pos) => meanings.some((m) => m.pos === pos);
  if (/^(to|i|you|we|they|he|she|it|can|could|will|would|should|must|don't|didn't|doesn't|won't|can't|gonna|wanna|let's|just|i'll|you'll|we'll)$/.test(p) && has('verb')) return 'verb';
  if (/^(a|an|the|my|your|his|her|our|their|this|that|these|those|some|any|no)$/.test(p) && has('noun')) return 'noun';
  if (/^(so|very|too|really|pretty|kind|quite|more|most|is|are|was|were|feel|feels|look|looks|sound|sounds)$/.test(p) && has('adjective')) return 'adjective';
  return meanings[0]?.pos;
}

// ---------- Drill Dictionary ----------
let items = ls.get('mydict', []);
const persist = () => ls.set('mydict', items);

export const myDict = {
  all: () => items.slice().sort((a, b) => b.added - a.added),
  has: (text) => items.some((i) => i.id === keyOf(text)),
  get: (text) => items.find((i) => i.id === keyOf(text)),
  due: (now = Date.now()) => items.filter((i) => i.due <= now).sort((a, b) => a.due - b.due),
  add(entry) {
    const id = keyOf(entry.text);
    const existing = items.find((i) => i.id === id);
    if (existing) { Object.assign(existing, entry, { id }); persist(); return existing; }
    const it = { ...entry, id, box: 0, due: Date.now(), added: Date.now(), reviews: 0 };
    items.push(it); persist();
    return it;
  },
  remove(id) { items = items.filter((i) => i.id !== id); persist(); },
  /** grade: 'good' (box+1), 'easy' (box+2), 'hard' (back to box 0, due now) */
  review(id, grade = 'good') {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    if (grade === 'hard') { it.box = 0; it.due = Date.now(); }
    else {
      it.box = Math.min(INTERVALS.length - 1, it.box + (grade === 'easy' ? 2 : 1));
      it.due = Date.now() + INTERVALS[it.box] * DAY;
    }
    it.reviews = (it.reviews || 0) + 1;
    persist();
  },
  reload() { items = ls.get('mydict', []); },
};

/**
 * Spaced-repetition state for items that live elsewhere (e.g. the curated key
 * expressions). Items without state are "new".
 */
export function makeSrs(storageKey) {
  let st = ls.get(storageKey, {});
  const save = () => ls.set(storageKey, st);
  return {
    get: (id) => st[id],
    isNew: (id) => !st[id],
    isDue: (id, now = Date.now()) => !!st[id] && st[id].due <= now,
    review(id, grade = 'good') {
      const it = st[id] || { box: 0, due: 0, reviews: 0 };
      if (grade === 'hard') { it.box = 0; it.due = Date.now(); }
      else {
        it.box = Math.min(INTERVALS.length - 1, it.box + (grade === 'easy' ? 2 : 1));
        it.due = Date.now() + INTERVALS[it.box] * DAY;
      }
      it.reviews++;
      st[id] = it; save();
      return it;
    },
    all: () => st,
    reload() { st = ls.get(storageKey, {}); },
  };
}

export const boxLabel = (box) => ['새 단어', '1일', '2일', '4일', '1주', '2주', '1달'][box] || '';
