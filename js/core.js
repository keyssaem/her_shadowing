import { ACTS, annotateScenes, linkExpressions } from './content.js';
import { Player } from './player.js';
import { estimateSeconds, configureHq } from './tts.js';
import { DEFAULT_HQ_VOICES } from './hq-tts.js';
import { myDict, makeSrs } from './dict.js';
import { speedFor, SPEED_OFFSETS } from './speed.js';
import { makeTwoChoice } from './quiz.js';
import { track, lineLetter, stats, dayKey } from './motivate.js';
import { updateHomeStrip } from './view-home.js';
import { toast, openLetter, updatePlayerUI } from './ui.js';

// ---------- storage ----------
export const LS = {
  get(k, d) { try { const v = localStorage.getItem('her.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('her.' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem('her.' + k); } catch { /* ignore */ } },
};

export const DEFAULT_SETTINGS = {
  mode: 'shadow', myRole: 'THEODORE', rate: 0.95, repeat: 2, gapFactor: 1.3,
  narration: false, roleReveal: true, drillKoreanFirst: true, loopScene: false, wakeLock: true,
  keyOnly: false, voices: {}, voiceMotivation: true, dailyGoal: 15, autoSpeed: true, showKo: false,
  theme: 'auto', textSize: 'm', hqVoice: false, hqVoices: { ...DEFAULT_HQ_VOICES },
};

export const state = {
  script: LS.get('script', null),
  settings: { ...DEFAULT_SETTINGS, ...LS.get('settings', {}) },
  progress: LS.get('progress', null), // { sceneId, index }
  done: new Set(LS.get('done', [])),
  mastered: new Set(LS.get('mastered', [])),
  expressions: [],
  view: null,
};
/** Push voice settings to the speech layer (device voices + optional OpenAI voices). */
export function syncVoices() {
  const s = state.settings;
  configureHq({ enabled: !!s.hqVoice, voices: { ...DEFAULT_HQ_VOICES, ...s.hqVoices }, deviceVoices: s.voices });
}
export const saveSettings = () => { LS.set('settings', state.settings); syncVoices(); };
syncVoices();

// Ask the browser not to evict our data (script, progress) under storage pressure,
// so the PDF only ever needs to be imported once per device.
export async function ensurePersistent() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}

/** Apply the theme and text size from settings to the page. */
export function applyDisplay() {
  const root = document.documentElement;
  const { theme, textSize } = state.settings;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme; else delete root.dataset.theme;
  if (textSize === 'l' || textSize === 'xl') root.dataset.size = textSize; else delete root.dataset.size;
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1b1311' : '#fbf3ec');
}
applyDisplay();

export function hydrate() {
  if (!state.script) return;
  annotateScenes(state.script.scenes);
  state.expressions = linkExpressions(state.script.scenes);
}
hydrate();

export const $app = document.getElementById('app');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sceneById = (id) => state.script?.scenes.find((s) => s.id === id);
export const sceneTitle = (s) => s.ko || s.heading.replace(/^(INT\.|EXT\.)\s*/, '');
export const dialogueCount = (s) => s.items.filter((i) => i.t === 'd').length;
export const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- player ----------
export const player = new Player({ getSettings: () => state.settings, onChange: () => updatePlayerUI() });

// ---------- motivation delivery ----------
// Messages show as toasts; during playback they are also spoken between cards
// (Korean then English) so they reach you while driving. Letters open as a card.
export function deliver(msgs) {
  for (const m of msgs.filter(Boolean)) {
    toast(m.ko, m.kind === 'letter' ? '💌' : '✨');
    if (player.playing && state.settings.voiceMotivation && m.voice) {
      player.announce([
        { type: 'beep', freq: 1046, label: '💬 응원 메시지' },
        { type: 'speak', text: m.ko, voiceName: state.settings.voices.korean, lang: 'ko-KR', rate: 1, label: '💬 ' + m.ko },
        { type: 'speak', text: m.en, voiceName: state.settings.voices.samantha, rate: state.settings.rate, label: '💬 ' + m.en },
        { type: 'wait', ms: 500 },
      ]);
    }
    if (m.kind === 'letter' && !player.playing) setTimeout(() => openLetter(m.letter), 900);
  }
  updateHomeStrip();
}
export const reviewWord = (id, grade) => {
  const before = myDict.all().find((i) => i.id === id);
  if (!before) return;
  const prevBox = before.box;
  myDict.review(id, grade);
  const it = myDict.all().find((i) => i.id === id);
  if (grade === 'hard') return deliver(track('review', { word: it.text, box: 0 }));
  const NEXT = ['', '1일', '2일', '4일', '1주', '2주', '1달'];
  const NEXT_EN = ['', 'a day', 'two days', 'four days', 'a week', 'two weeks', 'a month'];
  deliver(track('review', {
    word: it.text, box: it.box, graduated: it.box === 6 && prevBox < 6, nextKo: NEXT[it.box], nextEn: NEXT_EN[it.box],
  }));
};

// Word cards: listening to the end counts as a successful review;
// pressing "previous" (replay) marks the card hard so it comes back.
export const hardMarked = new Set();
player.onReplay = (card) => {
  if (card?.kind === 'word') { hardMarked.add(card.id); reviewWord(card.id, 'hard'); }
  if (card?.kind === 'expr') { hardMarked.add('x:' + card.id); exprSrs.review(card.id, 'hard'); }
  if (card?.lineKey) { hardMarked.add('l:' + card.lineKey); lineSrs.review(card.lineKey, 'hard'); }
};
player.onCardDone = (card) => {
  if (card.kind === 'word') {
    if (!hardMarked.delete(card.id)) reviewWord(card.id, 'good');
    return;
  }
  // Favourite / weak lines follow their own review schedule (1 → 2 → 4 days …).
  if (card.lineKey && !hardMarked.delete('l:' + card.lineKey)) lineSrs.review(card.lineKey, 'good');
  if (card.kind === 'expr') {
    if (!hardMarked.delete('x:' + card.id)) exprSrs.review(card.id, 'good');
    return;
  }
  if (card.kind === 'line') {
    deliver(track('line', { mode: state.settings.mode === 'listen' ? 'listen' : 'speak' }));
    deliver([lineLetter()]);
  }
  if ((card.kind === 'line' || card.kind === 'action') && card.sceneId && card.sceneIdx != null) {
    state.progress = { sceneId: card.sceneId, index: card.sceneIdx };
    LS.set('progress', state.progress);
  }
  if (card.lastOfScene) completeScene(card.sceneId, card.nextSceneId);
};
player.onFinished = () => {
  if (player.kind === 'scene' && player.sceneId) completeScene(player.sceneId);
  deliver(track('session'));
};

/** Mark a scene finished, move progress on, and celebrate (first time only). */
export function completeScene(sceneId, nextSceneId = null) {
  const scene = sceneById(sceneId);
  const firstTime = !state.done.has(sceneId);
  const plays = LS.get('plays', {});
  plays[sceneId] = (plays[sceneId] || 0) + 1;
  LS.set('plays', plays);
  if (state.settings.autoSpeed && plays[sceneId] < SPEED_OFFSETS.length) {
    toast(`다음에 이 장면은 ${sceneRate(sceneId)}배로 올려볼게요`, '⏫');
  } else if (state.settings.autoSpeed && plays[sceneId] === SPEED_OFFSETS.length) {
    toast('기본 속도로 끝까지 따라 했어요!', '🏁');
  }
  state.done.add(sceneId);
  LS.set('done', [...state.done]);
  state.progress = nextSceneId ? { sceneId: nextSceneId, index: 0 } : { sceneId, index: 0 };
  LS.set('progress', state.progress);
  if (!firstTime || !scene) return;
  const actScenes = state.script.scenes.filter((s) => s.act === scene.act && dialogueCount(s) > 0);
  const actDone = actScenes.every((s) => state.done.has(s.id)) ? scene.act : null;
  deliver(track('scene', {
    title: sceneTitle(scene), lines: dialogueCount(scene),
    actDone, actName: ACTS[scene.act - 1].ko, actEn: `Act ${scene.act}, ${ACTS[scene.act - 1].en}`,
  }));
}

// Count listening time while playing (daily goal + stats).
setInterval(() => {
  if (player.playing) deliver(track('tick', { ms: 5000, goalMin: state.settings.dailyGoal }));
}, 5000);

// Auto speed steps relative to the base speed setting (see speed.js).
export const scenePlays = (sceneId) => LS.get('plays', {})[sceneId] || 0;
export const sceneRate = (sceneId) => speedFor(scenePlays(sceneId), state.settings.rate, state.settings.autoSpeed);

// Key expressions get their own spaced-repetition schedule.
export const exprSrs = makeSrs('exprsrs');
// Saved lines (favourites, weak lines) get a schedule too, keyed "sceneId:itemIndex".
export const lineSrs = makeSrs('linesrs');
/** Lines ordered for review: due first (oldest due), then never-reviewed, then the rest. */
export function byLineDue(list) {
  const rank = (f) => {
    const st = lineSrs.get(`${f.sceneId}:${f.itemIndex}`);
    return !st ? 1 : st.due <= Date.now() ? 0 : 2;
  };
  return shuffle(list).sort((a, b) => rank(a) - rank(b)
    || (lineSrs.get(`${a.sceneId}:${a.itemIndex}`)?.due || 0) - (lineSrs.get(`${b.sceneId}:${b.itemIndex}`)?.due || 0));
}
/** n expressions to practise: due ones first, then new ones; never mastered. */
export function pickExpressions(n, list = state.expressions) {
  const open = list.filter((e) => !state.mastered.has(e.id));
  const due = open.filter((e) => exprSrs.isDue(e.id)).sort((a, b) => exprSrs.get(a.id).due - exprSrs.get(b.id).due);
  const fresh = shuffle(open.filter((e) => exprSrs.isNew(e.id)));
  const picked = [...due, ...fresh].slice(0, n);
  if (picked.length < n) picked.push(...shuffle(open.filter((e) => !picked.includes(e))).slice(0, n - picked.length));
  return picked.length ? picked : shuffle(list).slice(0, n);
}

export function sceneCards(scene) {
  const cards = [];
  const rate = sceneRate(scene.id);
  scene.items.forEach((it, itemIndex) => {
    if (it.t === 'd') cards.push({ kind: 'line', sp: it.sp, text: it.text, paren: it.paren, itemIndex, sceneId: scene.id, rate });
    else if (it.t === 'a' && state.settings.narration) cards.push({ kind: 'action', text: it.text, itemIndex, sceneId: scene.id, rate });
  });
  cards.forEach((c, i) => { c.sceneIdx = i; });
  return cards;
}

// ---------- today's drive ----------
// One tap before leaving: word review → 3 key expressions → continue the story,
// sized to the chosen minutes using the current speed / repeat / gap settings.
export function cardSeconds(card) {
  return player.stepsFor(card).reduce((sum, st) => sum + (
    st.type === 'speak' ? estimateSeconds(st.text, st.rate || 1)
      : st.type === 'wait' ? st.ms / 1000 : 0.3), 0);
}
export const exprCard = (e) => ({ kind: 'expr', id: e.id, en: e.en, ko: e.ko, note: e.note, sp: e.source?.sp, source: e.source });

export function planDrive(minutes) {
  const budget = minutes * 60;
  const cards = [];
  let used = 0;
  const push = (c) => { cards.push(c); used += cardSeconds(c); };
  const cue = (ko) => ({ kind: 'cue', ko, text: ko });

  // 1) Word review: due items, at most ~30% of the time.
  const words = [];
  let wUsed = 0;
  for (const i of myDict.due()) {
    const c = wordCard(i);
    const s = cardSeconds(c);
    if (wUsed + s > budget * 0.3) break;
    words.push(c); wUsed += s;
  }
  // 2) Three key expressions: due for review first, then new ones.
  const exprs = pickExpressions(3).map(exprCard);

  // 3) Story: continue from saved progress through the following scenes.
  const order = state.script.scenes.filter((s) => dialogueCount(s) > 0 && (!state.settings.keyOnly || s.key));
  let si = Math.max(0, order.findIndex((s) => s.id === state.progress?.sceneId));
  let startIdx = state.progress && order[si]?.id === state.progress.sceneId ? state.progress.index : 0;
  const firstScene = order[si];

  push(cue(`${minutes}분 코스 출발. ${words.length ? `단어 복습 ${words.length}개, ` : ''}핵심 표현 세 개, 그리고 ${sceneTitle(firstScene)} 장면을 이어서 할게요.`));
  // Morning drives start with today's real-life mission; evening drives end with a check-in.
  const mission = missionCards();
  if (mission.brief) push(mission.brief);
  if (words.length) { push(cue('먼저 단어 복습.')); words.forEach(push); }
  push(cue('핵심 표현 세 개.'));
  exprs.forEach(push);

  let first = true;
  const sceneTitles = [];
  while (used < budget && si < order.length) {
    const scene = order[si];
    const list = sceneCards(scene).slice(startIdx);
    if (!list.length) { si++; startIdx = 0; continue; }
    push(cue(first ? `이제 장면 이어서. ${sceneTitle(scene)}.` : `다음 장면. ${sceneTitle(scene)}.`));
    sceneTitles.push(sceneTitle(scene));
    first = false;
    for (let k = 0; k < list.length && used < budget; k++) {
      const c = list[k];
      if (k === list.length - 1) { c.lastOfScene = true; c.nextSceneId = order[si + 1]?.id || null; }
      push(c);
    }
    si++; startIdx = 0;
  }

  // 4) Finish with two or three of your favourite lines.
  const favs = byLineDue(favLines()).slice(0, minutes >= 30 ? 3 : 2);
  if (favs.length) {
    push(cue('마지막으로 내 명대사.'));
    favs.forEach((f) => push(favCard(f)));
  }
  // 4b) Lines that scored low in auto-scored shadowing.
  const weak = byLineDue(weakLineList()).slice(0, 2);
  if (weak.length) {
    push(cue('약했던 대사 다시 한 번.'));
    weak.forEach((f) => push(favCard(f)));
  }
  // 5) Bonus audio quiz, answered with the steering-wheel buttons.
  if (mission.check) push(mission.check);
  const quiz = audioQuizCards(3);
  if (quiz.length) {
    push(cue('보너스 퀴즈 세 문제. 1번이면 다음 곡, 2번이면 이전 곡 버튼을 누르세요.'));
    quiz.forEach(push);
  }
  return { cards, minutes, est: Math.round(used / 60), words: words.length, scenes: sceneTitles, favs: favs.length };
}

// ---------- quiz store: results feed the review schedule + wrong-answer notes ----------
// The "who said it?" game was removed; drop its leftover wrong-answer notes once.
{
  const w = LS.get('quiz.wrong', {});
  const left = Object.fromEntries(Object.entries(w).filter(([, v]) => v?.q?.type !== 'who'));
  if (Object.keys(left).length !== Object.keys(w).length) LS.set('quiz.wrong', left);
}
export const quizStore = {
  wrong: () => LS.get('quiz.wrong', {}),
  /** Record one answer. Expression questions update that expression's review schedule. */
  record(q, ok) {
    if (q.ref) exprSrs.review(q.ref, ok ? 'good' : 'hard');
    const w = LS.get('quiz.wrong', {});
    if (ok) delete w[q.key]; else w[q.key] = { q, at: Date.now(), n: (w[q.key]?.n || 0) + 1 };
    LS.set('quiz.wrong', w);
    const st = LS.get('quiz.stats', { correct: 0, total: 0, rounds: 0 });
    st.total++; if (ok) st.correct++;
    LS.set('quiz.stats', st);
  },
  stats: () => LS.get('quiz.stats', { correct: 0, total: 0, rounds: 0 }),
  best: () => LS.get('quiz.best', {}),
  /** Save a finished round; returns true when it beats the previous best. */
  finishRound(mode, correct, total, stars) {
    const best = LS.get('quiz.best', {});
    const prev = best[mode];
    const better = mode === 'survival'
      ? !prev || correct > prev.correct // survival: the longest run wins
      : !prev || stars > prev.stars || (stars === prev.stars && correct / total > prev.correct / prev.total);
    if (better) best[mode] = { stars, correct, total, at: Date.now() };
    LS.set('quiz.best', best);
    const st = LS.get('quiz.stats', { correct: 0, total: 0, rounds: 0 });
    st.rounds++; LS.set('quiz.stats', st);
    return better && !!prev;
  },
};

/** Audio two-choice quiz cards for hands-free play. */
export function audioQuizCards(n) {
  return pickExpressions(n)
    .map((e) => makeTwoChoice(e, state.expressions))
    .filter(Boolean)
    .map((q) => ({ kind: 'two', q, text: q.prompt }));
}

// ---------- today's real-life mission ----------
const MISSION_SITUATIONS = [
  '오늘 회의나 업무 대화에서', '점심 먹으면서 동료에게', '가족이나 친구와 통화하면서',
  '메신저로 친구에게 영어 한 줄로', '퇴근길 차 안에서 소리 내어', '오늘 있었던 일을 떠올리며 혼잣말로',
];
/** One phrase to use in real life today (picked once per day, prefers phrases you've started learning). */
export function todayMission() {
  const today = dayKey();
  let m = LS.get('mission', null);
  if (m && m.date === today && state.expressions.some((e) => e.id === m.exprId)) {
    const e = state.expressions.find((x) => x.id === m.exprId);
    return { ...m, en: e.en, ko: e.ko };
  }
  const learning = state.expressions.filter((e) => !exprSrs.isNew(e.id) && !state.mastered.has(e.id));
  const pool = learning.length ? learning : state.expressions;
  const e = pool[Math.floor(Math.random() * pool.length)];
  if (!e) return null;
  m = { date: today, exprId: e.id, situation: MISSION_SITUATIONS[Math.floor(Math.random() * MISSION_SITUATIONS.length)], status: null };
  LS.set('mission', m);
  return { ...m, en: e.en, ko: e.ko };
}
export function setMissionStatus(status) {
  const m = todayMission();
  if (!m) return;
  LS.set('mission', { date: m.date, exprId: m.exprId, situation: m.situation, status });
  const log = LS.get('mission.log', {});
  log[m.date] = status; LS.set('mission.log', log);
  if (status === 'done') {
    exprSrs.review(m.exprId, 'easy'); // used for real: a big step in the schedule
    deliver(track('mission', { en: m.en, count: Object.values(log).filter((x) => x === 'done').length }));
  }
}
export const missionCards = () => {
  const m = todayMission();
  if (!m || m.status) return { brief: null, check: null };
  const h = new Date().getHours();
  return { brief: h < 15 ? { kind: 'missionBrief', m, text: m.en } : null, check: h >= 15 ? { kind: 'mission', m, text: m.en } : null };
};

// Spoken feedback after a steering-wheel answer (1 = next track, 2 = previous track).
let audioTally = { correct: 0, total: 0 };
player.onAnswer = (card, choice) => {
  if (card.kind === 'mission') {
    const ko = { voiceName: state.settings.voices.korean, lang: 'ko-KR', rate: 1.05 };
    if (choice === 1) { setMissionStatus('done'); return [{ type: 'beep', freq: 1318, label: '🎯 미션 성공!' }, { type: 'speak', text: '멋져요! 실전에서 쓴 표현은 오래 남아요.', ...ko, label: '🎯 미션 성공!' }]; }
    if (choice === 2) { setMissionStatus('missed'); return [{ type: 'speak', text: '괜찮아요. 내일 미션에서 다시 도전해요.', ...ko, label: '내일 다시 도전' }]; }
    return [{ type: 'speak', text: '홈 화면에서 나중에 체크할 수 있어요.', ...ko, label: '홈에서 체크하기' }];
  }
  const q = card.q;
  const ok = choice - 1 === q.answer;
  const ko = { voiceName: state.settings.voices.korean, lang: 'ko-KR', rate: 1.05 };
  const en = { voiceName: state.settings.voices[q.sp === 'THEODORE' ? 'theodore' : 'samantha'], rate: state.settings.rate };
  const firstTwo = player.cards.findIndex((c) => c.kind === 'two');
  if (player.index === firstTwo) audioTally = { correct: 0, total: 0 };
  audioTally.total++; if (ok) audioTally.correct++;
  quizStore.record(q, ok);
  const steps = ok
    ? [{ type: 'beep', freq: 1318, label: '⭕ 정답!' }, { type: 'speak', text: '정답!', ...ko, label: '⭕ 정답!' }]
    : [{ type: 'beep', freq: 300, dur: 260, label: '❌ 아쉬워요' },
      { type: 'speak', text: choice ? `아쉬워요. 정답은 ${q.answer + 1}번.` : `정답은 ${q.answer + 1}번.`, ...ko, label: `정답은 ${q.answer + 1}번` }];
  steps.push({ type: 'speak', text: q.options[q.answer], ...en, label: `✅ ${q.options[q.answer]}` });
  steps.push({ type: 'wait', ms: 500 });
  const lastTwo = player.cards.map((c) => c.kind).lastIndexOf('two');
  if (player.index === lastTwo) {
    steps.push({ type: 'speak', text: `퀴즈 끝! ${audioTally.total}문제 중 ${audioTally.correct}문제 맞혔어요.`, ...ko, label: `🎮 ${audioTally.correct}/${audioTally.total}` });
  }
  return steps;
};

// ---------- favourite lines ("내 명대사") ----------
const favKey = (sceneId, itemIndex) => `${sceneId}:${itemIndex}`;
export const isFav = (sceneId, itemIndex) => !!LS.get('favs', {})[favKey(sceneId, itemIndex)];
export function toggleFav(sceneId, itemIndex) {
  const favs = LS.get('favs', {});
  const k = favKey(sceneId, itemIndex);
  if (favs[k]) delete favs[k]; else favs[k] = { sceneId, itemIndex, added: Date.now() };
  LS.set('favs', favs);
  return !!favs[k];
}
/** Saved favourites resolved to their scene and line, newest first. */
export function favLines() {
  return Object.values(LS.get('favs', {}))
    .map((f) => ({ ...f, scene: sceneById(f.sceneId) }))
    .filter((f) => f.scene && f.scene.items[f.itemIndex]?.t === 'd')
    .map((f) => ({ ...f, item: f.scene.items[f.itemIndex] }))
    .sort((a, b) => b.added - a.added);
}
/** Lines saved as weak by auto-scored shadowing, resolved like favourites. */
export function weakLineList() {
  return Object.values(LS.get('weak', {}))
    .map((f) => ({ ...f, scene: sceneById(f.sceneId) }))
    .filter((f) => f.scene && f.scene.items[f.itemIndex]?.t === 'd')
    .map((f) => ({ ...f, item: f.scene.items[f.itemIndex], added: f.at }))
    .sort((a, b) => a.score - b.score);
}
export const favCard = (f) => ({ kind: 'line', sp: f.item.sp, text: f.item.text, paren: f.item.paren, itemIndex: f.itemIndex, sceneId: f.sceneId, fav: true, lineKey: `${f.sceneId}:${f.itemIndex}` });

export function loadScene(scene, { index = 0, autoplay = false } = {}) {
  player.load({ cards: sceneCards(scene), index, title: sceneTitle(scene), kind: 'scene' });
  player.sceneId = scene.id;
  if (autoplay) player.play();
}

export function loadDrill(list, title) {
  const cards = list.map((e) => ({ kind: 'expr', id: e.id, en: e.en, ko: e.ko, note: e.note, sp: e.source?.sp, source: e.source }));
  player.load({ cards, index: 0, title, kind: 'drill' });
  player.sceneId = null;
}

// ---------- practice sheet: record + compare + pronunciation score ----------
export const relTime = (ts) => {
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) { const h = Math.floor((Date.now() - ts) / 3600000); return h <= 0 ? '방금' : `${h}시간 전`; }
  if (d === 1) return '어제';
  if (d < 7) return `${d}일 전`;
  if (d < 30) return `${Math.floor(d / 7)}주 전`;
  return `${Math.floor(d / 30)}달 전`;
};
export const scoreKey = (k) => 'score:' + k;
export const getScores = () => LS.get('scores', {});

// ---------- Drill Dictionary ----------
export function wordCard(i) {
  return { kind: 'word', id: i.id, text: i.text, pos: i.pos, def: i.def, ko: i.ko, phonetic: i.phonetic, ctx: i.ctx };
}
