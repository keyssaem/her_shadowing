import { ACTS } from './content.js';
import { speak, cancelSpeech, roleOf } from './tts.js';
import { lookup, guessPos, myDict, keyOf } from './dict.js';
import { getKo, hasScene, translateScene, getKey } from './translate.js';
import { track } from './motivate.js';
import { canRecord, startRecording, saveRecording, listByKey, deleteRecording, playBlob, stopPlayback, canScore, listen, scoreAgainst } from './recorder.js';
import { chunkLine } from './player.js';
import { LS, state, saveSettings, $app, esc, sceneTitle, dialogueCount, player, deliver, scenePlays, sceneRate, loadScene, relTime, scoreKey, getScores, isFav, toggleFav } from './core.js';
import { modeLabel } from './view-home.js';
import { go, shell, closeSheet, toast, bigBar, bindBigBar, updatePlayerUI } from './ui.js';

// ---------- scene list ----------
export function renderScenes() {
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
export const TOKEN = /[A-Za-z0-9]+(?:'[A-Za-z]+)*|[^A-Za-z0-9]+/g;
export const isWord = (t) => /^[A-Za-z0-9]/.test(t);

/** Tokenize a line into words (with char offsets). */
export function wordsOf(text) {
  const out = [];
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) if (isWord(m[0])) out.push({ w: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

/** Expression spans of this scene that occur in the text. */
export function markRanges(text, sceneId) {
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
export function renderLine(text, sceneId) {
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

export function renderScene(scene) {
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
        ${isFav(scene.id, i) ? '<span class="fav-mark" aria-label="명대사">★</span>' : ''}</li>`;
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
      <span class="chip ghosty" title="장면을 끝까지 할 때마다 기본 속도 −0.15 → −0.05 → 기본 속도">${s.autoSpeed ? `⏩ ${sceneRate(scene.id)}× · ${scenePlays(scene.id) + 1}회차` : `⏩ ${s.rate}×`}</span>
      <button class="chip ${s.showKo && hasScene(scene.id) ? 'on' : ''}" id="koBtn">${hasScene(scene.id) ? (s.showKo ? '🇰🇷 해석 숨기기' : '🇰🇷 해석 보기') : '🇰🇷 이 장면 해석하기'}</button>
      <button class="chip" id="dictBtn">✍ 받아쓰기</button>
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
  document.getElementById('dictBtn').onclick = () => {
    // Start dictation at the current line (or the first one).
    const cur = player.sceneId === scene.id ? player.current?.itemIndex : null;
    const first = scene.items.findIndex((it) => it.t === 'd');
    openPracticeSheet(scene, cur != null && scene.items[cur]?.t === 'd' ? cur : first, { mode: 'dictation' });
  };
  bindLineInteractions(scene);
  bindBigBar();
  updatePlayerUI(true);
  if (!LS.get('hint.line', false)) {
    LS.set('hint.line', true);
    toast('대사를 누르면 메뉴가 열려요 · 단어를 길게 누르면 뜻이 나와요', '💡');
  }
}

// ---------- line interactions ----------
// Tap a line → an action row opens under it (play from here / speak / dictation / favourite).
// Long-press a word → English dictionary. Nothing is hidden behind tiny icons.
function actionRow(scene, i) {
  const fav = isFav(scene.id, i);
  return `<div class="line-actions" role="toolbar" aria-label="대사 메뉴">
      <button data-act="play"><span>▶</span>여기부터</button>
      <button data-act="speak"><span>🎙</span>말하기 연습</button>
      <button data-act="dict"><span>✍</span>받아쓰기</button>
      <button data-act="fav" class="${fav ? 'on' : ''}"><span>${fav ? '★' : '☆'}</span>${fav ? '명대사 빼기' : '명대사'}</button>
      <p class="la-hint">📖 단어 뜻은 단어를 <b>길게 누르세요</b></p>
    </div>`;
}

function bindLineInteractions(scene) {
  const list = $app.querySelector('.lines');
  let pressTimer = 0, longPressed = false, startXY = null;

  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = 0; };
  list.addEventListener('pointerdown', (ev) => {
    const w = ev.target.closest('.w');
    const li = ev.target.closest('.line');
    longPressed = false;
    if (!w || !li || ev.target.closest('.line-actions')) return;
    startXY = [ev.clientX, ev.clientY];
    w.classList.add('pressing');
    pressTimer = setTimeout(() => {
      longPressed = true;
      w.classList.remove('pressing');
      if (navigator.vibrate) navigator.vibrate(15);
      openWordSheet(scene, +li.dataset.item, +w.dataset.w, w.closest('mark')?.dataset.e);
    }, 450);
  });
  list.addEventListener('pointermove', (ev) => {
    if (pressTimer && startXY && Math.hypot(ev.clientX - startXY[0], ev.clientY - startXY[1]) > 10) {
      cancelPress();
      list.querySelectorAll('.pressing').forEach((x) => x.classList.remove('pressing'));
    }
  });
  const end = () => { cancelPress(); list.querySelectorAll('.pressing').forEach((x) => x.classList.remove('pressing')); };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
  list.addEventListener('contextmenu', (ev) => { if (ev.target.closest('.w')) ev.preventDefault(); });

  list.addEventListener('click', (ev) => {
    if (longPressed) { longPressed = false; ev.preventDefault(); return; }
    const li = ev.target.closest('[data-item]');
    if (!li) return;
    const i = +li.dataset.item;
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act) {
      if (act === 'play') { closeRows(); playFromItem(i); }
      if (act === 'speak') openPracticeSheet(scene, i);
      if (act === 'dict') openPracticeSheet(scene, i, { mode: 'dictation' });
      if (act === 'fav') {
        const on = toggleFav(scene.id, i);
        toast(on ? '⭐ 명대사에 추가 · 출발 코스 마지막에 나와요' : '명대사에서 뺐어요');
        li.querySelector('.fav-mark')?.remove();
        if (on) li.querySelector('.tx').insertAdjacentHTML('afterend', '<span class="fav-mark" aria-label="명대사">★</span>');
        li.querySelector('.line-actions').outerHTML = actionRow(scene, i);
      }
      return;
    }
    if (!li.classList.contains('line')) return playFromItem(i); // scene description lines just play
    // Toggle this line's action row.
    const open = li.classList.contains('selected');
    closeRows();
    if (!open) {
      li.classList.add('selected');
      li.insertAdjacentHTML('beforeend', actionRow(scene, i));
    }
  });
  function closeRows() {
    list.querySelectorAll('.line.selected').forEach((x) => x.classList.remove('selected'));
    list.querySelectorAll('.line-actions').forEach((x) => x.remove());
  }
}

export function playFromItem(itemIndex) {
  const idx = player.cards.findIndex((c) => c.itemIndex === itemIndex);
  if (idx >= 0) { player.jump(idx); if (!player.playing) player.play(); }
}

// ---------- word sheet (English-English dictionary) ----------
export let sheetSeq = 0;
export function openWordSheet(scene, itemIndex, wordIndex, exprId) {
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
          <button class="card primary slim" data-x="add">${saved ? '✓ 내 단어장에 있음 (뜻 업데이트)' : '＋ 내 단어장에 추가'}</button>
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

export function openPracticeSheet(scene, itemIndex, opts = {}) {
  player.pause();
  closeSheet();
  const item = scene.items[itemIndex];
  const chunks = chunkLine(item.text);
  let ci = 0;
  let mode = opts.mode || 'speak'; // 'speak' (record + score) | 'dictation'
  let typed = '';
  let dictResult = null;
  const nextLine = (dir) => {
    for (let i = itemIndex + dir; i >= 0 && i < scene.items.length; i += dir) if (scene.items[i].t === 'd') return i;
    return null;
  };
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

  const modeTabs = () => `<div class="modes wrap tabs">
      <button class="chip ${mode === 'speak' ? 'on' : ''}" data-mode-tab="speak">🎙 말하기</button>
      <button class="chip ${mode === 'dictation' ? 'on' : ''}" data-mode-tab="dictation">✍ 받아쓰기</button></div>`;
  const chunkTabs = () => (chunks.length > 1 ? `<div class="modes wrap">${chunks.map((_, i) => `<button class="chip ${i === ci ? 'on' : ''}" data-chunk="${i}">${i + 1}/${chunks.length}</button>`).join('')}</div>` : '');

  function drawDictation(note = '') {
    const best = LS.get('dictation', {})[key()];
    const nWords = (text().match(/[A-Za-z0-9']+/g) || []).length;
    const prev = nextLine(-1), next = nextLine(1);
    root.innerHTML = `
      <div class="sheet-backdrop" data-x="close"></div>
      <section class="sheet practice" role="dialog" aria-label="받아쓰기">
        <div class="sheet-handle"></div>
        ${modeTabs()}
        <p class="muted tiny">${esc(item.sp)} · p.${item.page} · ${nWords}단어${best != null ? ` · 최고 ${best}점` : ''}</p>
        ${chunkTabs()}
        ${dictResult
          ? `<p class="target">${dictResult.words.map((w) => `<span class="${w.ok ? 'ok' : 'miss'}">${esc(w.text)}</span>`).join(' ')}</p>
             <div class="score-box"><b class="score ${dictResult.score >= 90 ? 'hi' : dictResult.score >= 70 ? 'mid' : 'lo'}">${dictResult.score}</b>
               <span><small>내가 쓴 문장</small><br>“${esc(typed)}”</span></div>`
          : `<p class="target hidden-line">${'▁ '.repeat(nWords)}</p>`}
        ${note ? `<p class="status">${esc(note)}</p>` : ''}
        <textarea id="dictIn" rows="3" class="dict-in" placeholder="들리는 대로 영어로 입력하세요" autocapitalize="off" autocomplete="off" spellcheck="false">${esc(typed)}</textarea>
        <div class="pr-row">
          <button class="pr-btn" data-x="dplay">▶<small>듣기</small></button>
          <button class="pr-btn" data-x="dslow">🐢<small>느리게</small></button>
          <button class="pr-btn on" data-x="dcheck">✓<small>확인</small></button>
        </div>
        <div class="row between">
          <button class="ghost" data-x="dprev" ${prev == null ? 'disabled' : ''}>◀ 이전 대사</button>
          <button class="ghost hl" data-x="dnext" ${next == null ? 'disabled' : ''}>다음 대사 ▶</button>
        </div>
        <p class="muted tiny">대소문자·문장부호는 무시하고, I'm = I am처럼 같은 말은 맞게 봐요.</p>
      </section>`;
    const ta = root.querySelector('#dictIn');
    ta.oninput = () => { typed = ta.value; };
  }

  function draw(note = '') {
    if (mode === 'dictation') return drawDictation(note);
    const sc = getScores()[scoreKey(key())];
    const target = result
      ? result.words.map((w) => `<span class="${w.ok ? 'ok' : 'miss'}">${esc(w.text)}</span>`).join(' ')
      : esc(text());
    const first = history[0], last = history[history.length - 1];
    root.innerHTML = `
      <div class="sheet-backdrop" data-x="close"></div>
      <section class="sheet practice" role="dialog" aria-label="말하기 연습">
        <div class="sheet-handle"></div>
        ${modeTabs()}
        <p class="muted tiny">${esc(item.sp)} · p.${item.page}${sc ? ` · 최고 ${sc.best}점` : ''}</p>
        ${chunkTabs()}
        <p class="target">${target}</p>
        ${result ? `<div class="score-box"><b class="score ${result.score >= 90 ? 'hi' : result.score >= 70 ? 'mid' : 'lo'}">${result.score}</b>
          <span><small>들린 문장</small><br>“${esc(result.heard)}”</span></div>
          ${result.words.some((w) => !w.ok) ? `<button class="ghost hl block" data-x="missed" ${busy ? 'disabled' : ''}>＋ 놓친 단어 ${new Set(result.words.filter((w) => !w.ok).map((w) => keyOf(w.text))).size}개 → 내 단어장에 추가</button>` : ''}` : ''}
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
    if (chunkBtn && !busy) {
      ci = +chunkBtn.dataset.chunk; result = null; dictResult = null; typed = '';
      await loadHistory(); draw();
      if (mode === 'dictation') { cancelSpeech(); sayOriginal(); }
      return;
    }
    const tab = ev.target.closest('[data-mode-tab]')?.dataset.modeTab;
    if (tab && !busy && tab !== mode) {
      mode = tab; cancelSpeech(); draw();
      if (mode === 'dictation') sayOriginal();
      return;
    }
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
    // --- dictation ---
    if (x === 'dplay') { cancelSpeech(); sayOriginal(); }
    if (x === 'dslow') { cancelSpeech(); speak(text(), { voiceName: state.settings.voices[roleOf(item.sp)], rate: Math.max(0.5, state.settings.rate - 0.3) }); }
    if (x === 'dcheck') {
      typed = root.querySelector('#dictIn')?.value.trim() || '';
      if (!typed) return draw('먼저 들리는 대로 입력해 보세요.');
      dictResult = scoreAgainst(text(), [typed]);
      const all = LS.get('dictation', {});
      const prevBest = all[key()];
      all[key()] = Math.max(prevBest ?? 0, dictResult.score);
      LS.set('dictation', all);
      const missed = dictResult.words.filter((w) => !w.ok).length;
      draw(dictResult.score === 100 ? '완벽해요! 다음 대사로 가볼까요?'
        : `놓친 단어 ${missed}개 (빨간색).${prevBest != null && dictResult.score > prevBest ? ` 최고점 갱신 ${prevBest} → ${dictResult.score}!` : ''}`);
      return;
    }
    if (x === 'dnext' || x === 'dprev') {
      const to = nextLine(x === 'dnext' ? 1 : -1);
      if (to != null) { cancelSpeech(); openPracticeSheet(scene, to, { mode: 'dictation', autoplay: true }); }
      return;
    }
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
      draw(`${missed.length}개를 내 단어장에 넣었어요${added < missed.length ? ` (새 단어 ${added}개)` : ''}. 운전 중 복습에 나와요.`);
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
        deliver(track('score', { score: result.score, prev, text: text() }));
      } catch (e) { busy = ''; draw(e.message); }
      listener = null;
    }
    if (x === 'ab' && !busy && history.length) compareAB(null, history[history.length - 1], '원문 → 최근 내 목소리');
    if (x === 'then' && !busy && history.length >= 2) compareAB(history[0], history[history.length - 1], '처음의 나 → 최근의 나');
  });

  if (opts.autoplay || mode === 'dictation') setTimeout(() => sayOriginal(), 250);
  loadHistory().then(() => draw());
  draw();
}
