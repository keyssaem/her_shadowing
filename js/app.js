import { extractLines, parseScript } from './parser.js';
import { ACTS, CATEGORIES, annotateScenes, linkExpressions } from './content.js';
import { Player } from './player.js';
import { loadVoices, englishVoices, koreanVoices, defaultVoices, speak, cancelSpeech, roleOf } from './tts.js';

// ---------- storage ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem('her.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('her.' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem('her.' + k); } catch { /* ignore */ } },
};

const DEFAULT_SETTINGS = {
  mode: 'shadow', myRole: 'THEODORE', rate: 0.95, repeat: 2, gapFactor: 1.3,
  narration: false, roleReveal: true, drillKoreanFirst: true, loopScene: false, wakeLock: true,
  keyOnly: false, voices: {},
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
player.onCardDone = (card) => {
  if (player.kind === 'scene' && card.sceneId) {
    state.progress = { sceneId: card.sceneId, index: player.index };
    LS.set('progress', state.progress);
  }
};
player.onFinished = () => {
  if (player.kind === 'scene' && player.sceneId) {
    state.done.add(player.sceneId);
    LS.set('done', [...state.done]);
    state.progress = { sceneId: player.sceneId, index: 0 };
    LS.set('progress', state.progress);
  }
};

function sceneCards(scene) {
  const cards = [];
  scene.items.forEach((it, itemIndex) => {
    if (it.t === 'd') cards.push({ kind: 'line', sp: it.sp, text: it.text, paren: it.paren, itemIndex, sceneId: scene.id });
    else if (it.t === 'a' && state.settings.narration) cards.push({ kind: 'action', text: it.text, itemIndex, sceneId: scene.id });
  });
  return cards;
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
    hydrate();
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
      <p class="muted">가지고 있는 <b>Her.pdf</b> 대본을 불러오세요. 대본은 이 기기 안에서만 분석·저장되고 외부로 전송되지 않습니다.</p>
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
    <button class="card primary" id="continue">
      <span class="card-kicker">${p ? '이어서' : '시작'} · ${ACTS[target.act - 1].ko} · p.${target.page}</span>
      <span class="card-title">${esc(sceneTitle(target))}</span>
      <span class="card-sub">${p ? `${startIndex + 1}번째 대사부터 · ` : ''}${modeLabel(state.settings.mode)} 모드로 바로 재생 ▶</span>
    </button>
    <div class="grid2">
      <button class="card" id="drill"><span class="card-kicker">표현 드라이브</span><span class="card-title">랜덤 15개</span><span class="card-sub">한국어 → 영어로 말하기</span></button>
      <a class="card" href="#/scenes"><span class="card-kicker">장면</span><span class="card-title">${keyDone}/${keyScenes.length}</span><span class="card-sub">핵심 장면 완료</span></a>
      <a class="card" href="#/expr"><span class="card-kicker">표현 사전</span><span class="card-title">${state.mastered.size}/${state.expressions.length}</span><span class="card-sub">익힌 표현</span></a>
      <a class="card" href="#/settings"><span class="card-kicker">모드</span><span class="card-title">${modeLabel(state.settings.mode)}</span><span class="card-sub">속도 ${state.settings.rate}× · 반복 ${state.settings.repeat}회</span></a>
    </div>
    <aside class="safety">
      <b>🚗 운전 중 사용 팁</b>
      <ul>
        <li>출발 전에 재생을 시작하고, 주행 중에는 화면을 보지 마세요.</li>
        <li>이어폰·핸들 버튼: <b>재생/정지</b>, <b>다음 곡 = 다음 대사</b>, <b>이전 곡 = 다시 듣기</b>.</li>
        <li>폰을 거치대에 두고 화면을 켜 두면 가장 안정적으로 재생됩니다.</li>
      </ul>
    </aside>`);
  document.getElementById('continue').onclick = () => { loadScene(target, { index: startIndex, autoplay: true }); go('#/scene/' + target.id); };
  document.getElementById('drill').onclick = () => startDrill(shuffle(state.expressions.filter((e) => !state.mastered.has(e.id))).slice(0, 15), '표현 드라이브 · 랜덤 15');
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
function highlight(text, sceneId) {
  let html = esc(text);
  for (const e of state.expressions) {
    if (e.source?.sceneId !== sceneId) continue;
    const needle = esc(e.find || e.en).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(needle, 'i'), (m) => `<mark title="${esc(e.ko)}">${m}</mark>`);
  }
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
        <span class="tx">${highlight(it.text, scene.id)}</span></li>`;
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
    ${exprs.length ? `<details class="exprs"><summary>이 장면의 핵심 표현 ${exprs.length}개</summary>
      <ul>${exprs.map((e) => `<li><b>${esc(e.en)}</b> — ${esc(e.ko)}${e.note ? `<br><small>${esc(e.note)}</small>` : ''}</li>`).join('')}</ul></details>` : ''}
    <main class="content script"><ol class="lines">${items}</ol></main>
    ${bigBar()}`;

  $app.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => {
    s.mode = b.dataset.mode; saveSettings();
    const wasPlaying = player.playing;
    player.pause();
    renderScene(scene);
    if (wasPlaying) player.play();
  });
  const $role = document.getElementById('role');
  if ($role) $role.onchange = () => { s.myRole = $role.value; saveSettings(); };
  $app.querySelectorAll('.lines [data-item]').forEach((li) => li.onclick = () => {
    const idx = player.cards.findIndex((c) => c.itemIndex === +li.dataset.item);
    if (idx >= 0) { player.jump(idx); if (!player.playing) player.play(); }
  });
  bindBigBar();
  updatePlayerUI(true);
}

// ---------- drill ----------
function renderDrill() {
  if (player.kind !== 'drill') return go('#/expr');
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
      <button class="ghost" id="master"></button>
    </main>
    ${bigBar()}`;
  document.getElementById('master').onclick = () => {
    const c = player.current; if (!c) return;
    state.mastered.has(c.id) ? state.mastered.delete(c.id) : state.mastered.add(c.id);
    LS.set('mastered', [...state.mastered]);
    updatePlayerUI(true);
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
          <b>${esc(e.en)}</b>
          <span>${esc(e.ko)}</span>
          ${e.note ? `<small>${esc(e.note)}</small>` : ''}
          ${e.source ? `<a class="src" href="#/scene/${e.source.sceneId}">${esc(e.source.sp)} · p.${e.source.page}</a>` : ''}
        </div>
        <div class="ex-actions">
          <button class="icon-btn" data-say="${e.id}" aria-label="듣기">▶</button>
          <button class="icon-btn ${state.mastered.has(e.id) ? 'on' : ''}" data-master="${e.id}" aria-label="익힘">✓</button>
        </div>
      </li>`).join('')}</ul>`, { back: '#/' });
  document.getElementById('drillAll').onclick = () => {
    const pool = list.filter((e) => !state.mastered.has(e.id));
    startDrill(shuffle(pool.length ? pool : list), (cat || '전체') + ' 드라이브');
  };
  $app.querySelectorAll('[data-say]').forEach((b) => b.onclick = () => {
    const e = state.expressions.find((x) => x.id === b.dataset.say);
    player.pause(); cancelSpeech();
    speak(e.source?.text || e.en, { voiceName: state.settings.voices[roleOf(e.source?.sp)], rate: state.settings.rate });
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
      ${state.script ? `<p class="muted small">불러온 대본: 장면 ${state.script.stats.scenes}개 · 대사 ${state.script.stats.dialogue}줄</p>` : ''}
      <div class="row wrap">
        ${state.script ? '<button class="ghost" id="export">대본 데이터 내보내기 (.json)</button>' : ''}
        <label class="ghost">다시 불러오기<input type="file" id="reimport" accept=".pdf,.json" hidden></label>
        <button class="ghost danger" id="reset">학습 기록 초기화</button>
      </div>
      <p id="status" class="status"></p>
    </section>`, { back: '#/' });

  $app.querySelectorAll('[data-k]').forEach((r) => r.oninput = () => {
    s[r.dataset.k] = +r.value; saveSettings();
    const fmt = { rate: (v) => v + '×', repeat: (v) => v + '회', gapFactor: (v) => '대사 길이 × ' + v }[r.dataset.k];
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
  document.getElementById('export')?.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state.script)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'her-script.json' });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  const $re = document.getElementById('reimport');
  $re.onchange = () => $re.files[0] && importFile($re.files[0], $st);
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
    <a class="mini-info" href="${player.kind === 'drill' ? '#/drill' : '#/scene/' + player.sceneId}">
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
  if (state.view === 'drill' && c) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('dcount', `${player.index + 1} / ${player.cards.length}`);
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
  if ('speechSynthesis' in window) {
    await loadVoices();
    const d = defaultVoices();
    for (const k of Object.keys(d)) if (!state.settings.voices[k] || !englishVoices().concat(koreanVoices()).some((v) => v.name === state.settings.voices[k])) state.settings.voices[k] = d[k];
    saveSettings();
  }
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();
