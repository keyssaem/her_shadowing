import { extractLines, parseScript } from './parser.js';
import { ACTS } from './content.js';
import { cancelSpeech } from './tts.js';
import { myDict, boxLabel } from './dict.js';
import { track, streak, stats, todayStats, activeDays, calendar } from './motivate.js';
import { listAll, playBlob, stopPlayback, listen } from './recorder.js';
import { LS, state, saveSettings, ensurePersistent, hydrate, $app, esc, sceneById, sceneTitle, dialogueCount, shuffle, player, pickExpressions, planDrive, loadScene, loadDrill, relTime, getScores, favLines } from './core.js';
import { go, shell, toast, openLetter } from './ui.js';

// ---------- departure screen (#/go) ----------
// Full-screen, two giant buttons: meant to be opened from a home-screen
// shortcut or a "car Bluetooth connected" routine, then one tap to start.
export function renderGo() {
  state.view = 'go';
  const p = state.progress && sceneById(state.progress.sceneId);
  const next = p || state.script.scenes.find((s) => s.key && !state.done.has(s.id)) || state.script.scenes[0];
  const due = myDict.due().length;
  const d = todayStats();
  $app.innerHTML = `
    <main class="go">
      <a class="go-home" href="#/" aria-label="홈으로">✕</a>
      <p class="go-kicker">🚗 출발</p>
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

export function startDrive(minutes) {
  const plan = planDrive(minutes);
  player.load({ cards: plan.cards, index: 0, title: `🚗 출발 · ${minutes}분 코스`, kind: 'drive' });
  player.sceneId = null;
  player.play();
  go('#/drill');
}

// ---------- import ----------
export let pdfjsPromise = null;
export function loadPdfJs() {
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

export async function importFile(file, $status) {
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

export function renderImport() {
  shell('', `
    <section class="hero">
      <p class="eyebrow">Spike Jonze · <em>Her</em></p>
      <h2>영화 대본으로<br>출퇴근 따라 말하기</h2>
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
export function renderHome() {
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
      <span class="card-kicker">🚗 출발 · 버튼 한 번이면 끝까지 자동 재생</span>
      <span class="drive-sub">${myDict.due().length ? `단어 복습 ${myDict.due().length}개 → ` : ''}핵심 표현 3개 → "${esc(sceneTitle(target))}" 이어서${favLines().length ? ' → 명대사' : ''}</span>
      <div class="drive-btns">
        <button class="drive-btn" data-drive="15"><b>15</b>분 출발</button>
        <button class="drive-btn" data-drive="30"><b>30</b>분 출발</button>
      </div>
    </section>
    <p class="sec-title">따로 하고 싶을 때</p>
    <div class="grid2">
      <button class="card" id="continue">
        <span class="card-kicker">📖 대본 이어 보기</span>
        <span class="card-title small">${esc(sceneTitle(target))}</span>
        <span class="card-sub">${p ? `${startIndex + 1}번째 대사부터` : '처음부터'} · ${modeLabel(state.settings.mode)}</span>
      </button>
      <button class="card" id="drill">
        <span class="card-kicker">🔁 표현 복습</span>
        <span class="card-title small">핵심 표현 15개</span>
        <span class="card-sub">한국어 듣고 → 영어로 말하기</span>
      </button>
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
  document.getElementById('drill').onclick = () => startDrill(pickExpressions(15), '🔁 표현 복습 · 15개');
}

export function updateHomeStrip() {
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
export async function renderStats() {
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
    <section class="panel"><h3>내 단어장 복습 단계</h3>
      ${words.length ? `
        <p class="week-sum"><b>${words.length}개</b> 저장 · 오늘 복습 ${dueNow}개 · 졸업 ${boxes[6]}개</p>
        ${boxes.map((n, b) => `
          <div class="act-row">
            <span class="act-name">${b === 6 ? '🎓 ' : ''}${boxLabel(b)}</span>
            <span class="act-track box${b}"><i style="width:${(n / maxBox) * 100}%"></i></span>
            <span class="act-num">${n}</span>
          </div>`).join('')}
        <p class="muted tiny">새 단어 → 1일 → 2일 → 4일 → 1주 → 2주 → 1달(졸업). 끝까지 들으면 한 단계 위로, '다시 볼래요'는 처음으로.</p>`
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

export function startDrill(list, title) {
  if (!list.length) list = shuffle(state.expressions).slice(0, 15);
  loadDrill(list, title);
  player.play();
  go('#/drill');
}

export const modeLabel = (m) => ({ listen: '듣기', shadow: '따라 말하기', role: '역할 연기' }[m]);
