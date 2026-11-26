// "내 명대사": favourite lines starred in the script, as a playable list.
import { roleOf } from './tts.js';
import { state, $app, esc, sceneTitle, player, favLines, favCard, toggleFav } from './core.js';
import { shell, go, toast } from './ui.js';

export function renderFavs() {
  const list = favLines();
  shell('⭐ 내 명대사', `
    <p class="muted small">장면 화면에서 대사 옆 ☆를 누르면 여기에 모여요. 오늘의 드라이브 마지막에도 2~3줄씩 나옵니다.</p>
    ${list.length ? `
      <div class="grid2">
        <button class="card primary" id="playAll"><span class="card-kicker">${list.length}줄</span><span class="card-title">▶ 전체 재생</span><span class="card-sub">${state.settings.mode === 'listen' ? '듣기' : '쉐도잉'} 모드</span></button>
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
      : '<p class="muted empty">아직 명대사가 없어요. 장면을 열고 마음에 드는 대사 옆 ☆를 눌러보세요.</p>'}`, { back: '#/' });

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
  $app.querySelectorAll('[data-unfav]').forEach((b) => b.onclick = () => {
    const f = list[+b.dataset.unfav];
    toggleFav(f.sceneId, f.itemIndex);
    toast('명대사에서 뺐어요');
    renderFavs();
  });
}
