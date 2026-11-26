// AI conversation practice: role-play a new everyday situation with Claude and
// try to use phrases you saved (Drill Dictionary) or are learning (key expressions).
import { createMessage, textOf, getKey } from './claude.js';
import { myDict, keyOf } from './dict.js';
import { speak, cancelSpeech } from './tts.js';
import { canScore, listen } from './recorder.js';
import { state, $app, esc, player, exprSrs, reviewWord, pickExpressions, shuffle } from './core.js';
import { shell, toast, go } from './ui.js';

const SITUATIONS = [
  { id: 'coworker', ko: '회의 끝난 동료와 잡담', en: 'Chatting with a coworker right after a long meeting' },
  { id: 'friend', ko: '오랜만에 만난 친구와 근황', en: 'Catching up with an old friend you have not seen in months' },
  { id: 'date', ko: '첫 데이트 저녁 식사', en: 'A first dinner date at a small restaurant' },
  { id: 'makeup', ko: '다툰 뒤 연인과 화해', en: 'Making up with your partner the morning after an argument' },
  { id: 'boss', ko: '상사에게 어려운 말 꺼내기', en: 'Telling your manager you need to push back a deadline' },
  { id: 'neighbor', ko: '엘리베이터에서 만난 이웃', en: 'Running into a friendly neighbor in the apartment elevator' },
];

let session = null; // { targets, situation, messages, turns, used:Set }

function candidateTargets() {
  const words = myDict.all().sort((a, b) => a.due - b.due).map((w) => ({ id: 'w:' + w.id, text: w.text, ko: w.ko || w.def || '', kind: 'word', ref: w.id }));
  const exprs = pickExpressions(12).map((e) => ({ id: 'x:' + e.id, text: e.en, ko: e.ko, kind: 'expr', ref: e.id }));
  return [...words.slice(0, 12), ...exprs];
}

function systemPrompt(sit, targets) {
  return [
    'You are a friendly conversation partner in a spoken-English role-play for a Korean adult learner (intermediate level) who is practising phrases learned from movie dialogue.',
    `Situation: ${sit.en}. You play the other person in this situation; invent a name and a believable personality. You are not a character from any film.`,
    `The learner wants to practise these phrases: ${targets.map((t) => `"${t.text}"`).join(', ')}.`,
    'In your replies, speak naturally in casual spoken American English, 1-3 short sentences, like real speech. Create natural openings for the learner to use the target phrases, but do not say the target phrases yourself. Ask follow-up questions so the conversation keeps going. Stay in character in the reply.',
    'After each learner message, also coach them briefly: say which target phrases they used and whether correctly, and offer a more natural way to say their message if it helps. Keep the coaching kind and short; write tip_ko in Korean.',
    'Respond ONLY with a JSON object, no other text:',
    '{"reply": "<your in-character spoken reply>", "feedback": null | {"used": ["<target phrases used correctly>"], "misused": ["<target phrases used incorrectly>"], "better": "<a more natural version of the learner\'s last message, or empty>", "tip_ko": "<one short tip in Korean>"}}',
    'feedback is null only for your opening line.',
  ].join('\n');
}

function parseTurn(text) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < s) return { reply: text.trim(), feedback: null };
  try {
    const o = JSON.parse(text.slice(s, e + 1));
    return { reply: String(o.reply || '').trim(), feedback: o.feedback || null };
  } catch { return { reply: text.trim(), feedback: null }; }
}

const sayReply = (t) => speak(t, { voiceName: state.settings.voices.male, rate: state.settings.rate });

// ---------- setup ----------
export function renderTalk() {
  if (session) return renderChat();
  if (!getKey()) {
    shell('AI 대화 연습', `
      <p class="muted">Claude와 새로운 상황을 역할극하면서, 저장한 단어와 핵심 표현을 직접 써보는 연습이에요.</p>
      <p>먼저 <a class="src" href="#/settings">설정 › 한국어 해석</a>에서 Anthropic API 키를 넣어주세요. 대화 한 번(10턴 정도)에 수십 원 수준입니다.</p>`);
    return;
  }
  const cands = candidateTargets();
  const preset = new Set(cands.slice(0, 4).map((c) => c.id));
  shell('AI 대화 연습', `
    <p class="muted small">상황을 고르고 연습할 표현을 3~5개 체크하세요. 상대 대사는 음성으로 들려주고, 내 말은 🎤로 말하거나 입력하면 돼요.</p>
    <h3 class="sec">상황</h3>
    <div class="modes wrap">${SITUATIONS.map((s, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-sit="${s.id}">${esc(s.ko)}</button>`).join('')}</div>
    <h3 class="sec">연습할 표현</h3>
    ${cands.length ? `<ul class="pick-list">${cands.map((c) => `
      <li><label class="switch"><input type="checkbox" data-t="${esc(c.id)}" ${preset.has(c.id) ? 'checked' : ''}>
        <span><b>${esc(c.text)}</b><small>${c.kind === 'word' ? '내 단어장' : '핵심 표현'}${c.ko ? ' · ' + esc(c.ko.slice(0, 50)) : ''}</small></span></label></li>`).join('')}</ul>`
      : '<p class="muted small">아직 저장한 단어가 없어요. 핵심 표현으로 시작할게요.</p>'}
    <button class="card primary slim" id="startTalk">💬 대화 시작</button>`);
  let sit = SITUATIONS[0];
  $app.querySelectorAll('[data-sit]').forEach((b) => b.onclick = () => {
    $app.querySelectorAll('[data-sit]').forEach((x) => x.classList.toggle('on', x === b));
    sit = SITUATIONS.find((s) => s.id === b.dataset.sit);
  });
  document.getElementById('startTalk').onclick = async (ev) => {
    let targets = cands.filter((c) => $app.querySelector(`[data-t="${CSS.escape(c.id)}"]`)?.checked);
    if (!targets.length) targets = shuffle(cands).slice(0, 4);
    targets = targets.slice(0, 6);
    ev.currentTarget.disabled = true;
    ev.currentTarget.textContent = '상대가 말을 거는 중…';
    session = { sit, targets, messages: [{ role: 'user', content: '(Start the role-play now: say your opening line.)' }], turns: [], used: new Set() };
    try {
      await nextTurn();
      renderChat();
    } catch (e) {
      session = null;
      toast(e.message);
      renderTalk();
    }
  };
}

async function nextTurn() {
  const res = await createMessage({ system: systemPrompt(session.sit, session.targets), messages: session.messages, maxTokens: 4000 });
  session.messages.push({ role: 'assistant', content: res.content }); // keep blocks as-is
  const turn = parseTurn(textOf(res));
  session.turns.push({ who: 'ai', text: turn.reply });
  if (turn.feedback) {
    const last = session.turns.slice().reverse().find((t) => t.who === 'me');
    if (last) last.fb = turn.feedback;
    for (const u of turn.feedback.used || []) {
      const t = session.targets.find((x) => keyOf(x.text) === keyOf(u) || keyOf(u).includes(keyOf(x.text)));
      if (t && !session.used.has(t.id)) {
        session.used.add(t.id);
        // Using a phrase correctly in conversation counts as a successful review.
        if (t.kind === 'word') reviewWord(t.ref, 'good'); else exprSrs.review(t.ref, 'good');
        toast(`"${t.text}" 사용 성공!`, '🎯');
      }
    }
  }
  if (state.settings.talkVoice !== false) sayReply(turn.reply);
}

// ---------- chat ----------
function renderChat() {
  const s = session;
  shell('AI 대화 연습', `
    <p class="muted small">상황: ${esc(s.sit.ko)}</p>
    <div class="targets">${s.targets.map((t) => `<span class="chip ${s.used.has(t.id) ? 'on' : ''}">${s.used.has(t.id) ? '✓ ' : ''}${esc(t.text)}</span>`).join('')}</div>
    <div class="chat" id="chat">${s.turns.map((t, i) => t.who === 'ai'
      ? `<div class="bubble ai"><span>${esc(t.text)}</span><button class="icon-btn" data-say="${i}" aria-label="다시 듣기">🔊</button></div>`
      : `<div class="bubble me"><span>${esc(t.text)}</span></div>
        ${t.fb ? `<div class="fb">
          ${(t.fb.used || []).length ? `<b>✓ ${esc(t.fb.used.join(', '))}</b>` : ''}
          ${(t.fb.misused || []).length ? `<b class="bad">✗ ${esc(t.fb.misused.join(', '))}</b>` : ''}
          ${t.fb.better ? `<span>더 자연스럽게: “${esc(t.fb.better)}”</span>` : ''}
          ${t.fb.tip_ko ? `<small>${esc(t.fb.tip_ko)}</small>` : ''}</div>` : ''}`).join('')}</div>
    <div class="composer">
      <textarea id="msg" rows="2" placeholder="영어로 답해보세요"></textarea>
      <div class="row">
        ${canScore() ? '<button class="ghost" id="mic">🎤 말하기</button>' : ''}
        <button class="card primary slim" id="send">보내기</button>
      </div>
      <div class="row wrap"><button class="ghost" id="hint">💡 힌트</button><button class="ghost danger" id="end">대화 끝내기</button></div>
      <p class="status" id="talkStatus"></p>
    </div>`, { back: '#/' });
  const chat = document.getElementById('chat');
  chat.scrollTop = chat.scrollHeight;
  window.scrollTo(0, document.body.scrollHeight);
  const $msg = document.getElementById('msg');
  const $st = document.getElementById('talkStatus');

  $app.querySelectorAll('[data-say]').forEach((b) => b.onclick = () => { cancelSpeech(); sayReply(s.turns[+b.dataset.say].text); });
  document.getElementById('mic')?.addEventListener('click', async () => {
    cancelSpeech(); player.pause();
    $st.textContent = '듣는 중… 말해보세요';
    try {
      const l = listen((t) => { $msg.value = t; });
      const alts = await l.result;
      $msg.value = alts[0];
      $st.textContent = '확인하고 보내기를 누르세요';
    } catch (e) { $st.textContent = e.message; }
  });
  document.getElementById('send').onclick = async (ev) => {
    const text = $msg.value.trim();
    if (!text) return;
    ev.currentTarget.disabled = true;
    $st.textContent = '상대가 답하는 중…';
    cancelSpeech();
    s.turns.push({ who: 'me', text });
    s.messages.push({ role: 'user', content: text });
    try { await nextTurn(); } catch (e) {
      s.turns.pop(); s.messages.pop();
      toast(e.message);
    }
    renderChat();
  };
  document.getElementById('hint').onclick = () => {
    const left = s.targets.filter((t) => !s.used.has(t.id));
    $st.textContent = left.length ? `아직 안 쓴 표현: ${left.map((t) => t.text).join(' · ')}` : '모든 표현을 다 썼어요! 🎉';
  };
  document.getElementById('end').onclick = () => {
    cancelSpeech();
    toast(`대화 종료 · 표현 ${s.used.size}/${s.targets.length}개 사용`, s.used.size ? '🎯' : '💬');
    session = null;
    go('#/');
  };
}
