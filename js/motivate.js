// Learning stats + motivating messages.
// track(event, data) updates stats and returns messages for the app to deliver:
//   { ko, en, voice: bool, kind: 'toast' | 'letter', letter? }

const ls = {
  get(k, d) { try { const v = localStorage.getItem('her.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('her.' + k, JSON.stringify(v)); } catch { /* full or blocked */ } },
};

const DAY = 86400000;
export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const keyToDate = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((keyToDate(b) - keyToDate(a)) / DAY);

const blank = () => ({
  days: {},
  totals: { lines: 0, heard: 0, scenes: 0, reviews: 0, graduated: 0, saved: 0, recs: 0, ms: 0, perfect: 0 },
  hit: [], letters: [], recent: [], lastDay: null, unread: 0,
});
let S = { ...blank(), ...ls.get('stats', {}) };
S.totals = { ...blank().totals, ...S.totals };
const save = () => ls.set('stats', S);

const emptyDay = () => ({ lines: 0, heard: 0, reviews: 0, recs: 0, ms: 0, scenes: 0, goal: false, grad: 0 });
const dayOf = (k = dayKey()) => (S.days[k] ||= emptyDay());
const isActive = (d) => d && (d.lines + d.heard + d.reviews + d.recs > 0 || d.ms >= 60000);

// Monday-based week id, used for the one-free-rest-day-per-week streak freeze.
const weekOf = (d) => dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)));

/**
 * Streak with a freeze: one missed day per week (Mon–Sun) is bridged when
 * there is study on both sides of it. Frozen days keep the streak alive but
 * don't add to it. Pure (days map in, result out) so it is unit-tested.
 */
export function streakInfo(days, today = new Date()) {
  const act = (d) => isActive(days[dayKey(d)]);
  let d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!act(d)) d = new Date(d.getTime() - DAY); // today not done yet: count up to yesterday
  let n = 0;
  const frozen = [];
  const usedWeeks = new Set();
  for (let guard = 0; guard < 3650; guard++) {
    if (act(d)) { n++; d = new Date(d.getTime() - DAY); continue; }
    const before = new Date(d.getTime() - DAY);
    const wk = weekOf(d);
    if (n > 0 && act(before) && !usedWeeks.has(wk)) {
      usedWeeks.add(wk); frozen.push(dayKey(d)); d = before; continue;
    }
    break;
  }
  const thisWeek = weekOf(today);
  return { n, frozen, freezeUsedThisWeek: frozen.some((k) => weekOf(keyToDate(k)) === thisWeek) };
}
export const streak = () => streakInfo(S.days).n;
export const streakDetail = () => streakInfo(S.days);
export const stats = () => S;
export const todayStats = () => dayOf();
export const activeDays = () => Object.values(S.days).filter(isActive).length;
export function calendar(n = 35) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY);
    const k = dayKey(d);
    out.push({ k, date: d, day: S.days[k] || emptyDay() });
  }
  return out;
}
export function markLettersRead() { S.unread = 0; save(); }

// ---------- message pools (original copy) ----------
const P = {
  firstToday: [
    ['오늘도 왔네요. 시작이 반이에요.', "You showed up. That's the hardest part."],
    ['오늘 첫 문장, 입이 풀리고 있어요.', 'First line of the day. Your mouth is warming up.'],
    ['좋아요, 오늘의 영어 시작!', "Here we go. Today's English starts now."],
  ],
  comeback: [
    ['다시 왔네요. 멈춘 곳부터 그대로 이어갈게요.', 'Welcome back. We pick up right where you left off.'],
    ['쉬어도 괜찮아요. 돌아온 게 중요해요.', 'Breaks are fine. Coming back is what counts.'],
    ['오랜만이에요. 오늘 한 장면만 해도 충분해요.', 'Good to hear you again. One scene today is plenty.'],
  ],
  scene: [
    ['장면 완료! 대사 {lines}줄을 입으로 소화했어요.', 'Scene done. {lines} lines, spoken out loud.'],
    ['"{scene}" 끝. 이 장면은 이제 당신 거예요.', 'That scene is yours now.'],
    ['한 장면 더. 영화 한 편이 조금씩 내 말이 되고 있어요.', 'One more scene. The movie is slowly becoming your voice.'],
    ['수고했어요. 방금 Theodore와 같은 호흡으로 말했어요.', 'Nice. You just spoke in rhythm with Theodore.'],
  ],
  act: [
    ['{act} 완료! 큰 산 하나를 넘었어요. 편지가 도착했어요.', 'You finished a whole act. A letter is waiting for you.'],
  ],
  graduated: [
    ['"{word}" 졸업! 이제 진짜 내 표현이에요.', '"{word}" graduated. It belongs to you now.'],
    ['"{word}", 한 달 뒤에 봐요. 이미 몸에 붙었어요.', 'See you in a month, "{word}". It already stuck.'],
  ],
  levelUp: [
    ['"{word}", 다음 복습은 {next} 뒤. 기억에 자리 잡는 중이에요.', '"{word}" is settling in. Next review in {nextEn}.'],
    ['"{word}" 한 단계 위로. 잊는 속도보다 빠르게 가고 있어요.', "\"{word}\" moved up. You're outrunning forgetting."],
  ],
  saved: [
    ['내 단어장 {n}개! 영화가 내 단어장이 되고 있어요.', '{n} words saved. The film is turning into your notebook.'],
  ],
  lines: [
    ['따라 말한 대사 {n}줄 돌파!', "{n} lines spoken. That's real practice."],
    ['{n}줄! 입 근육이 영어 모양으로 바뀌고 있어요.', '{n} lines. Your mouth is learning new shapes.'],
  ],
  streak: [
    ['{n}일 연속! 습관이 생기고 있어요.', '{n} days in a row. This is becoming a habit.'],
    ['{n}일째 이어가는 중. 꾸준함이 실력이에요.', "Day {n}. Consistency is the skill."],
  ],
  goal: [
    ['오늘 목표 {n}분 달성! 출근길이 영어 수업이 됐어요.', "Today's goal, {n} minutes, done. Your commute became a class."],
    ['{n}분 채웠어요. 오늘 몫은 끝, 나머진 보너스예요.', "{n} minutes in. Everything from here is a bonus."],
  ],
  firstRec: [
    ['첫 녹음 저장! 오늘의 목소리가 나중에 큰 선물이 될 거예요.', 'First recording saved. Future you will thank you.'],
  ],
  recs: [
    ['녹음 {n}개. 내 목소리의 성장 기록이 쌓이고 있어요.', '{n} recordings. Your progress has a sound now.'],
  ],
  score90: [
    ['{score}점! 원어민 귀에 그대로 들리는 문장이에요.', '{score}. That sentence came through loud and clear.'],
    ['{score}점, 훌륭해요. 이 문장은 이제 자신 있게 써도 돼요.', '{score}. You can use this line with confidence.'],
  ],
  perfect: [
    ['100점! 한 단어도 놓치지 않았어요.', 'A perfect hundred. Not a single word missed.'],
  ],
  improved: [
    ['{from}점 → {score}점! 방금 실력이 늘었어요.', 'From {from} to {score}. You just got better.'],
    ['+{delta}점 상승. 반복이 효과를 내고 있어요.', 'Up {delta} points. Repetition is working.'],
  ],
  mission: [
    ['실전 미션 성공! "{en}", 이제 진짜 내 말이에요.', 'You used it for real. That is how phrases stick.'],
    ['미션 성공 {count}번째! 영화 대사가 생활 영어가 되고 있어요.', 'Mission number {count}. Movie lines are becoming your everyday English.'],
  ],
  quiz3: [
    ['별 세 개! {total}문제 중 {n}문제 정답.', 'Three stars. {n} out of {total}.'],
    ['퀴즈 만점에 가까워요. 표현이 머리에 붙었어요.', 'Nearly perfect. These phrases are sticking.'],
  ],
  session: [
    ['오늘 {min}분, 대사 {lines}줄, 복습 {reviews}개. 잘했어요.', '{min} minutes today. Well done.'],
    ['끝까지 들었어요. 오늘 {lines}줄 따라 말했어요.', 'You made it to the end. {lines} lines today.'],
    ['수고했어요. 내일 같은 시간에 또 만나요.', 'Good work. Same time tomorrow?'],
  ],
};

const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ''));
function pick(pool, vars = {}, opts = {}) {
  const list = P[pool];
  const fresh = list.map((_, i) => i).filter((i) => !S.recent.includes(pool + i));
  const idx = (fresh.length ? fresh : list.map((_, i) => i))[Math.floor(Math.random() * (fresh.length || list.length))];
  S.recent = [pool + idx, ...S.recent].slice(0, 16);
  const [ko, en] = list[idx];
  return { ko: fill(ko, vars), en: fill(en, vars), voice: opts.voice !== false, kind: 'toast', pool };
}

const MILESTONES = {
  lines: [25, 50, 100, 250, 500, 750, 1000, 1500, 2000],
  saved: [10, 25, 50, 100, 200],
  recs: [10, 30, 50, 100],
  streak: [3, 7, 14, 21, 30, 50, 100],
};
function milestone(type, value) {
  const t = MILESTONES[type].find((m) => value >= m && !S.hit.includes(type + m));
  if (t == null) return null;
  S.hit.push(type + t);
  return t;
}

// ---------- letters ("Letters From Your Commute") ----------
const L_OPEN = [
  'I wanted to put this on paper before the day slipped away.',
  'Some progress is too quiet to notice, so I am writing it down for you.',
  'I have been keeping track, and I think you should hear this.',
];
const L_MID = [
  'You did not wait for the perfect moment. You just pressed play on an ordinary morning and started talking.',
  'Somewhere between the traffic lights and the parking lot, a new language has been finding its way into your voice.',
  'Every repeated line was a small decision to keep going. They add up, even when they feel small.',
];
const L_CLOSE = [
  'Keep listening. Keep speaking. I will be here on the next drive.',
  'Tomorrow is just another ordinary commute, and that is exactly why it works.',
  'Be proud of this one. Then let us do it again.',
];
const r = (a) => a[Math.floor(Math.random() * a.length)];
const pl = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
function makeLetter(reason, reasonKo) {
  const t = S.totals;
  const st = streak();
  const times = t.recs === 1 ? 'once' : t.recs === 2 ? 'twice' : `${t.recs} times`;
  const en = [
    'Dear me,',
    '',
    r(L_OPEN),
    `So far you have spoken ${pl(t.lines, 'line')} out loud, finished ${pl(t.scenes, 'scene')}, reviewed ${pl(t.reviews, 'word')}${t.recs ? `, and recorded your own voice ${times}` : ''}${st > 1 ? `. You have shown up ${st} days in a row` : ''}.`,
    `Today's reason for this letter: ${reason}.`,
    r(L_MID),
    r(L_CLOSE),
    '',
    'Love,',
    'Your commute',
  ].join('\n');
  const ko = `지금까지 대사 ${t.lines}줄, 장면 ${t.scenes}개, 단어 복습 ${t.reviews}번, 녹음 ${t.recs}번.${st > 1 ? ` ${st}일 연속 학습 중.` : ''}`;
  const letter = { id: 'L' + Date.now(), date: Date.now(), title: reasonKo, en, ko };
  S.letters.unshift(letter);
  S.unread = (S.unread || 0) + 1;
  return letter;
}

// ---------- events ----------
export function track(type, data = {}) {
  const out = [];
  const k = dayKey();
  const d = dayOf(k);
  const wasActive = isActive(d);
  const t = S.totals;

  switch (type) {
    case 'open': {
      if (S.lastDay && S.lastDay !== k && daysBetween(S.lastDay, k) >= 3 && t.lines + t.reviews > 0) out.push(pick('comeback', {}, { voice: false }));
      const weekly = weeklyLetter();
      if (weekly) out.push(weekly);
      break;
    }
    case 'line':
      if (data.mode === 'listen') { d.heard++; t.heard++; }
      else {
        d.lines++; t.lines++;
        const m = milestone('lines', t.lines);
        if (m) out.push(pick('lines', { n: m }));
      }
      break;
    case 'scene': {
      d.scenes++; t.scenes++;
      out.push(pick('scene', { lines: data.lines, scene: data.title }));
      if (data.actDone && !S.hit.includes('act' + data.actDone)) {
        S.hit.push('act' + data.actDone);
        const msg = pick('act', { act: data.actName });
        msg.kind = 'letter';
        msg.letter = makeLetter(`you finished ${data.actEn}`, `${data.actName} 완료!`);
        out.push(msg);
      }
      break;
    }
    case 'review': {
      d.reviews++; t.reviews++;
      if (data.graduated) {
        t.graduated++;
        d.grad = (d.grad || 0) + 1;
        out.push(pick('graduated', { word: data.word }));
      } else if (data.box >= 3 && Math.random() < 0.35) {
        out.push(pick('levelUp', { word: data.word, next: data.nextKo, nextEn: data.nextEn }, { voice: false }));
      }
      break;
    }
    case 'saved': {
      t.saved = data.count;
      const m = milestone('saved', data.count);
      if (m) out.push(pick('saved', { n: m }, { voice: false }));
      break;
    }
    case 'rec': {
      d.recs++; t.recs++;
      if (t.recs === 1) out.push(pick('firstRec', {}, { voice: false }));
      else { const m = milestone('recs', t.recs); if (m) out.push(pick('recs', { n: m }, { voice: false })); }
      break;
    }
    case 'score': {
      const { score, prev } = data;
      // Remember the day's biggest improvement for the weekly report.
      if (prev != null && data.text && score - prev > 0 && (!d.bestGain || score - prev > d.bestGain.to - d.bestGain.from)) {
        d.bestGain = { text: data.text, from: prev, to: score };
      }
      if (score === 100) { t.perfect++; out.push(pick('perfect', {}, { voice: false })); }
      else if (prev != null && score - prev >= 10) out.push(pick('improved', { from: prev, score, delta: score - prev }, { voice: false }));
      else if (score >= 90 && (prev == null || prev < 90)) out.push(pick('score90', { score }, { voice: false }));
      break;
    }
    case 'tick': {
      d.ms += data.ms; t.ms += data.ms;
      const goal = (data.goalMin || 15) * 60000;
      if (!d.goal && d.ms >= goal) { d.goal = true; out.push(pick('goal', { n: data.goalMin || 15 })); }
      break;
    }
    case 'mission': {
      out.push(pick('mission', { en: data.en, count: data.count }));
      break;
    }
    case 'quiz': {
      if (data.stars === 3) out.push(pick('quiz3', { n: data.correct, total: data.total }, { voice: false }));
      break;
    }
    case 'session': {
      if (d.lines + d.reviews > 0) out.push(pick('session', { min: Math.max(1, Math.round(d.ms / 60000)), lines: d.lines, reviews: d.reviews }));
      break;
    }
    default: break;
  }

  // Becoming active today: greet, and check streak milestones.
  if (!wasActive && isActive(d) && type !== 'open') {
    const st = streak();
    const m = milestone('streak', st);
    if (m) {
      const msg = pick('streak', { n: m });
      if (m >= 7) { msg.kind = 'letter'; msg.letter = makeLetter(`you kept going ${m} days in a row`, `${m}일 연속 학습 달성!`); }
      out.push(msg);
    } else if (type !== 'tick') out.push(pick('firstToday', {}, { voice: false }));
  }
  if (type !== 'open' && type !== 'tick') S.lastDay = k;
  if (type === 'tick' && isActive(d)) S.lastDay = k;
  save();
  return out;
}

// ---------- weekly report letter ----------
/** Totals for the 7 days ending on `end` (inclusive). Pure: used by tests too. */
export function weekReport(days, end) {
  let minutes = 0, lines = 0, reviews = 0, graduated = 0, recs = 0, activeDays = 0, best = null;
  for (let i = 0; i < 7; i++) {
    const dd = days[dayKey(new Date(end.getFullYear(), end.getMonth(), end.getDate() - i))];
    if (!dd) continue;
    minutes += dd.ms / 60000; lines += dd.lines; reviews += dd.reviews; graduated += dd.grad || 0; recs += dd.recs;
    if (isActive(dd)) activeDays++;
    if (dd.bestGain && (!best || dd.bestGain.to - dd.bestGain.from > best.to - best.from)) best = dd.bestGain;
  }
  return { minutes: Math.round(minutes), lines, reviews, graduated, recs, activeDays, best };
}

/** On Sunday (or the first open after a missed Sunday), write the week's letter once. */
function weeklyLetter(now = new Date()) {
  const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  const wk = dayKey(sunday);
  if (S.weekly === wk) return null;
  const w = weekReport(S.days, sunday);
  if (!w.activeDays) { S.weekly = wk; return null; }
  S.weekly = wk;
  const prevW = weekReport(S.days, new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() - 7));
  const delta = w.minutes - prevW.minutes;
  const isToday = now.getDay() === 0;
  const mon = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() - 6);
  const range = `${mon.getMonth() + 1}/${mon.getDate()}–${sunday.getMonth() + 1}/${sunday.getDate()}`;
  const en = [
    'Dear me,',
    '',
    `Here is your week${isToday ? ' so far' : ''}, written down so it does not slip away.`,
    `You studied on ${pl(w.activeDays, 'day')} for ${pl(w.minutes, 'minute')}${prevW.minutes ? ` (${delta >= 0 ? `${delta} more` : `${-delta} fewer`} than the week before)` : ''}, spoke ${pl(w.lines, 'line')} out loud and reviewed ${pl(w.reviews, 'word')}.`,
    w.graduated ? `${pl(w.graduated, 'word')} graduated this week. They are yours now.` : 'No word graduated yet this week, and that is fine: they are all on their way.',
    w.best ? `Your biggest jump was on "${w.best.text.length > 70 ? w.best.text.slice(0, 67) + '...' : w.best.text}", from ${w.best.from} to ${w.best.to}.` : '',
    r(L_CLOSE),
    '',
    'Love,',
    'Your commute',
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
  const ko = `${isToday ? '이번 주' : '지난주'}(${range}) ${w.activeDays}일 · ${w.minutes}분${prevW.minutes ? ` (지난주보다 ${delta >= 0 ? '+' : '−'}${Math.abs(delta)}분)` : ''} · 대사 ${w.lines}줄 · 복습 ${w.reviews}번 · 졸업 ${w.graduated}개${w.best ? ` · 최고 상승 ${w.best.from}→${w.best.to}점` : ''}`;
  const letter = { id: 'W' + wk, date: Date.now(), title: `주간 리포트 · ${range}`, en, ko };
  S.letters.unshift(letter);
  S.unread = (S.unread || 0) + 1;
  return { ko: '이번 주 리포트 편지가 도착했어요.', en: "This week's letter is here.", voice: false, kind: 'letter', letter };
}

/** Big lifetime milestones also earn a letter (checked after line events). */
export function lineLetter() {
  const t = S.totals.lines;
  for (const m of [500, 1000, 2000]) {
    if (t >= m && !S.hit.includes('letter-lines' + m)) {
      S.hit.push('letter-lines' + m);
      const letter = makeLetter(`you have now spoken ${m} lines of the film`, `대사 ${m}줄 달성!`);
      save();
      return { ko: `대사 ${m}줄 달성! 편지가 도착했어요.`, en: `${m} lines. A letter is waiting for you.`, voice: true, kind: 'letter', letter };
    }
  }
  return null;
}
