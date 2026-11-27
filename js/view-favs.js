// "내 명대사": favourite lines starred in the script, as a playable list.
import { roleOf } from './tts.js';
import { LS, state, $app, esc, sceneTitle, player, favLines, favCard, toggleFav, weakLineList } from './core.js';
import { shell, go, toast, reviewTabs } from './ui.js';

export function renderFavs() {
  const list = favLines();
  const weak = weakLineList();
  shell('복습', `${reviewTabs('favs')}
    <p class="muted small">대본에서 대사를 누르고 ☆ 명대사를 고르면 여기에 모여요. 🚗 출발 코스 마지막에도 2~3줄씩 나옵니다.</p>
    ${list.length ? `
      <div class="grid2">
        <button class="card primary" id="playAll"><span class="card-kicker">${list.length}줄</span><span class="card-title">▶ 전체 재생</span><span class="card-sub">${state.settings.mode === 'listen' ? '듣기' : '따라 말하기'} 모드</span></button>
        <button class="card" id="shuffleAll"><span class="card-kicker">무작위</span><span class="card-title">🔀 섞어서</span><span class="card-sub">순서 없이 반복</span></button>
      </div>
      <ul class="fav-list">${list.map((f, i) => `
        <li class="role-${roleOf(f.item.sp)}">
          <div class="ex-main">
            <span class="sp">${esc(f.item.sp)}</span>
            <b>${esc(f.item.text)}</b>
            <a class="src" href="#/scene/${f.sceneId}">${esc(sceneTitle(f.scene))} · p.${f.item.page}</a>
          </div>
          <div class="ex-actions">
            <button class="icon-btn" data-play="${i}" aria-label="여기부터 재생">▶</button>
            <button class="icon-btn on" data-unfav="${i}" aria-label="명대사에서 빼기">★</button>
          </div>
        </li>`).join('')}</ul>`
      : '<p class="muted empty">아직 명대사가 없어요. 📖 대본에서 마음에 드는 대사를 누르고 ☆ 명대사를 골라보세요.</p>'}
    <h3 class="sec">🎯 다시 연습할 대사 ${weak.length ? `<small class="muted">${weak.length}줄</small>` : ''}</h3>
    ${weak.length ? `
      <button class="ghost block" id="playWeak">▶ 약한 대사만 따라 말하기</button>
      <ul class="fav-list">${weak.map((f, i) => `
        <li class="role-${roleOf(f.item.sp)}">
          <div class="ex-main">
            <span class="sp">${esc(f.item.sp)} · <span class="score-badge ${f.score >= 70 ? 'mid' : 'lo'}">${f.score}</span></span>
            <b>${esc(f.item.text)}</b>
            <a class="src" href="#/scene/${f.sceneId}">${esc(sceneTitle(f.scene))} · p.${f.item.page}</a>
          </div>
          <div class="ex-actions">
            <button class="icon-btn" data-wplay="${i}" aria-label="재생">▶</button>
            <button class="icon-btn danger" data-wdel="${i}" aria-label="목록에서 빼기">✕</button>
          </div>
        </li>`).join('')}</ul>`
      : '<p class="muted small">대본 화면의 🎯 채점하며 따라 말하기에서 점수가 낮았던 대사를 여기 넣을 수 있어요. 85점 이상 받으면 자동으로 빠져요.</p>'}`, { back: '#/' });

  const start = (cards, index, title) => {
    player.load({ cards, index, title, kind: 'drill' });
    player.sceneId = null;
    player.play();
    go('#/drill');
  };
  document.getElementById('playAll')?.addEventListener('click', () => start(list.map(favCard), 0, '⭐ 내 명대사'));
  document.getElementById('shuffleAll')?.addEventListener('click', () => {
    const cards = list.map(favCard);
    for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
    start(cards, 0, '⭐ 내 명대사 · 섞어서');
  });
  $app.querySelectorAll('[data-play]').forEach((b) => b.onclick = () => start(list.map(favCard), +b.dataset.play, '⭐ 내 명대사'));
  document.getElementById('playWeak')?.addEventListener('click', () => start(weak.map(favCard), 0, '🎯 다시 연습할 대사'));
  $app.querySelectorAll('[data-wplay]').forEach((b) => b.onclick = () => start(weak.map(favCard), +b.dataset.wplay, '🎯 다시 연습할 대사'));
  $app.querySelectorAll('[data-wdel]').forEach((b) => b.onclick = () => {
    const f = weak[+b.dataset.wdel];
    const w = LS.get('weak', {}); delete w[`${f.sceneId}:${f.itemIndex}`]; LS.set('weak', w);
    renderFavs();
  });
  $app.querySelectorAll('[data-unfav]').forEach((b) => b.onclick = () => {
    const f = list[+b.dataset.unfav];
    toggleFav(f.sceneId, f.itemIndex);
    toast('명대사에서 뺐어요');
    renderFavs();
  });
}
