// 🎮 Quiz tab: daily 10, six games, survival (3 hearts), wrong-answer retry,
// and a hands-free audio quiz answered with the media / steering-wheel buttons.
import { speak, cancelSpeech, roleOf, speakable } from './tts.js';
import { track } from './motivate.js';
import {
  wordPool, lineCandidates, nextPairs, makeCloze, makeMatch, makeTwoChoice, makeListen, makeOrder, makeNext,
  orderCorrect, starsFor,
} from './quiz.js';
import { state, $app, esc, sceneById, sceneTitle, shuffle, player, deliver, pickExpressions, quizStore, audioQuizCards } from './core.js';
import { shell, toast, go } from './ui.js';

const GAMES = {
  daily: { icon: '⭐', title: '오늘의 퀴즈', sub: '10문제 · 골고루 섞어서' },
  cloze: { icon: '✏️', title: '빈칸 채우기', sub: '대사 속 빠진 단어 고르기' },
  match: { icon: '🔗', title: '짝 맞추기', sub: '한국어 ↔ 영어 5쌍' },
  listen: { icon: '👂', title: '듣고 고르기', sub: 'gonna·going to 같은 소리 구별' },
  order: { icon: '🧩', title: '순서 맞추기', sub: '섞인 단어로 문장 만들기' },
  next: { icon: '💬', title: '다음 대사는?', sub: '대화 흐름 맞히기' },
  survival: { icon: '❤️', title: '서바이벌', sub: '하트 3개 · 틀릴 때까지' },
  wrong: { icon: '📕', title: '오답 다시 풀기', sub: '틀린 문제만' },
};
const SPEAKER_KO = { THEODORE: 'Theodore', SAMANTHA: 'Samantha', AMY: 'Amy', CATHERINE: 'Catherine', PAUL: 'Paul', CHARLES: 'Charles' };
const spName = (s) => SPEAKER_KO[s] || (s ? s[0] + s.slice(1).toLowerCase() : '');

let pool = null, lines = null, pairs = null;
const ensurePools = () => {
  pool ||= wordPool(state.script.scenes);
  lines ||= lineCandidates(state.script.scenes);
  pairs ||= nextPairs(state.script.scenes);
};

// ---------- question sets ----------
function clozeSet(n) {
  const out = [];
  for (const e of pickExpressions(n * 3)) {
    if (out.length >= n) break;
    const q = e.source && makeCloze(e, pool);
    if (q) out.push(q);
  }
  return out;
}
const fromLines = (n, make) => {
  const out = [];
  for (const c of shuffle(lines)) { if (out.length >= n) break; const q = make(c); if (q) out.push(q); }
  return out;
};
const listenSet = (n) => fromLines(n, (c) => makeListen(c));
const orderSet = (n) => fromLines(n, (c) => makeOrder(c));
const nextSet = (n) => {
  const out = [];
  for (const p of shuffle(pairs)) { if (out.length >= n) break; const q = makeNext(p, lines); if (q) out.push(q); }
  return out;
};
const matchSet = () => [makeMatch(pickExpressions(5))].filter(Boolean);
const wrongSet = () => shuffle(Object.values(quizStore.wrong()).map((w) => w.q).filter((q) => q.type !== 'who')).slice(0, 10);

/** One random question of any single-answer type (used by survival). */
function anyQuestion() {
  const makers = [() => clozeSet(1), () => listenSet(1), () => orderSet(1), () => nextSet(1)];
  for (let k = 0; k < 6; k++) { const q = makers[Math.floor(Math.random() * makers.length)]()[0]; if (q) return q; }
  return clozeSet(1)[0];
}

function buildRound(mode) {
  ensurePools();
  if (mode === 'cloze') return clozeSet(10);
  if (mode === 'listen') return listenSet(10);
  if (mode === 'order') return orderSet(10);
  if (mode === 'next') return nextSet(10);
  if (mode === 'match') return [...matchSet(), ...matchSet(), ...matchSet()];
  if (mode === 'wrong') return wrongSet();
  if (mode === 'survival') return [anyQuestion()];
  const mix = shuffle([...clozeSet(3), ...listenSet(3), ...orderSet(1), ...nextSet(2)]);
  mix.splice(7, 0, ...matchSet());
  return mix.slice(0, 10);
}

// ---------- session ----------
let S = null; // { mode, items, i, correct, combo, maxCombo, picked, hearts, order }

export function renderQuiz(arg) {
  if (arg === 'play' && S) return renderQuestion();
  if (arg === 'result' && S) return renderResult();
  renderQuizHome();
}

function startRound(mode) {
  const items = buildRound(mode);
  if (!items.length || !items[0]) return toast(mode === 'wrong' ? '오답이 없어요. 잘하고 있어요!' : '문제를 만들 수 없어요.');
  S = { mode, items, i: 0, correct: 0, combo: 0, maxCombo: 0, picked: null, hearts: mode === 'survival' ? 3 : null };
  go('#/quiz/play');
}

// ---------- home ----------
function renderQuizHome() {
  const best = quizStore.best();
  const wrongN = Object.keys(quizStore.wrong()).length;
  const st = quizStore.stats();
  const stars = (m) => (best[m] ? '★'.repeat(best[m].stars) + '☆'.repeat(3 - best[m].stars) : '');
  const card = (m) => `
    <button class="game" data-mode="${m}">
      <span class="g-icon">${GAMES[m].icon}</span><b>${GAMES[m].title}</b><small>${GAMES[m].sub}</small>
      ${best[m] ? `<span class="g-best">${stars(m)}</span>` : ''}
    </button>`;
  shell('퀴즈', `
    <button class="quiz-hero" data-mode="daily">
      <span class="qh-icon">⭐</span>
      <span class="qh-body"><b>오늘의 퀴즈 10문제</b><small>다섯 가지 게임을 골고루 섞어서${best.daily ? ` · 최고 ${stars('daily')}` : ''}</small></span>
      <span class="qh-go">시작 ›</span>
    </button>
    <button class="quiz-hero alt survival" data-mode="survival">
      <span class="qh-icon">❤️</span>
      <span class="qh-body"><b>서바이벌</b><small>하트 3개, 틀리면 하나씩 · 최고 ${best.survival ? best.survival.correct + '문제' : '기록 없음'}</small></span>
      <span class="qh-go">도전 ›</span>
    </button>
    <p class="sec-title">게임 골라 하기</p>
    <div class="game-grid">
      ${['cloze', 'listen', 'match', 'order', 'next'].map(card).join('')}
      <button class="game" data-mode="wrong" ${wrongN ? '' : 'disabled'}>
        <span class="g-icon">📕</span><b>오답 다시 풀기</b><small>${wrongN ? `틀린 문제 ${wrongN}개` : '<span class="why">아직 오답 없음</span>'}</small>
      </button>
    </div>
    <p class="sec-title">운전하면서</p>
    <button class="quiz-hero alt" id="audioQuiz">
      <span class="qh-icon">🚗</span>
      <span class="qh-body"><b>운전용 오디오 퀴즈 5문제</b><small>한국어 뜻을 듣고 <b>1번 = 다음 곡</b>, <b>2번 = 이전 곡</b> 버튼으로 답해요</small></span>
      <span class="qh-go">▶</span>
    </button>
    <p class="muted small">🚗 출발 코스 마지막에도 보너스 퀴즈 3문제가 나와요. 맞힌 표현은 복습 일정이 늘어나고, 틀린 문제는 오답노트에 모여요.</p>
    ${st.total ? `<p class="muted small">지금까지 ${st.total}문제 · 정답률 ${Math.round((st.correct / st.total) * 100)}%</p>` : ''}`, { back: '#/' });
  $app.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => startRound(b.dataset.mode));
  document.getElementById('audioQuiz').onclick = () => startAudioQuiz(5);
}

function startAudioQuiz(n) {
  const cards = audioQuizCards(n);
  if (!cards.length) return toast('문제를 만들 수 없어요.');
  player.load({
    cards: [{ kind: 'cue', ko: `운전용 퀴즈 ${cards.length}문제. 1번이면 다음 곡, 2번이면 이전 곡 버튼을 누르세요.`, text: '' }, ...cards],
    index: 0, title: '🎮 운전용 오디오 퀴즈', kind: 'drill',
  });
  player.sceneId = null;
  player.play();
  go('#/drill');
}

// ---------- question ----------
const survival = () => S.mode === 'survival';
const progressBar = () => `
  <div class="q-top">
    ${survival()
      ? `<span class="hearts">${'❤️'.repeat(S.hearts)}${'🤍'.repeat(3 - S.hearts)}</span><span class="q-prog"><i style="width:100%"></i></span><span>${S.correct}문제</span>`
      : `<span>${S.i + 1} / ${S.items.length}</span><span class="q-prog"><i style="width:${(S.i / S.items.length) * 100}%"></i></span>`}
    <span class="combo ${S.combo >= 2 ? 'on' : ''}">${S.combo >= 2 ? `🔥 ${S.combo}콤보` : `✓ ${S.correct}`}</span>
  </div>`;

const HEADS = {
  cloze: '빈칸에 들어갈 단어는?', two: '이 뜻의 영어 표현은?',
  listen: '들리는 문장을 고르세요', order: '단어를 순서대로 눌러 문장을 만드세요', next: '다음 대사로 알맞은 것은?',
};
const playLine = (text, sp) => { cancelSpeech(); speak(speakable(text), { voiceName: state.settings.voices[roleOf(sp)], rate: state.settings.rate }); };
let lastAutoPlayed = null;

function renderQuestion() {
  const q = S.items[S.i];
  if (!q) return go('#/quiz/result');
  if (q.type === 'match') return renderMatch(q);
  if (q.type === 'order') return renderOrder(q);
  const answered = S.picked != null;
  const ok = answered && S.picked === q.answer;
  const sc = q.sceneId && sceneById(q.sceneId);
  let body = '';
  if (q.type === 'cloze') {
    body = `${q.sp ? `<span class="q-sp role-${roleOf(q.sp)}">${esc(q.sp)}</span>` : ''}
      <p class="q-text">${esc(answered ? q.line : q.prompt).replace('_____', '<span class="blank">_____</span>')}</p>
      <button class="hint-btn" id="hint" ${answered ? 'hidden' : ''}>💡 힌트: 한국어 뜻</button><p class="q-hint" id="hintText" ${answered ? '' : 'hidden'}>${esc(q.hint || '')}</p>`;
  } else if (q.type === 'listen') {
    body = `<button class="listen-big" id="playAudio">🔊<span>다시 듣기</span></button>
      <button class="hint-btn" id="slow">🐢 느리게 듣기</button>`;
  } else if (q.type === 'next') {
    body = `<span class="q-sp role-${roleOf(q.sp)}">${esc(q.sp)}</span><p class="q-text">“${esc(q.prompt)}”</p>
      <p class="q-hint">→ ${esc(spName(q.nextSp))}의 대답은?</p>`;
  } else {
    body = `<p class="q-text">“${esc(q.prompt)}”</p>`;
  }
  shell(GAMES[S.mode]?.title || '퀴즈', `
    ${progressBar()}
    <p class="q-head">${HEADS[q.type] || '정답은?'}</p>
    <div class="q-card">${body}</div>
    <div class="q-options ${q.type === 'listen' || q.type === 'next' ? 'long' : ''}">
      ${q.options.map((o, k) => {
        const cls = !answered ? '' : k === q.answer ? 'right' : k === S.picked ? 'wrong' : 'dim';
        return `<button class="q-opt ${cls}" data-k="${k}" ${answered ? 'disabled' : ''}>${esc(o)}</button>`;
      }).join('')}
    </div>
    ${answered ? feedback(ok, q, sc) : ''}`, { back: '#/quiz' });

  document.getElementById('hint')?.addEventListener('click', (ev) => { ev.currentTarget.hidden = true; document.getElementById('hintText').hidden = false; });
  document.getElementById('playAudio')?.addEventListener('click', () => playLine(q.audio, q.sp));
  document.getElementById('slow')?.addEventListener('click', () => { cancelSpeech(); speak(speakable(q.audio), { voiceName: state.settings.voices[roleOf(q.sp)], rate: Math.max(0.5, state.settings.rate - 0.3) }); });
  $app.querySelectorAll('.q-opt').forEach((b) => b.onclick = () => grade(+b.dataset.k === q.answer, +b.dataset.k));
  bindFeedback(q);
  if (q.type === 'listen' && !answered && lastAutoPlayed !== q) { lastAutoPlayed = q; setTimeout(() => playLine(q.audio, q.sp), 250); }
}

function feedback(ok, q, sc) {
  const answerText = q.type === 'order' ? q.line : q.options?.[q.answer];
  const last = survival() ? S.hearts <= 0 : S.i + 1 >= S.items.length;
  return `
    <div class="q-feedback ${ok ? 'ok' : 'bad'}">
      <b>${ok ? (S.combo >= 2 ? `정답! 🔥 ${S.combo}콤보` : '정답!') : `아쉬워요${survival() ? ` · 남은 하트 ${S.hearts}` : ''}`}</b>
      ${!ok && answerText ? `<span>정답: ${esc(answerText)}</span>` : ''}
      ${sc ? `<small>${esc(sceneTitle(sc))} · p.${q.page ?? sc.page}</small>` : ''}
      ${!ok ? '<small>오답노트에 저장했어요.</small>' : ''}
    </div>
    <div class="q-actions">
      <button class="btn-secondary" id="listen">🔊 대사 듣기</button>
      <button class="btn-primary" id="nextQ">${last ? '결과 보기 ›' : '다음 문제 ›'}</button>
    </div>`;
}
function bindFeedback(q) {
  document.getElementById('listen')?.addEventListener('click', () => {
    const sp = q.type === 'next' ? q.nextSp : q.sp;
    const text = q.type === 'cloze' || q.type === 'order' ? q.line
      : q.type === 'listen' ? q.audio : q.type === 'next' ? q.options[q.answer] : q.line || q.options[q.answer];
    playLine(text, sp);
  });
  document.getElementById('nextQ')?.addEventListener('click', nextQuestion);
}

/** Record an answer for the current question and redraw with feedback. */
function grade(ok, picked = ok ? 0 : -1) {
  const q = S.items[S.i];
  S.picked = picked;
  if (ok) { S.correct++; S.combo++; S.maxCombo = Math.max(S.maxCombo, S.combo); } else { S.combo = 0; if (survival()) S.hearts--; }
  quizStore.record(q, ok);
  if (navigator.vibrate) navigator.vibrate(ok ? 20 : [30, 40, 30]);
  if (ok && S.combo > 0 && S.combo % 5 === 0) toast(`${S.combo}문제 연속 정답!`, '🔥');
  if (q.type === 'order') renderOrder(q); else renderQuestion();
}

function nextQuestion() {
  cancelSpeech();
  if (survival()) {
    if (S.hearts <= 0) return go('#/quiz/result');
    S.items.push(anyQuestion());
  }
  S.i++; S.picked = null; S.match = null; S.order = null;
  if (S.i >= S.items.length) go('#/quiz/result'); else renderQuestion();
}

// ---------- word order ----------
function renderOrder(q) {
  S.order ||= { placed: [] };
  const o = S.order;
  const answered = S.picked != null;
  const ok = answered && S.picked === 0;
  const sc = q.sceneId && sceneById(q.sceneId);
  shell(GAMES[S.mode]?.title || '퀴즈', `
    ${progressBar()}
    <p class="q-head">${HEADS.order}</p>
    <div class="q-card">
      <span class="q-sp role-${roleOf(q.sp)}">${esc(q.sp)}</span>
      <div class="order-line">${o.placed.length ? o.placed.map((ti, k) => `<button class="tile placed" data-unplace="${k}" ${answered ? 'disabled' : ''}>${esc(q.words[ti])}</button>`).join('') : '<span class="muted small">아래 단어를 순서대로 누르세요</span>'}</div>
    </div>
    <div class="order-pool">${q.tiles.map((t) => `<button class="tile" data-place="${t.i}" ${o.placed.includes(t.i) || answered ? 'disabled' : ''}>${esc(t.w)}</button>`).join('')}</div>
    ${answered ? feedback(ok, q, sc) : `<div class="q-actions"><button class="btn-secondary" id="resetOrder">처음부터</button><button class="btn-secondary" id="hearOrder">🔊 힌트로 듣기</button></div>`}`, { back: '#/quiz' });
  $app.querySelectorAll('[data-place]').forEach((b) => b.onclick = () => {
    o.placed.push(+b.dataset.place);
    if (o.placed.length === q.words.length) grade(orderCorrect(q, o.placed), orderCorrect(q, o.placed) ? 0 : 1);
    else renderOrder(q);
  });
  $app.querySelectorAll('[data-unplace]').forEach((b) => b.onclick = () => { o.placed.splice(+b.dataset.unplace, 1); renderOrder(q); });
  document.getElementById('resetOrder')?.addEventListener('click', () => { o.placed = []; renderOrder(q); });
  document.getElementById('hearOrder')?.addEventListener('click', () => playLine(q.line, q.sp));
  bindFeedback(q);
}

// ---------- match pairs ----------
function renderMatch(q) {
  S.match ||= { done: new Set(), sel: null, mistakes: 0 };
  const m = S.match;
  const byId = Object.fromEntries(q.pairs.map((p) => [p.id, p]));
  const finished = m.done.size === q.pairs.length;
  shell(GAMES[S.mode]?.title || '퀴즈', `
    ${progressBar()}
    <p class="q-head">짝을 맞춰보세요 <small class="muted">한국어 → 영어 순서로 눌러요</small></p>
    <div class="match">
      <div class="m-col">${q.left.map((id) => `<button class="m-item ko ${m.done.has(id) ? 'done' : ''} ${m.sel === id ? 'sel' : ''}" data-l="${id}" ${m.done.has(id) ? 'disabled' : ''}>${esc(byId[id].ko)}</button>`).join('')}</div>
      <div class="m-col">${q.right.map((id) => `<button class="m-item en ${m.done.has(id) ? 'done' : ''}" data-r="${id}" ${m.done.has(id) ? 'disabled' : ''}>${esc(byId[id].en)}</button>`).join('')}</div>
    </div>
    ${finished ? `
      <div class="q-feedback ${m.mistakes <= 1 ? 'ok' : 'bad'}"><b>${m.mistakes === 0 ? '완벽해요! 한 번도 안 틀렸어요' : `다 맞췄어요 · 실수 ${m.mistakes}번`}</b></div>
      <div class="q-actions"><button class="btn-primary wide" id="nextQ">${S.i + 1 < S.items.length ? '다음 문제 ›' : '결과 보기 ›'}</button></div>`
      : `<p class="muted small center">실수 ${m.mistakes}번</p>`}`, { back: '#/quiz' });

  $app.querySelectorAll('[data-l]').forEach((b) => b.onclick = () => { m.sel = b.dataset.l; renderMatch(q); });
  $app.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => {
    if (!m.sel) return toast('먼저 왼쪽 한국어를 고르세요');
    const id = b.dataset.r;
    if (id === m.sel) {
      m.done.add(id); m.sel = null;
      quizStore.record({ type: 'two', key: 'two:' + id, ref: id }, true);
      if (navigator.vibrate) navigator.vibrate(15);
      if (m.done.size === q.pairs.length) {
        const ok = m.mistakes <= 1;
        if (ok) { S.correct++; S.combo++; S.maxCombo = Math.max(S.maxCombo, S.combo); } else S.combo = 0;
      }
      renderMatch(q);
    } else {
      m.mistakes++;
      // Save the missed pair as a two-choice question for the wrong-answer notes.
      const e = state.expressions.find((x) => x.id === m.sel);
      const q2 = e && makeTwoChoice(e, state.expressions);
      if (q2) quizStore.record(q2, false);
      b.classList.add('shake');
      if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
      setTimeout(() => renderMatch(q), 350);
    }
  });
  document.getElementById('nextQ')?.addEventListener('click', nextQuestion);
}

// ---------- result ----------
function renderResult() {
  const total = survival() ? S.i + 1 : S.items.length;
  const stars = survival() ? (S.correct >= 20 ? 3 : S.correct >= 10 ? 2 : S.correct >= 5 ? 1 : 0) : starsFor(S.correct, total);
  if (!S.saved) {
    S.saved = true;
    S.newBest = quizStore.finishRound(S.mode, S.correct, Math.max(total, 1), stars);
    deliver(track('quiz', { correct: S.correct, total, stars }));
  }
  const msg = survival()
    ? (S.correct >= 20 ? '대단해요, 끝까지 버텼어요!' : S.correct >= 10 ? '두 자릿수 돌파!' : '다음엔 더 멀리 갈 수 있어요')
    : stars === 3 ? '완벽에 가까워요!' : stars === 2 ? '좋아요, 거의 다 왔어요' : stars === 1 ? '절반 넘게 맞혔어요' : '틀린 문제가 오답노트에 모였어요';
  shell('퀴즈 결과', `
    <section class="result">
      <p class="r-stars">${'★'.repeat(stars)}<span>${'★'.repeat(3 - stars)}</span></p>
      <h2>${survival() ? `${S.correct}문제 생존` : `${S.correct} / ${total}`}</h2>
      <p class="muted">${msg}${S.newBest ? ' · 🏆 최고 기록!' : ''}</p>
      <div class="r-stats">
        <div><b>${Math.round((S.correct / Math.max(total, 1)) * 100)}%</b><small>정답률</small></div>
        <div><b>🔥 ${S.maxCombo}</b><small>최대 콤보</small></div>
        <div><b>${Object.keys(quizStore.wrong()).length}</b><small>오답노트</small></div>
      </div>
    </section>
    <div class="q-actions">
      <button class="btn-secondary" id="toHome">퀴즈 홈</button>
      <button class="btn-primary" id="again">다시 하기</button>
    </div>
    ${Object.keys(quizStore.wrong()).length ? '<button class="ghost block" id="toWrong">📕 오답만 다시 풀기</button>' : ''}`, { back: '#/quiz' });
  document.getElementById('again').onclick = () => startRound(S.mode);
  document.getElementById('toHome').onclick = () => { S = null; go('#/quiz'); };
  document.getElementById('toWrong')?.addEventListener('click', () => startRound('wrong'));
}
