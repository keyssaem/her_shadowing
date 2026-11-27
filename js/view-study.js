import { CATEGORIES } from './content.js';
import { speak, cancelSpeech, roleOf } from './tts.js';
import { myDict, boxLabel } from './dict.js';
import { track } from './motivate.js';
import { LS, state, $app, esc, sceneById, shuffle, player, deliver, reviewWord, hardMarked, exprSrs, pickExpressions, wordCard } from './core.js';
import { startDrill } from './view-home.js';
import { go, shell, toast, bigBar, bindBigBar, updatePlayerUI, reviewTabs } from './ui.js';

export function startWordDrill(list, title) {
  if (!list.length) return toast('복습할 단어가 없어요.');
  player.load({ cards: list.map(wordCard), index: 0, title, kind: 'drill' });
  player.sceneId = null;
  player.play();
  go('#/drill');
}

export function renderMyDict() {
  const all = myDict.all();
  const due = myDict.due();
  shell('복습', `${reviewTabs('words')}
    <p class="muted small">대본에서 단어를 <b>길게 누르면</b> 영어 뜻을 보고 여기에 모을 수 있어요. 복습 중 끝까지 들으면 <b>알아요</b>, 이전 곡 버튼을 누르면 <b>다시 볼래요</b>로 기록돼요.</p>
    <div class="grid2">
      <button class="card primary" id="dueBtn"><span class="card-kicker">오늘 복습</span><span class="card-title">${due.length}개</span><span class="card-sub">▶ 복습 시작</span></button>
      <button class="card" id="allBtn"><span class="card-kicker">전체 반복</span><span class="card-title">${all.length}개</span><span class="card-sub">▶ 랜덤 순서</span></button>
    </div>
    ${all.length ? '' : '<p class="muted empty">아직 모은 단어가 없어요. 📖 대본에서 대사 속 단어를 길게 눌러보세요.</p>'}
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
  document.getElementById('dueBtn').onclick = () => startWordDrill(due, '내 단어장 · 오늘 복습');
  document.getElementById('allBtn').onclick = () => startWordDrill(shuffle(all), '내 단어장 · 전체');
  $app.querySelectorAll('[data-say]').forEach((b) => b.onclick = () => {
    const i = all.find((x) => x.id === b.dataset.say);
    player.pause(); cancelSpeech();
    speak(i.text + '. ' + (i.def || ''), { voiceName: state.settings.voices.samantha, rate: state.settings.rate });
  });
  $app.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
    if (!confirm('이 단어를 내 단어장에서 뺄까요?')) return;
    myDict.remove(b.dataset.del);
    renderMyDict();
  });
}

// ---------- drill ----------
export function renderDrill() {
  if (player.kind !== 'drill' && player.kind !== 'drive') return go('#/expr');
  state.view = 'drill';
  $app.innerHTML = `
    <header class="top">
      <a class="icon-btn" href="#/review" aria-label="뒤로">‹</a>
      <h1>${esc(player.title)}</h1>
      <a class="icon-btn" href="#/settings" aria-label="설정">⚙</a>
    </header>
    <main class="content drill">
      <p class="drill-count" id="dcount"></p>
      <p class="drill-ko" id="dko"></p>
      <p class="drill-en" id="den"></p>
      <p class="drill-note" id="dnote"></p>
      <p class="drill-src" id="dsrc"></p>
      <div class="answers" id="answers" hidden>
        <button class="q-opt" data-ans="1"><b>1번</b> <span></span></button>
        <button class="q-opt" data-ans="2"><b>2번</b> <span></span></button>
      </div>
      <div class="row center">
        <button class="grade again" id="hard" hidden>↻ 다시 볼래요</button>
        <button class="grade know" id="master"></button>
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
      // "알아요": long jump in the review schedule, then move on.
      exprSrs.review(c.id, 'easy');
      hardMarked.add('x:' + c.id); // already graded; skip auto-grade at card end
      toast(`"${c.en}" — 다음 복습: ${boxLabel(exprSrs.get(c.id).box)} 뒤`);
      player.next();
      return;
    }
  };
  document.querySelectorAll('[data-ans]').forEach((b) => b.onclick = () => player.answer(+b.dataset.ans));
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
export function renderExpressions(catArg) {
  const cat = catArg != null && catArg !== '' ? CATEGORIES[+catArg] : null;
  const list = state.expressions.filter((e) => !cat || e.cat === cat);
  const chips = `<div class="modes wrap">
    <a class="chip ${!cat ? 'on' : ''}" href="#/expr">전체</a>
    ${CATEGORIES.map((c, i) => `<a class="chip ${cat === c ? 'on' : ''}" href="#/expr/${i}">${esc(c)}</a>`).join('')}</div>`;
  shell('복습', `${reviewTabs('expr')}${chips}
    <button class="card primary slim" id="drillAll">▶ ${cat ? esc(cat) : '전체'} 표현 복습 (${list.filter((e) => !state.mastered.has(e.id)).length || list.length}개)</button>
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
          <button class="icon-btn ${myDict.has(e.en) ? 'on' : ''}" data-add="${e.id}" aria-label="내 단어장에 추가" title="내 단어장에 추가">＋</button>
          <button class="icon-btn ${state.mastered.has(e.id) ? 'on' : ''}" data-master="${e.id}" aria-label="다 익힘 (복습에서 빼기)" title="다 익힘 (복습에서 빼기)">✓</button>
        </div>
      </li>`).join('')}</ul>`, { back: '#/' });
  document.getElementById('drillAll').onclick = () => {
    startDrill(pickExpressions(list.length, list), (cat || '전체') + ' 표현 복습');
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
    toast(`"${e.en}" 내 단어장에 저장`);
    deliver(track('saved', { count: myDict.all().length }));
  });
  $app.querySelectorAll('[data-master]').forEach((b) => b.onclick = () => {
    const id = b.dataset.master;
    state.mastered.has(id) ? state.mastered.delete(id) : state.mastered.add(id);
    LS.set('mastered', [...state.mastered]);
    renderExpressions(catArg);
  });
}
