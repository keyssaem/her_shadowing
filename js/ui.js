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
  if (route === 'review') return REVIEW_TABS.find((t) => t.id === arg)?.render() ?? REVIEW_TABS.find((t) => t.id === lastReviewTab)?.render() ?? renderMyDict();
  return renderHome();
}

// ---------- bottom tab bar ----------
const TABS = [
  { id: 'home', icon: '🚗', label: '출발', href: '#/', routes: ['', 'go'] },
  { id: 'script', icon: '📖', label: '대본', href: '#/scenes', routes: ['scenes', 'scene'] },
  { id: 'review', icon: '🔁', label: '복습', href: '#/review', routes: ['review', 'mydict', 'expr', 'favs', 'talk', 'drill'] },
  { id: 'stats', icon: '📊', label: '기록', href: '#/stats', routes: ['stats'] },
];
const currentRoute = () => location.hash.replace(/^#\/?/, '').split('/')[0];
export function tabBar() {
  const r = currentRoute();
  return `<nav class="tabbar" aria-label="주요 메뉴">${TABS.map((t) => `
    <a href="${t.href}" class="${t.routes.includes(r) ? 'on' : ''}" ${t.routes.includes(r) ? 'aria-current="page"' : ''}>
      <span class="ti">${t.icon}</span><span class="tl">${t.label}</span></a>`).join('')}</nav>`;
}

// ---------- review hub: one place for everything you go back over ----------
let lastReviewTab = 'words';
const REVIEW_TABS = [
  { id: 'words', label: '내 단어장', href: '#/mydict', render: () => renderMyDict() },
  { id: 'expr', label: '핵심 표현', href: '#/expr', render: () => renderExpressions() },
  { id: 'favs', label: '⭐ 명대사', href: '#/favs', render: () => renderFavs() },
];
/** Segmented tabs shown at the top of the three review screens. */
export function reviewTabs(active) {
  lastReviewTab = active;
  return `<div class="segmented" role="tablist">${REVIEW_TABS.map((t) => `
      <a role="tab" href="${t.href}" class="${t.id === active ? 'on' : ''}" ${t.id === active ? 'aria-selected="true"' : ''}>${t.label}</a>`).join('')}</div>
    <a class="practice-link" href="#/talk"><span>💬</span><span><b>AI 대화로 써보기</b><small>모은 표현으로 역할극 · 받아쓰기는 대본의 대사에서</small></span><span>›</span></a>`;
}

export function shell(title, body, { back = '#/', showBar = true } = {}) {
  state.view = null;
  $app.innerHTML = `
    <header class="top">
      ${title ? `<a class="icon-btn" href="${back}" aria-label="뒤로">‹</a>` : '<span class="brand">her<span>·</span>shadowing</span>'}
      <h1>${title ? esc(title) : ''}</h1>
      <a class="icon-btn" href="#/settings" aria-label="설정">⚙</a>
    </header>
    <main class="content with-tabs">${body}</main>
    ${showBar ? miniBar() : ''}
    ${tabBar()}`;
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
    <div class="now">
      <span class="now-text" id="status" aria-live="polite"></span>
      <span class="now-pos" id="pos"></span>
    </div>
    <div class="countdown" id="countdown" hidden><i id="countdownFill"></i></div>
    <div class="bar-controls">
      <button class="ctl" id="prev" aria-label="이전 대사"><span class="ci">◀</span><span class="cl">이전</span></button>
      <button class="ctl" id="replay" aria-label="이 대사 다시 듣기"><span class="ci">↻</span><span class="cl">다시</span></button>
      <button class="ctl play" id="play" aria-label="재생 또는 일시정지"><span class="ci" id="playIcon">▶</span><span class="cl" id="playLabel">재생</span></button>
      <button class="ctl" id="next" aria-label="다음 대사"><span class="ci">▶</span><span class="cl">다음</span></button>
    </div></div>`;
}

// Countdown bar for "your turn" pauses: shrinks as the time to speak runs out.
let countdownRaf = 0;
function tickCountdown() {
  cancelAnimationFrame(countdownRaf);
  const box = document.getElementById('countdown');
  const fill = document.getElementById('countdownFill');
  if (!box || !fill) return;
  const left = player.waitEnd - Date.now();
  const show = player.playing && player.waitEnd && left > 0 && player.waitMs >= 900;
  box.hidden = !show;
  if (!show) return;
  fill.style.width = `${Math.max(0, (left / player.waitMs) * 100)}%`;
  countdownRaf = requestAnimationFrame(tickCountdown);
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
  const $pi = document.getElementById('playIcon'); if ($pi) $pi.textContent = playIcon;
  const $pl = document.getElementById('playLabel'); if ($pl) $pl.textContent = player.playing ? '일시정지' : '재생';
  const $mp = document.getElementById('miniPlay'); if ($mp) $mp.textContent = playIcon;
  const c = player.current;
  const $mt = document.getElementById('miniText');
  if ($mt && c) $mt.textContent = c.kind === 'expr' ? c.en : (c.kind === 'line' && c.sp ? c.sp + ': ' : '') + (c.text || c.ko || '');
  const $status = document.getElementById('status');
  if ($status && state.view) {
    const st = player.status || (player.playing ? '' : '⏸ 멈춤 · 아래 ▶ 재생을 누르세요');
    $status.textContent = st;
    $status.classList.toggle('speak', /🗣/.test(st));
  }
  const $pos = document.getElementById('pos'); if ($pos) $pos.textContent = player.cards.length ? `${player.index + 1} / ${player.cards.length}` : '';
  tickCountdown();
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
    const m = document.getElementById('master'); if (m) { m.textContent = '알아요 ✓'; m.classList.remove('on'); }
    const h = document.getElementById('hard'); if (h) h.hidden = false;
    return;
  }
  if (state.view === 'drill' && c) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const h = document.getElementById('hard'); if (h) h.hidden = c.kind !== 'expr';
    const srs = c.kind === 'expr' && exprSrs.get(c.id);
    set('dcount', `${player.index + 1} / ${player.cards.length}${c.kind === 'expr' ? ' · ' + (srs ? boxLabel(srs.box) : '새 표현') : ''}`);
    set('dko', c.ko);
    const reveal = !state.settings.drillKoreanFirst || !/뜻을 들어요|영어로/.test(player.status) || !player.playing;
    set('den', reveal ? c.en : '· · ·');
    set('dnote', c.note || '');
    set('dsrc', c.source ? `${c.source.sp} · p.${c.source.page} — “${c.source.text}”` : '');
    const m = document.getElementById('master');
    if (m) { m.textContent = c.kind === 'expr' ? '알아요 ✓' : ''; m.hidden = c.kind !== 'expr'; m.classList.remove('on'); }
  }
}
