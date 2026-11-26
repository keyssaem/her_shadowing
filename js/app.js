import { extractLines, parseScript } from './parser.js';
import { ACTS, CATEGORIES, annotateScenes, linkExpressions } from './content.js';
import { Player } from './player.js';
import { loadVoices, englishVoices, koreanVoices, defaultVoices, speak, cancelSpeech, roleOf, estimateSeconds } from './tts.js';
import { lookup, guessPos, myDict, keyOf, boxLabel, makeSrs } from './dict.js';
import { getKo, hasScene, translatedCount, translateScene, getKey, setKey } from './translate.js';
import { track, lineLetter, streak, stats, todayStats, activeDays, calendar, markLettersRead } from './motivate.js';
import {
  canRecord, startRecording, saveRecording, listByKey, listAll, deleteRecording, playBlob, stopPlayback,
  canScore, listen, scoreAgainst, exportRecordings, importRecordings,
} from './recorder.js';
import { chunkLine } from './player.js';

// ---------- storage ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem('her.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('her.' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem('her.' + k); } catch { /* ignore */ } },
};

const DEFAULT_SETTINGS = {
  mode: 'shadow', myRole: 'THEODORE', rate: 0.95, repeat: 2, gapFactor: 1.3,
  narration: false, roleReveal: true, drillKoreanFirst: true, loopScene: false, wakeLock: true,
  keyOnly: false, voices: {}, voiceMotivation: true, dailyGoal: 15, autoSpeed: true, showKo: false,
};

const state = {
  script: LS.get('script', null),
  settings: { ...DEFAULT_SETTINGS, ...LS.get('settings', {}) },
  progress: LS.get('progress', null), // { sceneId, index }
  done: new Set(LS.get('done', [])),
  mastered: new Set(LS.get('mastered', [])),
  expressions: [],
  view: null,
};
const saveSettings = () => LS.set('settings', state.settings);

// Ask the browser not to evict our data (script, progress) under storage pressure,
// so the PDF only ever needs to be imported once per device.
async function ensurePersistent() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}

function hydrate() {
  if (!state.script) return;
  annotateScenes(state.script.scenes);
  state.expressions = linkExpressions(state.script.scenes);
}
hydrate();

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sceneById = (id) => state.script?.scenes.find((s) => s.id === id);
const sceneTitle = (s) => s.ko || s.heading.replace(/^(INT\.|EXT\.)\s*/, '');
const dialogueCount = (s) => s.items.filter((i) => i.t === 'd').length;
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- player ----------
const player = new Player({ getSettings: () => state.settings, onChange: () => updatePlayerUI() });

// ---------- motivation delivery ----------
// Messages show as toasts; during playback they are also spoken between cards
// (Korean then English) so they reach you while driving. Letters open as a card.
function deliver(msgs) {
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
const reviewWord = (id, grade) => {
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
const hardMarked = new Set();
player.onReplay = (card) => {
  if (card?.kind === 'word') { hardMarked.add(card.id); reviewWord(card.id, 'hard'); }
  if (card?.kind === 'expr') { hardMarked.add('x:' + card.id); exprSrs.review(card.id, 'hard'); }
};
player.onCardDone = (card) => {
  if (card.kind === 'word') {
    if (!hardMarked.delete(card.id)) reviewWord(card.id, 'good');
    return;
  }
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
function completeScene(sceneId, nextSceneId = null) {
  const scene = sceneById(sceneId);
  const firstTime = !state.done.has(sceneId);
  const plays = LS.get('plays', {});
  plays[sceneId] = (plays[sceneId] || 0) + 1;
  LS.set('plays', plays);
  if (state.settings.autoSpeed && plays[sceneId] < SPEED_STEPS.length) {
    toast(`다음에 이 장면은 ${SPEED_STEPS[plays[sceneId]]}배로 올려볼게요`, '⏫');
  } else if (state.settings.autoSpeed && plays[sceneId] === SPEED_STEPS.length) {
    toast('원래 속도로 끝까지 따라 했어요!', '🏁');
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

// Auto speed steps: each full play of a scene moves it up 0.8 → 0.9 → 1.0×.
const SPEED_STEPS = [0.8, 0.9, 1.0];
const scenePlays = (sceneId) => LS.get('plays', {})[sceneId] || 0;
const sceneRate = (sceneId) => (state.settings.autoSpeed
  ? SPEED_STEPS[Math.min(scenePlays(sceneId), SPEED_STEPS.length - 1)]
  : state.settings.rate);

// Key expressions get their own spaced-repetition schedule.
const exprSrs = makeSrs('exprsrs');
/** n expressions to practise: due ones first, then new ones; never mastered. */
function pickExpressions(n, list = state.expressions) {
  const open = list.filter((e) => !state.mastered.has(e.id));
  const due = open.filter((e) => exprSrs.isDue(e.id)).sort((a, b) => exprSrs.get(a.id).due - exprSrs.get(b.id).due);
  const fresh = shuffle(open.filter((e) => exprSrs.isNew(e.id)));
  const picked = [...due, ...fresh].slice(0, n);
  if (picked.length < n) picked.push(...shuffle(open.filter((e) => !picked.includes(e))).slice(0, n - picked.length));
  return picked.length ? picked : shuffle(list).slice(0, n);
}

function sceneCards(scene) {
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
function cardSeconds(card) {
  return player.stepsFor(card).reduce((sum, st) => sum + (
    st.type === 'speak' ? estimateSeconds(st.text, st.rate || 1)
      : st.type === 'wait' ? st.ms / 1000 : 0.3), 0);
}
const exprCard = (e) => ({ kind: 'expr', id: e.id, en: e.en, ko: e.ko, note: e.note, sp: e.source?.sp, source: e.source });

function planDrive(minutes) {
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

  push(cue(`오늘의 드라이브 ${minutes}분. ${words.length ? `단어 복습 ${words.length}개, ` : ''}핵심 표현 세 개, 그리고 ${sceneTitle(firstScene)} 장면을 이어서 할게요.`));
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
  return { cards, minutes, est: Math.round(used / 60), words: words.length, scenes: sceneTitles };
}

// ---------- departure screen (#/go) ----------
// Full-screen, two giant buttons: meant to be opened from a home-screen
// shortcut or a "car Bluetooth connected" routine, then one tap to start.
function renderGo() {
  state.view = 'go';
  const p = state.progress && sceneById(state.progress.sceneId);
  const next = p || state.script.scenes.find((s) => s.key && !state.done.has(s.id)) || state.script.scenes[0];
  const due = myDict.due().length;
  const d = todayStats();
  $app.innerHTML = `
    <main class="go">
      <a class="go-home" href="#/" aria-label="홈으로">✕</a>
      <p class="go-kicker">🚗 오늘의 드라이브</p>
      <p class="go-plan">${due ? `단어 ${due}개 → ` : ''}표현 3개 → ${esc(sceneTitle(next))}</p>
      <p class="go-stat">🔥 ${streak()}일 연속 · 오늘 ${Math.floor(d.ms / 60000)}/${state.settings.dailyGoal}분</p>
      <div class="go-btns">
        <button class="go-btn" data-drive="15"><b>15</b><span>분 출발</span></button>
        <button class="go-btn alt" data-drive="30"><b>30</b><span>분 출발</span></button>
      </div>
      <p class="go-tip">출발 후엔 화면 대신 핸들·이어폰 버튼으로 조작하세요</p>
    </main>`;
  $app.querySelectorAll('[data-drive]').forEach((b) => b.onclick = () => startDrive(+b.dataset.drive));
}

function startDrive(minutes) {
  const plan = planDrive(minutes);
  player.load({ cards: plan.cards, index: 0, title: `🚗 오늘의 드라이브 · ${minutes}분`, kind: 'drive' });
  player.sceneId = null;
  player.play();
  go('#/drill');
}

function loadScene(scene, { index = 0, autoplay = false } = {}) {
  player.load({ cards: sceneCards(scene), index, title: sceneTitle(scene), kind: 'scene' });
  player.sceneId = scene.id;
  if (autoplay) player.play();
}

function loadDrill(list, title) {
  const cards = list.map((e) => ({ kind: 'expr', id: e.id, en: e.en, ko: e.ko, note: e.note, sp: e.source?.sp, source: e.source }));
  player.load({ cards, index: 0, title, kind: 'drill' });
  player.sceneId = null;
}

// ---------- routing ----------
function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }
window.addEventListener('hashchange', render);

function render() {
  const h = location.hash.replace(/^#\/?/, '');
  const [route, arg] = h.split('/');
  if (!state.script && route !== 'settings') return renderImport();
  if (route === 'scenes') return renderScenes();
  if (route === 'scene' && sceneById(arg)) return renderScene(sceneById(arg));
  if (route === 'expr') return renderExpressions(arg);
  if (route === 'settings') return renderSettings();
  if (route === 'drill') return renderDrill();
  if (route === 'mydict') return renderMyDict();
  if (route === 'stats') return renderStats();
  if (route === 'go') return renderGo();
  return renderHome();
}

function shell(title, body, { back = '#/', showBar = true } = {}) {
  state.view = null;
  $app.innerHTML = `
    <header class="top">
      ${title ? `<a class="icon-btn" href="${back}" aria-label="뒤로">‹</a>` : '<span class="brand">her<span>·</span>shadowing</span>'}
      <h1>${title ? esc(title) : ''}</h1>
      <a class="icon-btn" href="#/settings" aria-label="설정">⚙</a>
    </header>
    <main class="content">${body}</main>
    ${showBar ? miniBar() : ''}`;
  bindMiniBar();
}

// ---------- import ----------
let pdfjsPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  pdfjsPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = () => { pdfjsPromise = null; reject(new Error('PDF 엔진을 불러오지 못했습니다. 인터넷 연결을 확인하세요.')); };
    document.head.appendChild(s);
  });
  return pdfjsPromise;
}

async function importFile(file, $status) {
  try {
    let script;
    if (/\.json$/i.test(file.name)) {
      script = JSON.parse(await file.text());
      if (!script?.scenes?.length) throw new Error('올바른 대본 데이터가 아닙니다.');
    } else {
      $status.textContent = 'PDF 엔진 불러오는 중…';
      const pdfjsLib = await loadPdfJs();
      const data = new Uint8Array(await file.arrayBuffer());
      const lines = await extractLines(pdfjsLib, data, (p) => { $status.textContent = `페이지 읽는 중… ${Math.round(p * 100)}%`; });
      script = parseScript(lines);
      if (!script.scenes.length) throw new Error('장면을 찾지 못했습니다. 시나리오 형식의 PDF인지 확인하세요.');
    }
    state.script = script;
    LS.set('script', script);
    if (LS.get('script', null) == null) throw new Error('기기에 저장하지 못했습니다. 시크릿 모드가 아닌지 확인하세요.');
    hydrate();
    await ensurePersistent();
    $status.textContent = `완료: 장면 ${script.stats.scenes}개 · 대사 ${script.stats.dialogue}줄`;
    setTimeout(() => go('#/'), 700);
  } catch (e) {
    $status.textContent = '오류: ' + e.message;
  }
}

function renderImport() {
  shell('', `
    <section class="hero">
      <p class="eyebrow">Spike Jonze · <em>Her</em></p>
      <h2>영화 대본으로<br>출퇴근 쉐도잉</h2>
      <p class="muted">가지고 있는 <b>Her.pdf</b> 대본을 <b>딱 한 번</b> 불러오세요. 이 기기 안에서만 분석·저장되고 외부로 전송되지 않으며, 다음부터는 묻지 않습니다.</p>
    </section>
    <label class="drop">
      <input type="file" id="file" accept=".pdf,.json,application/pdf,application/json" hidden>
      <span class="drop-icon">📄</span>
      <span><b>대본 PDF 선택</b><br><small class="muted">또는 내보낸 .json 파일</small></span>
    </label>
    <p id="status" class="status" role="status"></p>`, { showBar: false });
  const $f = document.getElementById('file');
  $f.addEventListener('change', () => $f.files[0] && importFile($f.files[0], document.getElementById('status')));
}

// ---------- home ----------
function renderHome() {
  const p = state.progress && sceneById(state.progress.sceneId);
  const scenes = state.script.scenes;
  const keyScenes = scenes.filter((s) => s.key);
  const keyDone = keyScenes.filter((s) => state.done.has(s.id)).length;
  const firstKey = keyScenes.find((s) => !state.done.has(s.id)) || keyScenes[0];
  const target = p || firstKey;
  const startIndex = p ? state.progress.index : 0;
  shell('', `
    <section class="hero small">
      <p class="eyebrow">오늘도 Theodore와 함께</p>
      <h2>${p ? '이어서 할까요?' : '첫 장면부터 시작해요'}</h2>
    </section>
    <a class="strip" id="homeStrip" href="#/stats"></a>
    <section class="drive-card">
      <span class="card-kicker">🚗 오늘의 드라이브 · 출발 전에 한 번만</span>
      <span class="drive-sub">${myDict.due().length ? `단어 복습 ${myDict.due().length}개 → ` : ''}핵심 표현 3개 → "${esc(sceneTitle(target))}" 이어서</span>
      <div class="drive-btns">
        <button class="drive-btn" data-drive="15"><b>15</b>분</button>
        <button class="drive-btn" data-drive="30"><b>30</b>분</button>
      </div>
    </section>
    <button class="card" id="continue">
      <span class="card-kicker">${p ? '이어서' : '시작'} · ${ACTS[target.act - 1].ko} · p.${target.page}</span>
      <span class="card-title">${esc(sceneTitle(target))}</span>
      <span class="card-sub">${p ? `${startIndex + 1}번째 대사부터 · ` : ''}${modeLabel(state.settings.mode)} 모드로 바로 재생 ▶</span>
    </button>
    <a class="card wide" href="#/mydict">
      <span class="card-kicker">Drill Dictionary · 내 단어장</span>
      <span class="card-title">${myDict.all().length ? `오늘 복습 ${myDict.due().length}개` : '대사 속 단어를 눌러 저장하세요'}</span>
      <span class="card-sub">${myDict.all().length ? `저장 ${myDict.all().length}개 · 영영 뜻 → 대사 속에서 반복` : '영영사전 뜻과 함께 반복 학습'}</span>
    </a>
    <div class="grid2">
      <button class="card" id="drill"><span class="card-kicker">표현 드라이브</span><span class="card-title">랜덤 15개</span><span class="card-sub">한국어 → 영어로 말하기</span></button>
      <a class="card" href="#/scenes"><span class="card-kicker">장면</span><span class="card-title">${keyDone}/${keyScenes.length}</span><span class="card-sub">핵심 장면 완료</span></a>
      <a class="card" href="#/expr"><span class="card-kicker">표현 사전</span><span class="card-title">${state.mastered.size}/${state.expressions.length}</span><span class="card-sub">익힌 표현</span></a>
      <a class="card" href="#/stats"><span class="card-kicker">나의 기록</span><span class="card-title">🔥 ${streak()}일</span><span class="card-sub">연속 학습 · 녹음 ${stats().totals.recs}개</span></a>
    </div>
    <aside class="safety">
      <b>🚗 운전 중 사용 팁</b>
      <ul>
        <li>출발 전에 재생을 시작하고, 주행 중에는 화면을 보지 마세요.</li>
        <li>이어폰·핸들 버튼: <b>재생/정지</b>, <b>다음 곡 = 다음 대사</b>, <b>이전 곡 = 다시 듣기</b>.</li>
        <li>폰을 거치대에 두고 화면을 켜 두면 가장 안정적으로 재생됩니다.</li>
      </ul>
    </aside>`);
  updateHomeStrip();
  $app.querySelectorAll('[data-drive]').forEach((b) => b.onclick = () => startDrive(+b.dataset.drive));
  document.getElementById('continue').onclick = () => { loadScene(target, { index: startIndex, autoplay: true }); go('#/scene/' + target.id); };
  document.getElementById('drill').onclick = () => startDrill(pickExpressions(15), '표현 드라이브 · 복습 우선 15');
}

function updateHomeStrip() {
  const el = document.getElementById('homeStrip');
  if (!el) return;
  const d = todayStats();
  const goal = state.settings.dailyGoal;
  const min = Math.floor(d.ms / 60000);
  const pct = Math.min(100, Math.round((d.ms / (goal * 60000)) * 100));
  const unread = stats().unread || 0;
  el.innerHTML = `
    <span class="streak">🔥 <b>${streak()}</b>일</span>
    <span class="today">오늘 ${min}/${goal}분 · 대사 ${d.lines}줄 · 복습 ${d.reviews}</span>
    ${unread ? `<span class="letter-badge">💌 ${unread}</span>` : ''}
    <span class="goal"><i style="width:${pct}%"></i></span>`;
}

// ---------- stats ----------
async function renderStats() {
  const t = stats().totals;
  // 12-week grass: columns are weeks (Mon→Sun), the last column ends today.
  const dow = (new Date().getDay() + 6) % 7; // Monday = 0
  const cal = calendar(7 * 11 + dow + 1);
  const week = calendar(7);
  const prevWeek = calendar(14).slice(0, 7);
  const sum = (list, f) => list.reduce((n, c) => n + f(c.day), 0);
  const wMin = Math.round(sum(week, (d) => d.ms) / 60000);
  const pwMin = Math.round(sum(prevWeek, (d) => d.ms) / 60000);
  const wLines = sum(week, (d) => d.lines);
  const maxMin = Math.max(1, ...week.map((c) => c.day.ms / 60000));
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  // Act progress (scenes with dialogue).
  const acts = ACTS.map((a) => {
    const list = state.script.scenes.filter((s) => s.act === a.n && dialogueCount(s) > 0);
    const done = list.filter((s) => state.done.has(s.id)).length;
    return { ...a, total: list.length, done, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
  });
  // Drill Dictionary by review interval.
  const words = myDict.all();
  const boxes = [0, 1, 2, 3, 4, 5, 6].map((b) => words.filter((w) => w.box === b).length);
  const maxBox = Math.max(1, ...boxes);
  const dueNow = myDict.due().length;
  const scores = Object.values(getScores());
  const avg = scores.length ? Math.round(scores.reduce((n, s) => n + s.best, 0) / scores.length) : null;
  const letters = stats().letters || [];
  const level = (d) => {
    const v = d.lines + d.reviews + d.recs * 2 + d.ms / 60000;
    return v === 0 ? 0 : v < 10 ? 1 : v < 30 ? 2 : v < 60 ? 3 : 4;
  };
  shell('나의 기록', `
    <section class="stat-hero">
      <div><b>🔥 ${streak()}</b><small>연속 학습일</small></div>
      <div><b>${activeDays()}</b><small>총 학습일</small></div>
      <div><b>${Math.round(t.ms / 60000)}</b><small>총 학습(분)</small></div>
    </section>
    <section class="panel"><h3>최근 12주</h3>
      <div class="grass-wrap">
        <div class="grass-dow"><span>월</span><span></span><span>수</span><span></span><span>금</span><span></span><span>일</span></div>
        <div class="grass">${cal.map((c) => `<i class="lv${level(c.day)}" title="${c.k} · ${Math.round(c.day.ms / 60000)}분 · 대사 ${c.day.lines}줄"></i>`).join('')}</div>
      </div>
      <div class="legend"><small>적음</small><i class="lv0"></i><i class="lv1"></i><i class="lv2"></i><i class="lv3"></i><i class="lv4"></i><small>많음</small></div>
    </section>
    <section class="panel"><h3>최근 7일</h3>
      <p class="week-sum"><b>${wMin}분</b> · 대사 ${wLines}줄
        ${pwMin || wMin ? `<span class="delta ${wMin >= pwMin ? 'up' : 'down'}">지난주보다 ${wMin >= pwMin ? '+' : '−'}${Math.abs(wMin - pwMin)}분</span>` : ''}</p>
      <div class="bars" role="img" aria-label="최근 7일 학습 시간">
        ${week.map((c, i) => {
          const m = Math.round(c.day.ms / 60000);
          const today = i === 6;
          return `<div class="bar-col${today ? ' today' : ''}">
            <span class="bar-val">${m ? m + '분' : ''}</span>
            <span class="bar-track"><i style="height:${(c.day.ms / 60000 / maxMin) * 100}%"></i></span>
            <span class="bar-lines">${c.day.lines ? c.day.lines + '줄' : '·'}</span>
            <span class="bar-day">${today ? '오늘' : DOW[c.date.getDay()]}</span>
          </div>`;
        }).join('')}
      </div>
      <p class="muted tiny">막대: 학습 시간 · 아래 숫자: 따라 말한 대사 · 목표 ${state.settings.dailyGoal}분/일</p>
    </section>
    <section class="panel"><h3>막별 진행률</h3>
      ${acts.map((a) => `
        <div class="act-row">
          <span class="act-name">${esc(a.ko)}</span>
          <span class="act-track"><i style="width:${a.pct}%"></i></span>
          <span class="act-num">${a.done}/${a.total}</span>
        </div>`).join('')}
      <p class="muted tiny">대사가 있는 장면 기준 · 장면을 끝까지 재생하면 완료</p>
    </section>
    <section class="panel"><h3>Drill Dictionary 복습 단계</h3>
      ${words.length ? `
        <p class="week-sum"><b>${words.length}개</b> 저장 · 오늘 복습 ${dueNow}개 · 졸업 ${boxes[6]}개</p>
        ${boxes.map((n, b) => `
          <div class="act-row">
            <span class="act-name">${b === 6 ? '🎓 ' : ''}${boxLabel(b)}</span>
            <span class="act-track box${b}"><i style="width:${(n / maxBox) * 100}%"></i></span>
            <span class="act-num">${n}</span>
          </div>`).join('')}
        <p class="muted tiny">새 단어 → 1일 → 2일 → 4일 → 1주 → 2주 → 1달(졸업). 끝까지 들으면 한 단계 위로, '어려워요'는 처음으로.</p>`
        : '<p class="muted small">대본에서 단어를 눌러 저장하면 여기서 단계별로 보여요.</p>'}
    </section>
    <section class="panel"><h3>누적</h3>
      <div class="stat-grid">
        <div><b>${t.lines}</b><small>따라 말한 대사</small></div>
        <div><b>${state.done.size}</b><small>완료한 장면</small></div>
        <div><b>${t.reviews}</b><small>단어 복습</small></div>
        <div><b>${t.graduated}</b><small>졸업한 단어</small></div>
        <div><b>${t.recs}</b><small>녹음</small></div>
        <div><b>${avg ?? '–'}</b><small>평균 최고점</small></div>
      </div>
    </section>
    <section class="panel"><h3>💌 받은 편지</h3>
      ${letters.length ? `<ul class="letters">${letters.map((l) => `<li><button class="ghost" data-letter="${l.id}">${esc(l.title)} <small class="muted">${new Date(l.date).toLocaleDateString('ko-KR')}</small></button></li>`).join('')}</ul>`
        : '<p class="muted small">막(Act)을 끝내거나 7일 연속, 대사 500줄 같은 큰 고비를 넘으면 편지가 도착해요.</p>'}
    </section>
    <section class="panel"><h3>🎙 내 목소리의 성장</h3><div id="recs"><p class="muted small">불러오는 중…</p></div></section>
    <section class="panel"><h3>설정</h3>
      <label class="field"><span>하루 목표 <b id="v-goal">${state.settings.dailyGoal}분</b></span>
        <input type="range" id="goal" min="5" max="60" step="5" value="${state.settings.dailyGoal}"></label>
      <label class="switch block"><input type="checkbox" id="vm" ${state.settings.voiceMotivation ? 'checked' : ''}><span>재생 중 응원 메시지 음성으로 듣기<small>카드 사이에 짧게 한국어+영어로</small></span></label>
    </section>`, { back: '#/' });

  document.getElementById('goal').oninput = (e) => { state.settings.dailyGoal = +e.target.value; saveSettings(); document.getElementById('v-goal').textContent = e.target.value + '분'; };
  document.getElementById('vm').onchange = (e) => { state.settings.voiceMotivation = e.target.checked; saveSettings(); };
  $app.querySelectorAll('[data-letter]').forEach((b) => b.onclick = () => openLetter(letters.find((l) => l.id === b.dataset.letter)));

  // Recordings grouped by line: first take vs latest take.
  const $recs = document.getElementById('recs');
  let all = [];
  try { all = await listAll(); } catch { /* IndexedDB unavailable */ }
  const groups = new Map();
  for (const r of all) { if (!groups.has(r.key)) groups.set(r.key, []); groups.get(r.key).push(r); }
  if (!groups.size) { $recs.innerHTML = '<p class="muted small">장면 화면에서 대사 옆 🎙을 눌러 녹음해 보세요. 같은 대사를 며칠 뒤 다시 녹음하면 "처음의 나 vs 지금의 나"를 비교할 수 있어요.</p>'; return; }
  const list = [...groups.values()].map((g) => g.sort((a, b) => a.created - b.created)).sort((a, b) => b.at(-1).created - a.at(-1).created).slice(0, 20);
  $recs.innerHTML = `<ul class="rec-groups">${list.map((g, i) => `
    <li>
      <p class="rg-text">“${esc(g[0].text)}” <small class="muted">${esc(g[0].sp)} · p.${g[0].page}</small></p>
      <div class="row wrap">
        <button class="ghost" data-g="${i}" data-m="last">▶ 최근 (${relTime(g.at(-1).created)})</button>
        ${g.length >= 2 ? `<button class="ghost hl" data-g="${i}" data-m="then">${relTime(g[0].created)}의 나 vs ${relTime(g.at(-1).created)}의 나</button>` : ''}
        <a class="ghost" href="#/scene/${g[0].sceneId}">장면</a>
      </div>
    </li>`).join('')}</ul>`;
  $recs.querySelectorAll('[data-g]').forEach((b) => b.onclick = async () => {
    const g = list[+b.dataset.g];
    player.pause(); cancelSpeech(); stopPlayback();
    if (b.dataset.m === 'last') return playBlob(g.at(-1).blob);
    toast(`${relTime(g[0].created)}의 나 → ${relTime(g.at(-1).created)}의 나`);
    await playBlob(g[0].blob);
    await new Promise((r) => setTimeout(r, 500));
    await playBlob(g.at(-1).blob);
  });
}

function startDrill(list, title) {
  if (!list.length) list = shuffle(state.expressions).slice(0, 15);
  loadDrill(list, title);
  player.play();
  go('#/drill');
}

const modeLabel = (m) => ({ listen: '듣기', shadow: '쉐도잉', role: '롤플레이' }[m]);

// ---------- scene list ----------
function renderScenes() {
  const keyOnly = state.settings.keyOnly;
  const body = ACTS.map((act) => {
    const list = state.script.scenes.filter((s) => s.act === act.n && (!keyOnly || s.key) && dialogueCount(s) > 0);
    if (!list.length) return '';
    return `<section class="act"><h3>${act.ko} <small>${act.en}</small></h3>
      ${list.map((s) => `
        <a class="scene-row ${state.done.has(s.id) ? 'done' : ''}" href="#/scene/${s.id}">
          <span class="pg">p.${s.page}</span>
          <span class="scene-name">${s.key ? '<i class="star">★</i>' : ''}${esc(sceneTitle(s))}
            ${s.ko ? `<small>${esc(s.heading)}</small>` : ''}</span>
          <span class="count">${dialogueCount(s)}줄${state.done.has(s.id) ? ' ✓' : ''}</span>
        </a>`).join('')}
    </section>`;
  }).join('');
  shell('장면', `
    <div class="toolbar">
      <label class="switch"><input type="checkbox" id="keyOnly" ${keyOnly ? 'checked' : ''}><span>★ 핵심 장면만</span></label>
    </div>${body}`);
  document.getElementById('keyOnly').onchange = (e) => { state.settings.keyOnly = e.target.checked; saveSettings(); renderScenes(); };
}

// ---------- scene player ----------
const TOKEN = /[A-Za-z0-9]+(?:'[A-Za-z]+)*|[^A-Za-z0-9]+/g;
const isWord = (t) => /^[A-Za-z0-9]/.test(t);

/** Tokenize a line into words (with char offsets). */
function wordsOf(text) {
  const out = [];
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) if (isWord(m[0])) out.push({ w: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

/** Expression spans of this scene that occur in the text. */
function markRanges(text, sceneId) {
  const lower = text.toLowerCase();
  const ranges = [];
  for (const e of state.expressions) {
    if (e.source?.sceneId !== sceneId) continue;
    const needle = (e.find || e.en).toLowerCase();
    const at = lower.indexOf(needle);
    if (at >= 0) ranges.push({ start: at, end: at + needle.length, id: e.id });
  }
  return ranges;
}

/** Line HTML: every word is a tappable span; curated expressions are highlighted. */
function renderLine(text, sceneId) {
  const ranges = markRanges(text, sceneId);
  const saved = myDict.all().map((i) => i.id);
  let html = '', open = null, wi = 0, m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    const tok = m[0], start = m.index;
    const r = ranges.find((x) => start >= x.start && start < x.end);
    const markId = r && (isWord(tok) || start + tok.length <= r.end) ? r.id : null;
    if (open && open !== markId) { html += '</mark>'; open = null; }
    if (markId && !open) { html += `<mark data-e="${markId}">`; open = markId; }
    if (isWord(tok)) {
      const sv = saved.includes(keyOf(tok)) ? ' saved' : '';
      html += `<span class="w${sv}" data-w="${wi++}">${esc(tok)}</span>`;
    } else html += esc(tok);
  }
  if (open) html += '</mark>';
  return html;
}

function renderScene(scene) {
  if (player.sceneId !== scene.id) {
    const resume = state.progress?.sceneId === scene.id ? state.progress.index : 0;
    loadScene(scene, { index: resume });
  }
  const speakers = [...new Set(scene.items.filter((i) => i.t === 'd').map((i) => i.sp))];
  const s = state.settings;
  if (s.mode === 'role' && !speakers.includes(s.myRole)) { s.myRole = speakers.includes('THEODORE') ? 'THEODORE' : speakers[0]; saveSettings(); }
  const exprs = state.expressions.filter((e) => e.source?.sceneId === scene.id);

  const items = scene.items.map((it, i) => {
    if (it.t === 'd') {
      return `<li class="line role-${roleOf(it.sp)}${it.text.length > 160 ? ' long' : ''}" data-item="${i}">
        <span class="sp">${esc(it.sp)}${it.paren ? ` <em>(${esc(it.paren)})</em>` : ''}</span>
        <span class="tx">${renderLine(it.text, scene.id)}</span>
        ${s.showKo && getKo(scene.id, i) ? `<span class="ko">${esc(getKo(scene.id, i))}</span>` : ''}
        <button class="mic" data-practice aria-label="말하기 연습">🎙</button></li>`;
    }
    if (it.t === 'a') return `<li class="action" data-item="${i}">${esc(it.text)}</li>`;
    return `<li class="transition">${esc(it.text)}</li>`;
  }).join('');

  state.view = 'scene';
  $app.innerHTML = `
    <header class="top">
      <a class="icon-btn" href="#/scenes" aria-label="뒤로">‹</a>
      <h1>${esc(sceneTitle(scene))}<small>${ACTS[scene.act - 1].ko} · p.${scene.page}</small></h1>
      <a class="icon-btn" href="#/settings" aria-label="설정">⚙</a>
    </header>
    <div class="modes" role="tablist">
      ${['listen', 'shadow', 'role'].map((m) => `<button class="chip ${s.mode === m ? 'on' : ''}" data-mode="${m}">${modeLabel(m)}</button>`).join('')}
      ${s.mode === 'role' ? `<select id="role" class="chip-select" aria-label="내 배역">${speakers.map((sp) => `<option ${sp === s.myRole ? 'selected' : ''}>${esc(sp)}</option>`).join('')}</select>` : ''}
    </div>
    <div class="modes sub">
      <span class="chip ghosty" title="장면을 끝까지 할 때마다 0.8 → 0.9 → 1.0배">${s.autoSpeed ? `⏩ ${sceneRate(scene.id)}× · ${scenePlays(scene.id) + 1}회차` : `⏩ ${s.rate}×`}</span>
      <button class="chip ${s.showKo && hasScene(scene.id) ? 'on' : ''}" id="koBtn">${hasScene(scene.id) ? (s.showKo ? '🇰🇷 해석 숨기기' : '🇰🇷 해석 보기') : '🇰🇷 이 장면 해석하기'}</button>
    </div>
    ${exprs.length ? `<details class="exprs"><summary>이 장면의 핵심 표현 ${exprs.length}개</summary>
      <ul>${exprs.map((e) => `<li><b>${esc(e.en)}</b> — ${esc(e.ko)}${e.note ? `<br><small>${esc(e.note)}</small>` : ''}</li>`).join('')}</ul></details>` : ''}
    <main class="content script"><ol class="lines">${items}</ol></main>
    ${bigBar()}`;

  document.getElementById('koBtn').onclick = async (ev) => {
    if (hasScene(scene.id)) { s.showKo = !s.showKo; saveSettings(); return renderScene(scene); }
    if (!getKey()) { toast('설정 › 한국어 해석에서 API 키를 먼저 넣어주세요.'); return go('#/settings'); }
    const btn = ev.currentTarget;
    btn.disabled = true; btn.textContent = '🇰🇷 해석 중…';
    try {
      await translateScene(scene.id, sceneTitle(scene), scene.items.map((it, i) => ({ ...it, itemIndex: i })).filter((it) => it.t === 'd'));
      s.showKo = true; saveSettings();
      renderScene(scene);
    } catch (e) {
      btn.disabled = false; btn.textContent = '🇰🇷 이 장면 해석하기';
      toast(e.message);
    }
  };
  $app.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => {
    s.mode = b.dataset.mode; saveSettings();
    const wasPlaying = player.playing;
    player.pause();
    renderScene(scene);
    if (wasPlaying) player.play();
  });
  const $role = document.getElementById('role');
  if ($role) $role.onchange = () => { s.myRole = $role.value; saveSettings(); };
  $app.querySelectorAll('.lines [data-item]').forEach((li) => li.onclick = (ev) => {
    if (ev.target.closest('[data-practice]')) return openPracticeSheet(scene, +li.dataset.item);
    const w = ev.target.closest('.w');
    if (w && li.classList.contains('line')) {
      openWordSheet(scene, +li.dataset.item, +w.dataset.w, ev.target.closest('mark')?.dataset.e);
      return;
    }
    playFromItem(+li.dataset.item);
  });
  bindBigBar();
  updatePlayerUI(true);
}

function playFromItem(itemIndex) {
  const idx = player.cards.findIndex((c) => c.itemIndex === itemIndex);
  if (idx >= 0) { player.jump(idx); if (!player.playing) player.play(); }
}

// ---------- word sheet (English-English dictionary) ----------
let sheetSeq = 0;
function closeSheet() {
  document.getElementById('sheet-root')?.remove();
}

function openWordSheet(scene, itemIndex, wordIndex, exprId) {
  closeSheet();
  const item = scene.items[itemIndex];
  const words = wordsOf(item.text);
  const expr = exprId && state.expressions.find((e) => e.id === exprId);
  let a = wordIndex, b = wordIndex;
  let exprSpan = null; // [first, last] word index of the tapped curated expression
  if (expr) {
    const r = markRanges(item.text, scene.id).find((x) => x.id === exprId);
    if (r) {
      const inR = words.map((w, i) => (w.start >= r.start && w.start < r.end ? i : -1)).filter((i) => i >= 0);
      if (inR.length) exprSpan = [inR[0], inR[inR.length - 1]];
    }
  }
  const root = document.createElement('div');
  root.id = 'sheet-root';
  document.body.appendChild(root);
  let result = null; // lookup result for current selection
  let chosen = null; // { pos, d, ex }

  const phrase = () => item.text.slice(words[a].start, words[b].end);
  const curated = () => {
    const k = keyOf(phrase());
    const exact = state.expressions.find((e) => keyOf(e.find || e.en) === k);
    if (exact) return exact;
    // Only treat the selection as the curated expression when it covers it.
    return exprSpan && a <= exprSpan[0] && b >= exprSpan[1] ? expr : null;
  };
  const onExpr = () => exprSpan && a === exprSpan[0] && b === exprSpan[1];

  function draw(loading = false, error = '') {
    const p = phrase();
    const saved = myDict.has(p);
    const cur = curated();
    let defs = '';
    if (loading) defs = '<p class="muted">사전 찾는 중…</p>';
    else if (error) defs = `<p class="muted">${esc(error)}</p>`;
    else if (!result) {
      defs = `<p class="muted">영영사전에 "${esc(p)}" 항목이 없어요.${a !== b ? ' 표현 그대로 문맥과 함께 저장할 수 있고, 단어 하나를 눌러 뜻을 볼 수도 있어요.' : ''}</p>`;
    } else {
      defs = `<p class="hw"><b>${esc(result.headword)}</b> <span class="muted">${esc(result.phonetic)}</span></p>` +
        result.meanings.slice(0, 4).map((m) => `
          <div class="pos"><i>${esc(m.pos)}</i>
            <ol>${m.defs.slice(0, 3).map((d, i) => {
              const on = chosen && chosen.pos === m.pos && chosen.d === d.d;
              return `<li class="def ${on ? 'on' : ''}" data-pos="${esc(m.pos)}" data-i="${i}">${esc(d.d)}${d.ex ? `<br><small>“${esc(d.ex)}”</small>` : ''}</li>`;
            }).join('')}</ol></div>`).join('') +
        '<p class="muted tiny">뜻을 누르면 그 뜻으로 저장돼요.</p>';
    }
    root.innerHTML = `
      <div class="sheet-backdrop" data-x="close"></div>
      <section class="sheet" role="dialog" aria-label="영영사전">
        <div class="sheet-handle"></div>
        <div class="sel-row">
          <button class="icon-btn" data-x="left" ${a === 0 ? 'disabled' : ''} aria-label="앞 단어 포함">＋◀</button>
          <b class="sel">${esc(p)}</b>
          <button class="icon-btn" data-x="right" ${b === words.length - 1 ? 'disabled' : ''} aria-label="뒤 단어 포함">▶＋</button>
        </div>
        <div class="sel-tools">
          <button class="chip" data-x="say">🔊 발음</button>
          ${a !== b ? '<button class="chip" data-x="single">한 단어로</button>' : ''}
          ${exprSpan && !onExpr() ? '<button class="chip on" data-x="expr">★ 핵심 표현 전체</button>' : ''}
        </div>
        ${cur ? `<div class="curated"><b>핵심 표현</b> ${esc(cur.ko)}${cur.note ? `<br><small>${esc(cur.note)}</small>` : ''}</div>`
          : expr ? `<div class="curated"><b>이 단어가 속한 핵심 표현</b> ${esc(expr.en)} — ${esc(expr.ko)}</div>` : ''}
        <div class="defs">${defs}</div>
        <p class="ctx">“${esc(item.text)}” <span class="muted">— ${esc(item.sp)} · p.${item.page}</span></p>
        <div class="sheet-actions">
          <button class="card primary slim" data-x="add">${saved ? '✓ Drill Dictionary에 있음 (업데이트)' : '＋ Drill Dictionary에 추가'}</button>
          <button class="ghost" data-x="play">▶ 이 대사부터 재생</button>
        </div>
        <p class="muted tiny">Definitions: Wiktionary (CC BY-SA) via dictionaryapi.dev</p>
      </section>`;
  }

  async function refresh() {
    const seq = ++sheetSeq;
    result = null; chosen = null;
    draw(true);
    try {
      const r = await lookup(phrase());
      if (seq !== sheetSeq) return;
      result = r;
      if (r) {
        const pos = guessPos(a > 0 ? words[a - 1].w : '', r.meanings);
        const m = r.meanings.find((x) => x.pos === pos) || r.meanings[0];
        chosen = m && m.defs[0] ? { pos: m.pos, d: m.defs[0].d, ex: m.defs[0].ex } : null;
      }
      draw();
    } catch (e) {
      if (seq === sheetSeq) draw(false, '사전을 불러오지 못했어요: ' + e.message);
    }
  }

  root.addEventListener('click', (ev) => {
    const def = ev.target.closest('.def');
    if (def && result) {
      const m = result.meanings.find((x) => x.pos === def.dataset.pos);
      const d = m.defs[+def.dataset.i];
      chosen = { pos: m.pos, d: d.d, ex: d.ex };
      draw();
      return;
    }
    const x = ev.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    if (x === 'close') closeSheet();
    if (x === 'left' && a > 0) { a--; refresh(); }
    if (x === 'right' && b < words.length - 1) { b++; refresh(); }
    if (x === 'single') { a = b = wordIndex; refresh(); }
    if (x === 'expr' && exprSpan) { [a, b] = exprSpan; refresh(); }
    if (x === 'say') { player.pause(); cancelSpeech(); speak(phrase(), { voiceName: state.settings.voices.samantha, rate: state.settings.rate }); }
    if (x === 'play') { closeSheet(); playFromItem(itemIndex); }
    if (x === 'add') {
      const cur = curated();
      const isNew = !myDict.has(phrase());
      myDict.add({
        text: phrase(),
        headword: result?.headword || '',
        phonetic: result?.phonetic || '',
        pos: chosen?.pos || '',
        def: chosen?.d || '',
        ex: chosen?.ex || '',
        ko: cur?.ko || '',
        ctx: { sp: item.sp, text: item.text, sceneId: scene.id, itemIndex, page: item.page },
      });
      draw();
      toast(`"${phrase()}" 저장 · 오늘 복습 ${myDict.due().length}개`);
      if (isNew) deliver(track('saved', { count: myDict.all().length }));
      // refresh saved underline in the script
      $app.querySelectorAll(`.lines [data-item="${itemIndex}"] .tx`).forEach((el) => { el.innerHTML = renderLine(item.text, scene.id); });
    }
  });
  refresh();
}

// Toasts queue up so several messages in a row are all readable.
const toastQueue = [];
let toastBusy = false;
function toast(msg, icon = '') {
  toastQueue.push(icon ? `${icon} ${msg}` : msg);
  if (!toastBusy) nextToast();
}
function nextToast() {
  const msg = toastQueue.shift();
  if (!msg) { toastBusy = false; return; }
  toastBusy = true;
  document.getElementById('toast')?.remove();
  const t = Object.assign(document.createElement('div'), { id: 'toast', className: 'toast', textContent: msg });
  document.body.appendChild(t);
  setTimeout(() => { t.remove(); nextToast(); }, 2600);
}

// ---------- letters ----------
function openLetter(letter) {
  if (!letter) return;
  markLettersRead();
  closeSheet();
  const root = document.createElement('div');
  root.id = 'sheet-root';
  document.body.appendChild(root);
  root.innerHTML = `
    <div class="sheet-backdrop" data-x="close"></div>
    <section class="sheet letter" role="dialog" aria-label="편지">
      <div class="sheet-handle"></div>
      <p class="eyebrow">💌 Letters From Your Commute · ${new Date(letter.date).toLocaleDateString('ko-KR')}</p>
      <h3>${esc(letter.title)}</h3>
      <div class="paper">${esc(letter.en).replace(/\n/g, '<br>')}</div>
      <p class="muted small">${esc(letter.ko)}</p>
      <div class="sheet-actions">
        <button class="card primary slim" data-x="read">▶ 읽어주기</button>
        <button class="ghost" data-x="close">닫기</button>
      </div>
    </section>`;
  root.addEventListener('click', (ev) => {
    const x = ev.target.closest('[data-x]')?.dataset.x;
    if (x === 'close') { cancelSpeech(); closeSheet(); updateHomeStrip(); }
    if (x === 'read') { player.pause(); cancelSpeech(); speak(letter.en.replace(/\n+/g, ' '), { voiceName: state.settings.voices.theodore, rate: state.settings.rate * 0.95 }); }
  });
}

// ---------- practice sheet: record + compare + pronunciation score ----------
const relTime = (ts) => {
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) { const h = Math.floor((Date.now() - ts) / 3600000); return h <= 0 ? '방금' : `${h}시간 전`; }
  if (d === 1) return '어제';
  if (d < 7) return `${d}일 전`;
  if (d < 30) return `${Math.floor(d / 7)}주 전`;
  return `${Math.floor(d / 30)}달 전`;
};
const scoreKey = (k) => 'score:' + k;
const getScores = () => LS.get('scores', {});

function openPracticeSheet(scene, itemIndex) {
  player.pause();
  closeSheet();
  const item = scene.items[itemIndex];
  const chunks = chunkLine(item.text);
  let ci = 0;
  let recorder = null, recTimer = null, listener = null;
  let busy = ''; // '' | 'rec' | 'listen' | 'compare'
  let result = null; // last score result for current chunk
  let history = [];
  const root = document.createElement('div');
  root.id = 'sheet-root';
  document.body.appendChild(root);
  const key = () => `${scene.id}:${itemIndex}:${ci}`;
  const text = () => chunks[ci];
  const sayOriginal = () => speak(text(), { voiceName: state.settings.voices[roleOf(item.sp)], rate: state.settings.rate });

  async function loadHistory() { try { history = await listByKey(key()); } catch { history = []; } }

  function draw(note = '') {
    const sc = getScores()[scoreKey(key())];
    const target = result
      ? result.words.map((w) => `<span class="${w.ok ? 'ok' : 'miss'}">${esc(w.text)}</span>`).join(' ')
      : esc(text());
    const first = history[0], last = history[history.length - 1];
    root.innerHTML = `
      <div class="sheet-backdrop" data-x="close"></div>
      <section class="sheet practice" role="dialog" aria-label="말하기 연습">
        <div class="sheet-handle"></div>
        <p class="muted tiny">${esc(item.sp)} · p.${item.page}${sc ? ` · 최고 ${sc.best}점` : ''}</p>
        ${chunks.length > 1 ? `<div class="modes wrap">${chunks.map((_, i) => `<button class="chip ${i === ci ? 'on' : ''}" data-chunk="${i}">${i + 1}/${chunks.length}</button>`).join('')}</div>` : ''}
        <p class="target">${target}</p>
        ${result ? `<div class="score-box"><b class="score ${result.score >= 90 ? 'hi' : result.score >= 70 ? 'mid' : 'lo'}">${result.score}</b>
          <span><small>들린 문장</small><br>“${esc(result.heard)}”</span></div>
          ${result.words.some((w) => !w.ok) ? `<button class="ghost hl block" data-x="missed" ${busy ? 'disabled' : ''}>＋ 놓친 단어 ${new Set(result.words.filter((w) => !w.ok).map((w) => keyOf(w.text))).size}개 → Drill Dictionary</button>` : ''}` : ''}
        ${note ? `<p class="status">${esc(note)}</p>` : ''}
        <div class="pr-row">
          <button class="pr-btn" data-x="orig" ${busy ? 'disabled' : ''}>▶<small>원문</small></button>
          <button class="pr-btn rec ${busy === 'rec' ? 'on' : ''}" data-x="rec" ${!canRecord() || (busy && busy !== 'rec') ? 'disabled' : ''}>${busy === 'rec' ? '■' : '🎙'}<small>${busy === 'rec' ? '<span id="rect">0초</span> 정지' : '녹음'}</small></button>
          <button class="pr-btn ${busy === 'listen' ? 'on' : ''}" data-x="score" ${!canScore() || (busy && busy !== 'listen') ? 'disabled' : ''}>${busy === 'listen' ? '■' : '🗣'}<small>${busy === 'listen' ? '듣는 중…' : '발음 채점'}</small></button>
        </div>
        ${!canScore() ? '<p class="muted tiny">이 브라우저는 음성 인식을 지원하지 않아요. Android Chrome에서 사용하세요.</p>' : ''}
        <h4>내 목소리 ${history.length ? `(${history.length})` : ''}</h4>
        ${history.length ? `
          <div class="row wrap">
            <button class="ghost" data-x="ab" ${busy ? 'disabled' : ''}>원문 ↔ 최근 내 목소리</button>
            ${history.length >= 2 ? `<button class="ghost hl" data-x="then" ${busy ? 'disabled' : ''}>${relTime(first.created)}의 나 vs ${relTime(last.created)}의 나</button>` : ''}
          </div>
          <ul class="rec-list">${history.slice().reverse().map((r) => `
            <li><button class="icon-btn" data-play="${r.id}" aria-label="재생">▶</button>
              <span>${relTime(r.created)} <small class="muted">${new Date(r.created).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${(r.dur / 1000).toFixed(1)}초</small></span>
              <button class="icon-btn" data-del="${r.id}" aria-label="삭제">✕</button></li>`).join('')}</ul>`
          : '<p class="muted small">녹음해 두면 원문과 번갈아 듣고, 나중에 "처음의 나"와 비교할 수 있어요. 첫 녹음은 계속 보관돼요.</p>'}
        <p class="muted tiny">녹음은 이 기기에만 저장됩니다. 발음 채점은 브라우저 음성 인식이 알아들은 단어를 기준으로 해요.</p>
      </section>`;
  }

  async function stopRec() {
    if (!recorder) return;
    clearInterval(recTimer);
    const { blob, mime, dur } = await recorder.stop();
    recorder = null; busy = '';
    if (dur < 400) return draw('너무 짧아요. 다시 녹음해 보세요.');
    await saveRecording({ key: key(), text: text(), sp: item.sp, sceneId: scene.id, itemIndex, page: item.page, blob, mime, dur, created: Date.now() });
    deliver(track('rec'));
    await loadHistory();
    draw('저장했어요. 원문 → 내 목소리로 들려줄게요.');
    busy = 'compare'; draw('원문 → 내 목소리');
    await sayOriginal();
    await playBlob(blob);
    busy = ''; draw();
  }

  async function compareAB(a, b, label) {
    busy = 'compare';
    draw(label);
    await sayOriginal();
    if (a) { draw(`${label} · ${relTime(a.created)}`); await playBlob(a.blob); }
    if (b) { draw(`${label} · ${relTime(b.created)}`); await playBlob(b.blob); }
    busy = ''; draw();
  }

  root.addEventListener('click', async (ev) => {
    const chunkBtn = ev.target.closest('[data-chunk]');
    if (chunkBtn && !busy) { ci = +chunkBtn.dataset.chunk; result = null; await loadHistory(); return draw(); }
    const playId = ev.target.closest('[data-play]')?.dataset.play;
    if (playId && !busy) { const r = history.find((h) => h.id === +playId); if (r) playBlob(r.blob); return; }
    const delId = ev.target.closest('[data-del]')?.dataset.del;
    if (delId && !busy) { if (confirm('이 녹음을 지울까요?')) { await deleteRecording(+delId); await loadHistory(); draw(); } return; }
    const x = ev.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    if (x === 'close') {
      if (recorder) { clearInterval(recTimer); await recorder.stop().catch(() => {}); recorder = null; }
      listener?.stop(); stopPlayback(); cancelSpeech(); closeSheet(); return;
    }
    if (x === 'orig' && !busy) { cancelSpeech(); sayOriginal(); }
    if (x === 'missed' && !busy && result) {
      // Save each missed word with its English definition and this line as context.
      const missed = [...new Map(result.words.filter((w) => !w.ok).map((w) => [keyOf(w.text), w.text])).values()];
      busy = 'save'; draw(`놓친 단어 ${missed.length}개 저장 중…`);
      let added = 0;
      for (const w of missed) {
        let r = null;
        try { r = await lookup(w); } catch { /* offline: save without definition */ }
        const m = r && (r.meanings.find((x) => x.pos === guessPos('', r.meanings)) || r.meanings[0]);
        const isNew = !myDict.has(w);
        myDict.add({
          text: w, headword: r?.headword || '', phonetic: r?.phonetic || '',
          pos: m?.pos || '', def: m?.defs[0]?.d || '', ex: m?.defs[0]?.ex || '', ko: '',
          ctx: { sp: item.sp, text: item.text, sceneId: scene.id, itemIndex, page: item.page },
        });
        if (isNew) added++;
      }
      busy = '';
      draw(`${missed.length}개를 Drill Dictionary에 넣었어요${added < missed.length ? ` (새 단어 ${added}개)` : ''}. 운전 중 복습에 나와요.`);
      if (added) deliver(track('saved', { count: myDict.all().length }));
      $app.querySelectorAll(`.lines [data-item="${itemIndex}"] .tx`).forEach((el) => { el.innerHTML = renderLine(item.text, scene.id); });
      return;
    }
    if (x === 'rec') {
      if (busy === 'rec') return stopRec();
      if (busy) return;
      cancelSpeech(); stopPlayback();
      try {
        recorder = await startRecording();
        busy = 'rec'; draw('말해보세요. 다 하면 ■ 정지');
        const t0 = Date.now();
        recTimer = setInterval(() => { const el = document.getElementById('rect'); if (el) el.textContent = Math.floor((Date.now() - t0) / 1000) + '초'; }, 300);
      } catch (e) { busy = ''; draw('마이크를 쓸 수 없어요: ' + (e.message || e.name)); }
    }
    if (x === 'score') {
      if (busy === 'listen') { listener?.stop(); return; }
      if (busy) return;
      cancelSpeech(); stopPlayback();
      busy = 'listen'; result = null; draw('문장을 말해보세요…');
      try {
        listener = listen((interim) => { const s = root.querySelector('.status'); if (s) s.textContent = '🗣 ' + interim; });
        const alts = await listener.result;
        result = scoreAgainst(text(), alts);
        const all = getScores();
        const k = scoreKey(key());
        const prev = all[k]?.best;
        all[k] = { best: Math.max(prev ?? 0, result.score), last: result.score, n: (all[k]?.n || 0) + 1, at: Date.now() };
        LS.set('scores', all);
        busy = '';
        const missed = result.words.filter((w) => !w.ok).length;
        draw(result.score === 100 ? '완벽해요!' : `놓친 단어 ${missed}개 (빨간색). 원문을 듣고 다시 해보세요.`);
        deliver(track('score', { score: result.score, prev }));
      } catch (e) { busy = ''; draw(e.message); }
      listener = null;
    }
    if (x === 'ab' && !busy && history.length) compareAB(null, history[history.length - 1], '원문 → 최근 내 목소리');
    if (x === 'then' && !busy && history.length >= 2) compareAB(history[0], history[history.length - 1], '처음의 나 → 최근의 나');
  });

  loadHistory().then(() => draw());
  draw();
}

// ---------- Drill Dictionary ----------
function wordCard(i) {
  return { kind: 'word', id: i.id, text: i.text, pos: i.pos, def: i.def, ko: i.ko, phonetic: i.phonetic, ctx: i.ctx };
}

function startWordDrill(list, title) {
  if (!list.length) return toast('복습할 단어가 없어요.');
  player.load({ cards: list.map(wordCard), index: 0, title, kind: 'drill' });
  player.sceneId = null;
  player.play();
  go('#/drill');
}

function renderMyDict() {
  const all = myDict.all();
  const due = myDict.due();
  shell('Drill Dictionary', `
    <p class="muted small">대본에서 단어나 표현을 누르면 영영 뜻을 보고 여기에 저장할 수 있어요. 운전 중에는 <b>끝까지 들으면 '복습 완료'</b>, <b>이전 곡 버튼을 누르면 '어려움'</b>으로 기록돼 다시 나옵니다.</p>
    <div class="grid2">
      <button class="card primary" id="dueBtn"><span class="card-kicker">오늘 복습</span><span class="card-title">${due.length}개</span><span class="card-sub">▶ 드라이브 시작</span></button>
      <button class="card" id="allBtn"><span class="card-kicker">전체 반복</span><span class="card-title">${all.length}개</span><span class="card-sub">▶ 랜덤 순서</span></button>
    </div>
    ${all.length ? '' : '<p class="muted empty">아직 저장한 단어가 없어요. 장면을 열고 대사 속 단어를 눌러보세요.</p>'}
    <ul class="expr-list">${all.map((i) => `
      <li>
        <div class="ex-main">
          <b>${esc(i.text)} <span class="box">${boxLabel(i.box)}${i.due <= Date.now() ? ' · 복습' : ''}</span></b>
          ${i.def ? `<span class="en-def"><i>${esc(i.pos)}</i> ${esc(i.def)}</span>` : ''}
          ${i.ko ? `<span>${esc(i.ko)}</span>` : ''}
          ${i.ctx ? `<a class="src" href="#/scene/${i.ctx.sceneId}">“${esc(i.ctx.text.slice(0, 90))}${i.ctx.text.length > 90 ? '…' : ''}” — ${esc(i.ctx.sp)} · p.${i.ctx.page}</a>` : ''}
        </div>
        <div class="ex-actions">
          <button class="icon-btn" data-say="${esc(i.id)}" aria-label="듣기">▶</button>
          <button class="icon-btn" data-del="${esc(i.id)}" aria-label="삭제">✕</button>
        </div>
      </li>`).join('')}</ul>`, { back: '#/' });
  document.getElementById('dueBtn').onclick = () => startWordDrill(due, 'Drill Dictionary · 오늘 복습');
  document.getElementById('allBtn').onclick = () => startWordDrill(shuffle(all), 'Drill Dictionary · 전체');
  $app.querySelectorAll('[data-say]').forEach((b) => b.onclick = () => {
    const i = all.find((x) => x.id === b.dataset.say);
    player.pause(); cancelSpeech();
    speak(i.text + '. ' + (i.def || ''), { voiceName: state.settings.voices.samantha, rate: state.settings.rate });
  });
  $app.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
    if (!confirm('이 단어를 Drill Dictionary에서 뺄까요?')) return;
    myDict.remove(b.dataset.del);
    renderMyDict();
  });
}

// ---------- drill ----------
function renderDrill() {
  if (player.kind !== 'drill' && player.kind !== 'drive') return go('#/expr');
  state.view = 'drill';
  $app.innerHTML = `
    <header class="top">
      <a class="icon-btn" href="#/expr" aria-label="뒤로">‹</a>
      <h1>${esc(player.title)}</h1>
      <a class="icon-btn" href="#/settings" aria-label="설정">⚙</a>
    </header>
    <main class="content drill">
      <p class="drill-count" id="dcount"></p>
      <p class="drill-ko" id="dko"></p>
      <p class="drill-en" id="den"></p>
      <p class="drill-note" id="dnote"></p>
      <p class="drill-src" id="dsrc"></p>
      <div class="row center">
        <button class="ghost" id="hard" hidden>어려워요 ↺</button>
        <button class="ghost" id="master"></button>
      </div>
    </main>
    ${bigBar()}`;
  document.getElementById('master').onclick = () => {
    const c = player.current; if (!c) return;
    if (c.kind === 'word') {
      hardMarked.delete(c.id);
      reviewWord(c.id, 'easy');
      hardMarked.add(c.id); // already graded; skip auto-grade at card end
      toast(`"${c.text}" — 다음 복습: ${boxLabel(myDict.get(c.text)?.box)} 뒤`);
      player.next();
      return;
    }
    if (c.kind === 'expr') {
      // "익혔어요" = mastered (out of drills) + a long jump in the review schedule.
      const on = !state.mastered.has(c.id);
      on ? state.mastered.add(c.id) : state.mastered.delete(c.id);
      LS.set('mastered', [...state.mastered]);
      if (on) { exprSrs.review(c.id, 'easy'); hardMarked.add('x:' + c.id); }
      updatePlayerUI(true);
      return;
    }
  };
  document.getElementById('hard').onclick = () => {
    const c = player.current;
    if (c?.kind === 'word') {
      reviewWord(c.id, 'hard');
      hardMarked.add(c.id);
      toast(`"${c.text}" — 오늘 다시 나와요`);
    } else if (c?.kind === 'expr') {
      exprSrs.review(c.id, 'hard');
      hardMarked.add('x:' + c.id);
      toast(`"${c.en}" — 오늘 다시 나와요`);
    } else return;
    player.next();
  };
  bindBigBar();
  updatePlayerUI(true);
}

// ---------- expressions ----------
function renderExpressions(catArg) {
  const cat = catArg != null && catArg !== '' ? CATEGORIES[+catArg] : null;
  const list = state.expressions.filter((e) => !cat || e.cat === cat);
  const chips = `<div class="modes wrap">
    <a class="chip ${!cat ? 'on' : ''}" href="#/expr">전체</a>
    ${CATEGORIES.map((c, i) => `<a class="chip ${cat === c ? 'on' : ''}" href="#/expr/${i}">${esc(c)}</a>`).join('')}</div>`;
  shell('표현 사전', `${chips}
    <button class="card primary slim" id="drillAll">▶ ${cat ? esc(cat) : '전체'} 드라이브 (${list.filter((e) => !state.mastered.has(e.id)).length || list.length}개)</button>
    <ul class="expr-list">${list.map((e) => `
      <li class="${state.mastered.has(e.id) ? 'mastered' : ''}">
        <div class="ex-main">
          <b>${esc(e.en)} <span class="box">${exprSrs.isNew(e.id) ? '' : boxLabel(exprSrs.get(e.id).box) + (exprSrs.isDue(e.id) ? ' · 복습' : '')}</span></b>
          <span>${esc(e.ko)}</span>
          ${e.note ? `<small>${esc(e.note)}</small>` : ''}
          ${e.source ? `<a class="src" href="#/scene/${e.source.sceneId}">${esc(e.source.sp)} · p.${e.source.page}</a>` : ''}
        </div>
        <div class="ex-actions">
          <button class="icon-btn" data-say="${e.id}" aria-label="듣기">▶</button>
          <button class="icon-btn ${myDict.has(e.en) ? 'on' : ''}" data-add="${e.id}" aria-label="Drill Dictionary에 추가">＋</button>
          <button class="icon-btn ${state.mastered.has(e.id) ? 'on' : ''}" data-master="${e.id}" aria-label="익힘">✓</button>
        </div>
      </li>`).join('')}</ul>`, { back: '#/' });
  document.getElementById('drillAll').onclick = () => {
    startDrill(pickExpressions(list.length, list), (cat || '전체') + ' 드라이브');
  };
  $app.querySelectorAll('[data-say]').forEach((b) => b.onclick = () => {
    const e = state.expressions.find((x) => x.id === b.dataset.say);
    player.pause(); cancelSpeech();
    speak(e.source?.text || e.en, { voiceName: state.settings.voices[roleOf(e.source?.sp)], rate: state.settings.rate });
  });
  $app.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => {
    const e = state.expressions.find((x) => x.id === b.dataset.add);
    const sc = e.source && sceneById(e.source.sceneId);
    myDict.add({
      text: e.en, pos: '', def: e.note || '', ko: e.ko,
      ctx: e.source ? { sp: e.source.sp, text: e.source.text, sceneId: e.source.sceneId, itemIndex: e.source.index, page: sc?.page ?? e.source.page } : null,
    });
    b.classList.add('on');
    toast(`"${e.en}" Drill Dictionary에 저장`);
    deliver(track('saved', { count: myDict.all().length }));
  });
  $app.querySelectorAll('[data-master]').forEach((b) => b.onclick = () => {
    const id = b.dataset.master;
    state.mastered.has(id) ? state.mastered.delete(id) : state.mastered.add(id);
    LS.set('mastered', [...state.mastered]);
    renderExpressions(catArg);
  });
}

// ---------- settings ----------
function renderSettings() {
  const s = state.settings;
  const en = englishVoices(), ko = koreanVoices();
  const voiceSel = (slot, label, list) => `
    <label class="field"><span>${label}</span>
      <span class="row"><select data-voice="${slot}">${list.map((v) => `<option value="${esc(v.name)}" ${s.voices[slot] === v.name ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('') || '<option>음성 없음</option>'}</select>
      <button class="icon-btn" data-test="${slot}" aria-label="미리 듣기">▶</button></span></label>`;
  const range = (k, label, min, max, step, fmt = (v) => v) => `
    <label class="field"><span>${label} <b id="v-${k}">${fmt(s[k])}</b></span>
      <input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${s[k]}"></label>`;
  const toggle = (k, label, hint = '') => `
    <label class="switch block"><input type="checkbox" data-t="${k}" ${s[k] ? 'checked' : ''}><span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;

  shell('설정', `
    <section class="panel"><h3>재생</h3>
      ${range('rate', '말하기 속도', 0.6, 1.3, 0.05, (v) => v + '×')}
      ${range('repeat', '쉐도잉 반복 횟수', 1, 4, 1, (v) => v + '회')}
      ${range('gapFactor', '따라 말할 시간', 0.8, 2.5, 0.1, (v) => '대사 길이 × ' + v)}
      ${toggle('narration', '지문(장면 묘사)도 읽기', '듣기 연습용. 쉐도잉 간격 없이 읽음')}
      ${toggle('roleReveal', '롤플레이: 내 차례 뒤 정답 들려주기')}
      ${toggle('drillKoreanFirst', '표현 드라이브: 한국어 뜻 먼저', '끄면 영어만 반복')}
      ${toggle('loopScene', '장면 끝나면 처음부터 반복')}
      ${toggle('wakeLock', '재생 중 화면 켜두기')}
      ${toggle('voiceMotivation', '응원 메시지 음성으로 듣기', '재생 중 카드 사이에 짧게 한국어+영어로')}
      ${range('dailyGoal', '하루 목표', 5, 60, 5, (v) => v + '분')}
      ${toggle('autoSpeed', '장면 속도 자동 단계', '장면을 끝까지 할 때마다 0.8 → 0.9 → 1.0배. 켜면 장면 대사에는 위 "말하기 속도" 대신 적용')}
    </section>
    <section class="panel"><h3>한국어 해석 (Claude API)</h3>
      <p class="muted small">대사를 Claude로 번역해 이 기기에만 저장합니다. 본인의 Anthropic API 키가 필요하고(console.anthropic.com), 키는 이 기기에만 저장되며 번역할 대사와 함께 Anthropic API로만 전송됩니다. 대본 전체 해석 비용은 대략 1~2달러로 예상됩니다.</p>
      <label class="field"><span>API 키</span>
        <span class="row"><input type="password" id="apikey" class="text-in" placeholder="sk-ant-..." value="${esc(getKey())}" autocomplete="off">
        <button class="ghost" id="saveKey">저장</button></span></label>
      ${toggle('showKo', '장면에서 해석 보기', '드라이브 화면에도 대사 아래 표시')}
      <p class="muted small">해석된 장면: <b id="koCount">${translatedCount()}</b> / ${state.script ? state.script.scenes.filter((x) => dialogueCount(x) > 0).length : 0}</p>
      <div class="row wrap"><button class="ghost" id="koAll">남은 장면 모두 해석하기</button></div>
      <p id="koStatus" class="status"></p>
    </section>
    <section class="panel"><h3>학습 데이터 백업</h3>
      <p class="muted small">진도·Drill Dictionary·점수·연속 학습일·편지·해석·녹음을 파일 하나로 저장합니다. 폰을 바꾸거나 크롬 데이터를 지우기 전에 받아두세요. API 키는 백업에 넣지 않습니다.</p>
      <label class="switch block"><input type="checkbox" id="bkScript" checked><span>대본 데이터도 포함<small>끄면 복원 후 PDF를 다시 불러와야 해요</small></span></label>
      <div class="row wrap">
        <button class="ghost" id="backup">⬇ 백업 파일 만들기</button>
        <label class="ghost">⬆ 백업에서 복원<input type="file" id="restore" accept=".json,application/json" hidden></label>
      </div>
      <p id="bkStatus" class="status"></p>
    </section>
    <section class="panel"><h3>목소리</h3>
      ${voiceSel('theodore', 'Theodore', en)}
      ${voiceSel('samantha', 'Samantha', en)}
      ${voiceSel('female', '다른 여성 인물', en)}
      ${voiceSel('male', '다른 남성 인물', en)}
      ${voiceSel('narrator', '지문 · TEXT VOICE', en)}
      ${voiceSel('korean', '한국어 뜻', ko)}
      <p class="muted small">기기에 설치된 음성을 씁니다. Android는 'Google 텍스트 음성 변환', iPhone은 설정 › 손쉬운 사용 › 음성 콘텐츠 › 음성에서 고품질(향상된) 영어 음성을 받으면 훨씬 자연스러워집니다.</p>
    </section>
    <section class="panel"><h3>데이터</h3>
      ${state.script ? `<p class="muted small">불러온 대본: 장면 ${state.script.stats.scenes}개 · 대사 ${state.script.stats.dialogue}줄</p>
      <p class="muted small" id="persist">저장 상태 확인 중…</p>` : ''}
      <div class="row wrap">
        ${state.script ? '<button class="ghost" id="export">대본 데이터 내보내기 (.json)</button>' : ''}
        <label class="ghost">다시 불러오기<input type="file" id="reimport" accept=".pdf,.json" hidden></label>
        <button class="ghost danger" id="reset">학습 기록 초기화</button>
      </div>
      <p id="status" class="status"></p>
    </section>`, { back: '#/' });

  $app.querySelectorAll('[data-k]').forEach((r) => r.oninput = () => {
    s[r.dataset.k] = +r.value; saveSettings();
    const fmt = { rate: (v) => v + '×', repeat: (v) => v + '회', gapFactor: (v) => '대사 길이 × ' + v, dailyGoal: (v) => v + '분' }[r.dataset.k];
    document.getElementById('v-' + r.dataset.k).textContent = fmt(+r.value);
  });
  $app.querySelectorAll('[data-t]').forEach((c) => c.onchange = () => {
    s[c.dataset.t] = c.checked; saveSettings();
    if (c.dataset.t === 'narration' && player.kind === 'scene' && player.sceneId) loadScene(sceneById(player.sceneId), { index: 0 });
  });
  $app.querySelectorAll('[data-voice]').forEach((sel) => sel.onchange = () => { s.voices[sel.dataset.voice] = sel.value; saveSettings(); });
  const SAMPLES = { theodore: "Hey, how's it going?", samantha: "Hello, I'm here.", female: "That sounds about right.", male: 'Good to see you, Theodore.', narrator: 'Email from Amy.', korean: '솔직하게 말해두고 싶어.' };
  $app.querySelectorAll('[data-test]').forEach((b) => b.onclick = () => {
    player.pause(); cancelSpeech();
    const slot = b.dataset.test;
    speak(SAMPLES[slot], { voiceName: s.voices[slot], rate: s.rate, lang: slot === 'korean' ? 'ko-KR' : 'en-US' });
  });
  const $st = document.getElementById('status');
  const $persist = document.getElementById('persist');
  if ($persist) ensurePersistent().then((ok) => {
    $persist.textContent = ok ? '🔒 영구 저장 켜짐 — 브라우저가 대본을 자동으로 지우지 않습니다.'
      : ok === false ? '⚠ 영구 저장이 허용되지 않았습니다. 홈 화면에 앱을 추가하면 대부분 허용됩니다.'
      : '이 브라우저는 영구 저장 상태를 알려주지 않습니다.';
  });
  document.getElementById('export')?.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state.script)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'her-script.json' });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  const $re = document.getElementById('reimport');
  $re.onchange = () => $re.files[0] && importFile($re.files[0], $st);

  // Korean translation
  document.getElementById('saveKey').onclick = () => {
    setKey(document.getElementById('apikey').value);
    toast(getKey() ? 'API 키를 저장했어요 (이 기기에만)' : 'API 키를 지웠어요');
  };
  document.getElementById('koAll').onclick = async (ev) => {
    if (!getKey()) return toast('API 키를 먼저 저장하세요.');
    const btn = ev.currentTarget;
    const $ks = document.getElementById('koStatus');
    const todo = state.script.scenes.filter((x) => dialogueCount(x) > 0 && !hasScene(x.id));
    if (!todo.length) { $ks.textContent = '모든 장면이 이미 해석돼 있어요.'; return; }
    if (!confirm(`${todo.length}개 장면을 해석할까요? API 사용 요금이 청구됩니다.`)) return;
    btn.disabled = true;
    let done = 0;
    for (const sc of todo) {
      $ks.textContent = `해석 중… ${done}/${todo.length} · ${sceneTitle(sc)}`;
      try {
        await translateScene(sc.id, sceneTitle(sc), sc.items.map((it, i) => ({ ...it, itemIndex: i })).filter((it) => it.t === 'd'));
        done++;
        const c = document.getElementById('koCount'); if (c) c.textContent = translatedCount();
      } catch (e) {
        $ks.textContent = `멈춤 (${done}/${todo.length}): ${e.message}`;
        btn.disabled = false;
        return;
      }
    }
    btn.disabled = false;
    $ks.textContent = `완료: ${done}개 장면을 해석했어요.`;
    if (!s.showKo) { s.showKo = true; saveSettings(); const t = $app.querySelector('[data-t="showKo"]'); if (t) t.checked = true; }
  };

  // Backup / restore of everything the app keeps on this device
  const $bk = document.getElementById('bkStatus');
  document.getElementById('backup').onclick = async () => {
    $bk.textContent = '백업 만드는 중…';
    const withScript = document.getElementById('bkScript').checked;
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k.startsWith('her.') || k === 'her.apikey' || k === 'her.dictcache' || (!withScript && k === 'her.script')) continue;
      data[k] = localStorage.getItem(k);
    }
    let recordings = [];
    try { recordings = await exportRecordings(); } catch { /* no recordings store */ }
    const backup = { app: 'her-shadowing', version: 1, exportedAt: new Date().toISOString(), localStorage: data, recordings };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `her-shadowing-backup-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    $bk.textContent = `백업 완료: 녹음 ${recordings.length}개 포함. 파일을 Google Drive 등에 보관하세요.`;
  };
  const $rs = document.getElementById('restore');
  $rs.onchange = async () => {
    const f = $rs.files[0]; if (!f) return;
    try {
      const b = JSON.parse(await f.text());
      if (b?.app !== 'her-shadowing' || !b.localStorage) throw new Error('이 앱의 백업 파일이 아니에요.');
      if (!confirm(`${new Date(b.exportedAt).toLocaleString('ko-KR')} 백업으로 복원할까요? 지금 기기의 학습 기록과 녹음은 백업 내용으로 바뀝니다.`)) return;
      $bk.textContent = '복원 중…';
      const keep = new Set(['her.apikey', 'her.dictcache', ...(b.localStorage['her.script'] ? [] : ['her.script'])]);
      Object.keys(localStorage).filter((k) => k.startsWith('her.') && !keep.has(k)).forEach((k) => localStorage.removeItem(k));
      Object.entries(b.localStorage).forEach(([k, v]) => localStorage.setItem(k, v));
      await importRecordings(b.recordings || []);
      $bk.textContent = '복원 완료. 앱을 다시 불러옵니다…';
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      $bk.textContent = '복원 실패: ' + e.message;
    }
  };
  document.getElementById('reset').onclick = () => {
    if (!confirm('진도·완료 장면·익힌 표현 기록을 지울까요? (대본은 유지)')) return;
    state.done.clear(); state.mastered.clear(); state.progress = null;
    ['done', 'mastered', 'progress'].forEach(LS.del);
    $st.textContent = '학습 기록을 초기화했습니다.';
  };
}

// ---------- player bars ----------
function miniBar() {
  if (!player.cards.length) return '';
  return `<div class="mini" id="mini">
    <a class="mini-info" href="${player.kind === 'scene' ? '#/scene/' + player.sceneId : '#/drill'}">
      <small>${esc(player.title)}</small><span id="miniText"></span></a>
    <button class="icon-btn big" id="miniPlay" aria-label="재생/정지"></button></div>`;
}
function bindMiniBar() {
  const b = document.getElementById('miniPlay');
  if (b) b.onclick = () => player.toggle();
  updatePlayerUI();
}
function bigBar() {
  return `<div class="bar">
    <p class="bar-chunk" id="chunk" hidden></p>
    <p class="bar-status" id="status" aria-live="polite"></p>
    <div class="bar-controls">
      <button class="ctl" id="prev" aria-label="이전 대사">⏮</button>
      <button class="ctl" id="replay" aria-label="다시 듣기">↺</button>
      <button class="ctl play" id="play" aria-label="재생/정지"></button>
      <button class="ctl" id="next" aria-label="다음 대사">⏭</button>
      <span class="ctl pos" id="pos"></span>
    </div></div>`;
}
function bindBigBar() {
  document.getElementById('prev').onclick = () => player.prev();
  document.getElementById('next').onclick = () => player.next();
  document.getElementById('replay').onclick = () => player.replay();
  document.getElementById('play').onclick = () => player.toggle();
}

let lastActive = -1;
function updatePlayerUI(force = false) {
  const playIcon = player.playing ? '❚❚' : '▶';
  const $play = document.getElementById('play'); if ($play) $play.textContent = playIcon;
  const $mp = document.getElementById('miniPlay'); if ($mp) $mp.textContent = playIcon;
  const c = player.current;
  const $mt = document.getElementById('miniText');
  if ($mt && c) $mt.textContent = c.kind === 'expr' ? c.en : (c.sp ? c.sp + ': ' : '') + c.text;
  const $status = document.getElementById('status');
  if ($status && state.view) $status.textContent = player.status || (player.playing ? '' : '정지됨 · ▶ 눌러 재생');
  const $pos = document.getElementById('pos'); if ($pos) $pos.textContent = player.cards.length ? `${player.index + 1}/${player.cards.length}` : '';
  const $chunk = document.getElementById('chunk');
  if ($chunk) { $chunk.hidden = !player.chunk || !player.playing; $chunk.textContent = player.chunk || ''; }

  if (state.view === 'scene' && c) {
    if (force || lastActive !== c.itemIndex) {
      $app.querySelectorAll('.lines .active').forEach((el) => el.classList.remove('active'));
      const li = $app.querySelector(`.lines [data-item="${c.itemIndex}"]`);
      if (li) { li.classList.add('active'); li.scrollIntoView({ block: 'center', behavior: force ? 'auto' : 'smooth' }); }
      lastActive = c.itemIndex;
    }
    const li = $app.querySelector('.lines .active');
    if (li) li.classList.toggle('my-turn', /내 차례/.test(player.status));
  }
  if (state.view === 'drill' && c && (c.kind === 'line' || c.kind === 'cue' || c.kind === 'action')) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const sc = c.sceneId && sceneById(c.sceneId);
    set('dcount', `${player.index + 1} / ${player.cards.length}`);
    set('dko', c.kind === 'line' ? c.sp + (c.paren ? ` (${c.paren})` : '') : c.kind === 'cue' ? '🚗' : '지문');
    set('den', c.kind === 'cue' ? c.ko : c.text);
    set('dnote', sc ? `${sceneTitle(sc)} · p.${sc.page}${c.rate && c.kind === 'line' ? ` · ${c.rate}×` : ''}` : '');
    set('dsrc', c.kind === 'line' && state.settings.showKo ? getKo(c.sceneId, c.itemIndex) || '' : '');
    const den = document.getElementById('den'); if (den) den.classList.toggle('line-text', c.kind !== 'cue');
    const m = document.getElementById('master'); if (m) m.hidden = true;
    const h = document.getElementById('hard'); if (h) h.hidden = true;
    return;
  }
  { const m = document.getElementById('master'); if (m) m.hidden = false; const den = document.getElementById('den'); if (den) den.classList.remove('line-text'); }
  if (state.view === 'drill' && c && c.kind === 'word') {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('dcount', `${player.index + 1} / ${player.cards.length} · ${boxLabel(myDict.get(c.text)?.box)}`);
    set('dko', c.def ? `${c.pos ? '(' + c.pos + ') ' : ''}${c.def}` : '');
    set('den', c.text);
    set('dnote', [c.phonetic, c.ko].filter(Boolean).join(' · '));
    set('dsrc', c.ctx ? `${c.ctx.sp} · p.${c.ctx.page} — “${c.ctx.text}”` : '');
    const m = document.getElementById('master'); if (m) { m.textContent = '쉬워요 ✓'; m.classList.remove('on'); }
    const h = document.getElementById('hard'); if (h) h.hidden = false;
    return;
  }
  if (state.view === 'drill' && c) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const h = document.getElementById('hard'); if (h) h.hidden = c.kind !== 'expr';
    const srs = c.kind === 'expr' && exprSrs.get(c.id);
    set('dcount', `${player.index + 1} / ${player.cards.length}${c.kind === 'expr' ? ' · ' + (srs ? boxLabel(srs.box) : '새 표현') : ''}`);
    set('dko', c.ko);
    const reveal = !state.settings.drillKoreanFirst || !/한국어|영어로/.test(player.status) || !player.playing;
    set('den', reveal ? c.en : '· · ·');
    set('dnote', c.note || '');
    set('dsrc', c.source ? `${c.source.sp} · p.${c.source.page} — “${c.source.text}”` : '');
    const m = document.getElementById('master');
    if (m) { const on = state.mastered.has(c.id); m.textContent = on ? '✓ 익힌 표현 (취소)' : '익혔어요 ✓'; m.classList.toggle('on', on); }
  }
}

// ---------- boot ----------
async function boot() {
  // Draw first so the app never opens on a blank screen; voices arrive later.
  render();
  if ('speechSynthesis' in window) {
    await loadVoices();
    const d = defaultVoices();
    for (const k of Object.keys(d)) if (!state.settings.voices[k] || !englishVoices().concat(koreanVoices()).some((v) => v.name === state.settings.voices[k])) state.settings.voices[k] = d[k];
    saveSettings();
    if (location.hash.startsWith('#/settings')) render(); // refresh the voice pickers
  }
  if (state.script) { ensurePersistent(); deliver(track('open')); }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();
