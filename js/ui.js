import { speak, cancelSpeech } from './tts.js';
import { myDict, boxLabel } from './dict.js';
import { getKo } from './translate.js';
import { markLettersRead } from './motivate.js';
import { state, $app, esc, sceneById, sceneTitle, player, exprSrs } from './core.js';
import { renderGo, renderImport, renderHome, updateHomeStrip, renderStats } from './view-home.js';
import { renderScenes, renderScene } from './view-scene.js';
import { renderMyDict, renderDrill, renderExpressions } from './view-study.js';
import { renderSettings } from './view-settings.js';
import { renderTalk } from './view-talk.js';
import { renderFavs } from './view-favs.js';

// ---------- routing ----------
export function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }
window.addEventListener('hashchange', render);

export function render() {
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
  if (route === 'talk') return renderTalk();
  if (route === 'favs') return renderFavs();
  return renderHome();
}

export function shell(title, body, { back = '#/', showBar = true } = {}) {
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

export function closeSheet() {
  document.getElementById('sheet-root')?.remove();
}

// Toasts queue up so several messages in a row are all readable.
export const toastQueue = [];
export let toastBusy = false;
export function toast(msg, icon = '') {
  toastQueue.push(icon ? `${icon} ${msg}` : msg);
  if (!toastBusy) nextToast();
}
export function nextToast() {
  const msg = toastQueue.shift();
  if (!msg) { toastBusy = false; return; }
  toastBusy = true;
  document.getElementById('toast')?.remove();
  const t = Object.assign(document.createElement('div'), { id: 'toast', className: 'toast', textContent: msg });
  document.body.appendChild(t);
  setTimeout(() => { t.remove(); nextToast(); }, 2600);
}

// ---------- letters ----------
export function openLetter(letter) {
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

// ---------- player bars ----------
export function miniBar() {
  if (!player.cards.length) return '';
  return `<div class="mini" id="mini">
    <a class="mini-info" href="${player.kind === 'scene' ? '#/scene/' + player.sceneId : '#/drill'}">
      <small>${esc(player.title)}</small><span id="miniText"></span></a>
    <button class="icon-btn big" id="miniPlay" aria-label="재생/정지"></button></div>`;
}
export function bindMiniBar() {
  const b = document.getElementById('miniPlay');
  if (b) b.onclick = () => player.toggle();
  updatePlayerUI();
}
export function bigBar() {
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
export function bindBigBar() {
  document.getElementById('prev').onclick = () => player.prev();
  document.getElementById('next').onclick = () => player.next();
  document.getElementById('replay').onclick = () => player.replay();
  document.getElementById('play').onclick = () => player.toggle();
}

export let lastActive = -1;
export function updatePlayerUI(force = false) {
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
