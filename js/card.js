// Weekly progress card: one image (1080×1350, Instagram-portrait size) with
// this week's numbers and the act-by-act mastery map, saved as a PNG.

const W = 1080, H = 1350;
const FONT = '"Apple SD Gothic Neo", "Pretendard", "Malgun Gothic", "Noto Sans KR", system-ui, sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/**
 * data: { range, minutes, lines, reviews, graduated, streak, activeDays,
 *         acts: [{ ko, pct, won, total }], mission: number, quote? }
 */
export function drawWeeklyCard(data) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  // Background: warm coral gradient
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#f26b54'); g.addColorStop(1, '#b8392a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,.06)';
  ctx.beginPath(); ctx.arc(W - 120, 160, 260, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.font = `800 44px ${FONT}`; ctx.fillText('her · shadowing', 80, 120);
  ctx.font = `500 34px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillText(`이번 주 기록  ·  ${data.range}`, 80, 175);

  // Big numbers
  const tiles = [
    ['학습 시간', `${data.minutes}분`], ['따라 말한 대사', `${data.lines}줄`],
    ['연속 학습', `🔥 ${data.streak}일`], ['졸업한 단어', `${data.graduated}개`],
  ];
  tiles.forEach(([label, value], i) => {
    const x = 80 + (i % 2) * 470, y = 230 + Math.floor(i / 2) * 230;
    ctx.fillStyle = 'rgba(255,255,255,.14)'; roundRect(ctx, x, y, 440, 200, 32); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `600 32px ${FONT}`; ctx.fillText(label, x + 36, y + 64);
    ctx.fillStyle = '#fff'; ctx.font = `800 76px ${FONT}`; ctx.fillText(value, x + 36, y + 156);
  });

  // Mastery bars per act
  let y = 740;
  ctx.fillStyle = '#fff'; ctx.font = `800 38px ${FONT}`; ctx.fillText('막별 표현 마스터', 80, y);
  y += 30;
  for (const a of data.acts) {
    y += 70;
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = `600 30px ${FONT}`;
    ctx.fillText(a.ko, 80, y);
    ctx.fillStyle = 'rgba(255,255,255,.2)'; roundRect(ctx, 400, y - 26, 470, 30, 15); ctx.fill();
    ctx.fillStyle = '#fff'; roundRect(ctx, 400, y - 26, Math.max(30, 470 * a.pct / 100), 30, 15); ctx.fill();
    ctx.font = `700 30px ${FONT}`; ctx.fillText(`${a.pct}%`, 900, y);
  }

  // Footer
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `500 30px ${FONT}`;
  ctx.fillText(`${data.activeDays}일 공부 · 단어 복습 ${data.reviews}번${data.mission ? ` · 실전 미션 ${data.mission}번 성공` : ''}`, 80, H - 120);
  ctx.font = `600 28px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.fillText(new Date().toLocaleDateString('ko-KR'), 80, H - 70);
  return c;
}

/** Save the card as a PNG file. */
export function saveCard(canvas, name = 'her-shadowing-week.png') {
  return new Promise((resolve) => canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    resolve(blob);
  }, 'image/png'));
}
