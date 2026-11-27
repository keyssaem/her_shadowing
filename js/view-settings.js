import { englishVoices, koreanVoices, speak, cancelSpeech } from './tts.js';
import { OPENAI_VOICES, DEFAULT_HQ_VOICES, getOpenAIKey, setOpenAIKey, speakHq, clearClips, estimateCost } from './hq-tts.js';
import { plannedClips, missingClips, generateClips } from './hq-prep.js';
import { hasScene, translatedCount, translateScene, getKey, setKey } from './translate.js';
import { exportRecordings, importRecordings } from './recorder.js';
import { LS, state, saveSettings, ensurePersistent, $app, esc, sceneById, sceneTitle, dialogueCount, player, loadScene, applyDisplay } from './core.js';
import { importFile, openOnboarding } from './view-home.js';
import { shell, toast } from './ui.js';

// ---------- backup ----------
/** Download a backup file of everything the app keeps here. Returns the recording count. */
export async function makeBackup(withScript = true) {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k.startsWith('her.') || k === 'her.apikey' || k === 'her.dictcache' || (!withScript && k === 'her.script')) continue;
    data[k] = localStorage.getItem(k);
  }
  let recordings = [];
  try { recordings = await exportRecordings(); } catch { /* no recordings store */ }
  const backup = { app: 'her-shadowing', version: 1, exportedAt: new Date().toISOString(), localStorage: data, recordings };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `her-shadowing-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  LS.set('lastBackup', Date.now());
  return recordings.length;
}

/** Remind after 14 days without a backup, once there is something worth keeping. */
export function backupDue() {
  const last = LS.get('lastBackup', 0);
  const st = LS.get('stats', null);
  const worth = (st?.totals?.lines || 0) + (st?.totals?.reviews || 0) + (st?.totals?.recs || 0) * 5 + Object.keys(LS.get('mydict', [])).length * 3 >= 30;
  if (!worth) return null;
  const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
  return days == null || days >= 14 ? { days } : null;
}

// ---------- high-quality voice settings ----------
let genAbort = null;
function bindHqSettings() {
  const s = state.settings;
  const $info = document.getElementById('hqInfo');
  const $st = document.getElementById('hqStatus');
  const refreshInfo = async () => {
    if (!state.script) return;
    const plan = plannedClips(state.script.scenes, state.expressions, s.hqVoices);
    const { missing, chars, usd } = await missingClips(plan);
    const have = plan.length - missing.length;
    if ($info) $info.innerHTML = `대본 음성 ${have} / ${plan.length}개 준비됨${missing.length ? ` · 남은 ${missing.length}개 만들기 예상 비용 약 <b>$${usd.toFixed(2)}</b> (${chars.toLocaleString()}자)` : ' · ✅ 오프라인·화면 꺼짐 재생 준비 완료'}`;
    return missing;
  };
  refreshInfo();

  document.getElementById('saveOai').onclick = () => {
    setOpenAIKey(document.getElementById('oaikey').value);
    if (getOpenAIKey() && !s.hqVoice) s.hqVoice = true;
    saveSettings();
    toast(getOpenAIKey() ? 'OpenAI 키를 저장하고 고품질 음성을 켰어요' : 'OpenAI 키를 지웠어요');
    renderSettings();
  };
  document.getElementById('hqOn').onchange = (e) => { s.hqVoice = e.target.checked; saveSettings(); };
  $app.querySelectorAll('[data-hqv]').forEach((sel) => sel.onchange = () => {
    s.hqVoices = { ...DEFAULT_HQ_VOICES, ...s.hqVoices, [sel.dataset.hqv]: sel.value };
    saveSettings(); refreshInfo();
  });
  const SAMPLE = { theodore: "Hey, how's it going?", samantha: "Hello, I'm here.", female: 'That sounds about right.', male: 'Good to see you, Theodore.', narrator: 'Email from Amy.', korean: '솔직하게 말해두고 싶어.' };
  $app.querySelectorAll('[data-hqtest]').forEach((b) => b.onclick = async () => {
    player.pause(); cancelSpeech();
    const slot = b.dataset.hqtest;
    try { await speakHq(SAMPLE[slot], { voice: (s.hqVoices || {})[slot] || DEFAULT_HQ_VOICES[slot], rate: s.rate }); } catch (e) { toast(e.message === 'no-key' ? 'API 키를 먼저 저장하세요' : e.message); }
  });
  document.getElementById('hqGen').onclick = async (ev) => {
    const missing = await refreshInfo();
    if (!missing?.length) return toast('이미 모두 준비돼 있어요');
    const usd = estimateCost(missing.reduce((n, c) => n + c.text.length, 0));
    if (!confirm(`음성 파일 ${missing.length}개를 만들까요?\n예상 비용 약 $${usd.toFixed(2)} (OpenAI 계정으로 청구)\nWi-Fi에서 하는 걸 권해요.`)) return;
    const btn = ev.currentTarget; btn.disabled = true;
    const $stop = document.getElementById('hqStop'); $stop.hidden = false;
    genAbort = new AbortController();
    $stop.onclick = () => genAbort.abort();
    try {
      const r = await generateClips(missing, (d, t) => { $st.textContent = `만드는 중… ${d} / ${t}`; }, genAbort.signal);
      $st.textContent = genAbort.signal.aborted ? `멈춤: ${r.done}개 만들었어요. 다시 누르면 이어서 만들어요.` : `완료: ${r.done - r.failed}개 만들었어요${r.failed ? ` (실패 ${r.failed}개 — 다시 누르면 재시도)` : ''}.`;
      if (!s.hqVoice) { s.hqVoice = true; saveSettings(); }
    } catch (e) {
      $st.textContent = '멈춤: ' + e.message;
    }
    btn.disabled = false; $stop.hidden = true;
    refreshInfo();
  };
  document.getElementById('hqClear').onclick = async () => {
    if (!confirm('저장된 고품질 음성 파일을 모두 지울까요? 다시 만들면 비용이 들어요.')) return;
    await clearClips();
    toast('음성 파일을 지웠어요');
    refreshInfo();
  };
}

// ---------- settings ----------
export function renderSettings() {
  const s = state.settings;
  const en = englishVoices(), ko = koreanVoices();
  const voiceSel = (slot, label, list) => `
    <label class="field"><span>${label}</span>
      <span class="row"><select data-voice="${slot}">${list.map((v) => `<option value="${esc(v.name)}" ${s.voices[slot] === v.name ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('') || '<option>음성 없음</option>'}</select>
      <button class="icon-btn" data-test="${slot}" aria-label="미리 듣기">▶</button></span></label>`;
  const range = (k, label, min, max, step, fmt = (v) => v) => `
    <label class="field"><span>${label} <b id="v-${k}">${fmt(s[k])}</b></span>
      <input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${s[k]}"></label>`;
  const toggle = (k, label, hint = '') => `
    <label class="switch block"><input type="checkbox" data-t="${k}" ${s[k] ? 'checked' : ''}><span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;

  const fold = (title, sub, inner) => `
    <details class="panel fold"><summary><span><b>${title}</b><small>${sub}</small></span></summary>${inner}</details>`;

  shell('설정', `
    <section class="panel"><h3>화면</h3>
      <div class="field"><span>글자 크기</span>
        <div class="segmented three">${[['m', '보통'], ['l', '크게'], ['xl', '아주 크게']].map(([v, l]) => `<a href="javascript:void 0" role="button" data-size="${v}" class="${s.textSize === v ? 'on' : ''}">${l}</a>`).join('')}</div></div>
      <div class="field"><span>테마</span>
        <div class="segmented three">${[['auto', '자동(폰 설정)'], ['light', '☀️ 밝게'], ['dark', '🌙 어둡게']].map(([v, l]) => `<a href="javascript:void 0" role="button" data-theme-pick="${v}" class="${s.theme === v ? 'on' : ''}">${l}</a>`).join('')}</div></div>
    </section>
    <section class="panel hq"><h3>🎧 고품질 음성 · 화면 꺼져도 재생</h3>
      <p class="muted small">OpenAI 음성으로 대사를 음성 파일로 만들어 이 폰에 저장합니다. 발음이 자연스럽고, <b>화면이 꺼지거나 내비를 띄워도 계속 재생</b>돼요. 한 번 만든 파일은 다시 돈이 들지 않아요. 키(platform.openai.com)는 이 폰에만 저장되고 OpenAI로만 전송됩니다.</p>
      <label class="field"><span>OpenAI API 키</span>
        <span class="row"><input type="password" id="oaikey" class="text-in" placeholder="sk-..." value="${esc(getOpenAIKey())}" autocomplete="off">
        <button class="ghost" id="saveOai">저장</button></span></label>
      <label class="switch block"><input type="checkbox" id="hqOn" ${s.hqVoice ? 'checked' : ''} ${getOpenAIKey() ? '' : 'disabled'}><span>고품질 음성 사용${getOpenAIKey() ? '<small>끄면 기기 음성으로 돌아가요</small>' : '<small class="why">API 키 필요</small>'}</span></label>
      <div class="hq-voices">${[['theodore', 'Theodore'], ['samantha', 'Samantha'], ['female', '다른 여성'], ['male', '다른 남성'], ['narrator', '지문·안내'], ['korean', '한국어']].map(([slot, label]) => `
        <label class="field"><span>${label}</span><span class="row">
          <select data-hqv="${slot}">${OPENAI_VOICES.map((v) => `<option ${((s.hqVoices || {})[slot] || DEFAULT_HQ_VOICES[slot]) === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <button class="icon-btn" data-hqtest="${slot}" aria-label="미리 듣기" ${getOpenAIKey() ? '' : 'disabled'}>▶</button></span></label>`).join('')}</div>
      <p class="muted small" id="hqInfo">저장된 음성 파일 확인 중…</p>
      <div class="row wrap">
        <button class="btn-primary" id="hqGen" ${getOpenAIKey() ? '' : 'disabled'}>⬇ 대본 전체 음성 미리 만들기${getOpenAIKey() ? '' : '<small class="why">API 키 필요</small>'}</button>
        <button class="ghost" id="hqStop" hidden>멈추기</button>
        <button class="ghost danger" id="hqClear">음성 파일 지우기</button>
      </div>
      <p class="status" id="hqStatus"></p>
    </section>
    <section class="panel"><h3>자주 쓰는 설정</h3>
      ${range('rate', '말하기 속도', 0.6, 1.3, 0.05, (v) => v + '×')}
      ${range('repeat', '따라 말하기 반복 횟수', 1, 4, 1, (v) => v + '회')}
      ${range('gapFactor', '따라 말할 시간', 0.8, 2.5, 0.1, (v) => '대사 길이 × ' + v)}
      ${range('dailyGoal', '하루 목표', 5, 60, 5, (v) => v + '분')}
      ${voiceSel('theodore', 'Theodore 목소리', en)}
      ${voiceSel('samantha', 'Samantha 목소리', en)}
    </section>
    ${fold('재생 세부 설정', '속도 자동 단계 · 응원 메시지 · 화면 켜두기 등', `
      ${toggle('autoSpeed', '장면 속도 자동 단계', '장면을 끝까지 할 때마다 "말하기 속도" −0.15 → −0.05 → 그대로. 예: 0.95면 0.8 → 0.9 → 0.95배')}
      ${toggle('voiceMotivation', '응원 메시지 음성으로 듣기', '재생 중 카드 사이에 짧게 한국어+영어로')}
      ${toggle('wakeLock', '재생 중 화면 켜두기')}
      ${toggle('drillKoreanFirst', '표현 복습: 한국어 뜻 먼저', '끄면 영어만 반복')}
      ${toggle('roleReveal', '역할 연기: 내 차례 뒤 정답 들려주기')}
      ${toggle('narration', '지문(장면 묘사)도 읽기', '듣기 연습용. 따라 말할 시간 없이 읽음')}
      ${toggle('loopScene', '장면 끝나면 처음부터 반복')}`)}
    ${fold('목소리 더보기', '다른 인물 · 지문 · 한국어 목소리', `
      ${voiceSel('female', '다른 여성 인물', en)}
      ${voiceSel('male', '다른 남성 인물', en)}
      ${voiceSel('narrator', '지문 · TEXT VOICE', en)}
      ${voiceSel('korean', '한국어 뜻', ko)}
      <p class="muted small">기기에 설치된 음성을 씁니다. Android는 'Google 텍스트 음성 변환', iPhone은 설정 › 손쉬운 사용 › 음성 콘텐츠 › 음성에서 고품질(향상된) 영어 음성을 받으면 훨씬 자연스러워집니다.</p>`)}
    <details class="panel fold"><summary><span><b>한국어 해석 · AI 대화 (Claude API)</b><small>${getKey() ? 'API 키 저장됨' : 'API 키 필요'}</small></span></summary>
      <p class="muted small">대사를 Claude로 번역해 이 기기에만 저장합니다. 본인의 Anthropic API 키가 필요하고(console.anthropic.com), 키는 이 기기에만 저장되며 번역할 대사와 함께 Anthropic API로만 전송됩니다. 대본 전체 해석 비용은 대략 1~2달러로 예상됩니다.</p>
      <label class="field"><span>API 키</span>
        <span class="row"><input type="password" id="apikey" class="text-in" placeholder="sk-ant-..." value="${esc(getKey())}" autocomplete="off">
        <button class="ghost" id="saveKey">저장</button></span></label>
      ${toggle('showKo', '장면에서 해석 보기', '드라이브 화면에도 대사 아래 표시')}
      <p class="muted small">해석된 장면: <b id="koCount">${translatedCount()}</b> / ${state.script ? state.script.scenes.filter((x) => dialogueCount(x) > 0).length : 0}</p>
      <div class="row wrap"><button class="ghost" id="koAll" ${getKey() ? '' : 'disabled'}>남은 장면 모두 해석하기${getKey() ? '' : '<small class="why">API 키 필요</small>'}</button></div>
      <p id="koStatus" class="status"></p>
    </details>
    <details class="panel fold"><summary><span><b>학습 데이터 백업</b><small>폰을 바꾸기 전에 꼭</small></span></summary>
      <p class="muted small">진도·내 단어장·점수·연속 학습일·편지·해석·녹음을 파일 하나로 저장합니다. 폰을 바꾸거나 크롬 데이터를 지우기 전에 받아두세요. API 키는 백업에 넣지 않습니다.</p>
      <label class="switch block"><input type="checkbox" id="bkScript" checked><span>대본 데이터도 포함<small>끄면 복원 후 PDF를 다시 불러와야 해요</small></span></label>
      <div class="row wrap">
        <button class="ghost" id="backup">⬇ 백업 파일 만들기</button>
        <label class="ghost">⬆ 백업에서 복원<input type="file" id="restore" accept=".json,application/json" hidden></label>
      </div>
      <p id="bkStatus" class="status"></p>
    </details>
    <details class="panel fold"><summary><span><b>대본 데이터 · 초기화</b><small>다시 불러오기 · 저장 상태 · 기록 초기화</small></span></summary>
      ${state.script ? `<p class="muted small">불러온 대본: 장면 ${state.script.stats.scenes}개 · 대사 ${state.script.stats.dialogue}줄</p>
      <p class="muted small" id="persist">저장 상태 확인 중…</p>` : ''}
      <div class="row wrap">
        ${state.script ? '<button class="ghost" id="export">대본 데이터 내보내기 (.json)</button>' : ''}
        <label class="ghost">다시 불러오기<input type="file" id="reimport" accept=".pdf,.json" hidden></label>
        <button class="ghost danger" id="reset">학습 기록 초기화</button>
      </div>
      <p id="status" class="status"></p>
    </details>
    <button class="ghost block" id="guideAgain">📘 사용 안내 다시 보기</button>`, { back: '#/' });
  document.getElementById('guideAgain').onclick = () => openOnboarding();
  bindHqSettings();
  $app.querySelectorAll('[data-size]').forEach((b) => b.onclick = (ev) => {
    ev.preventDefault();
    s.textSize = b.dataset.size; saveSettings(); applyDisplay(); renderSettings();
  });
  $app.querySelectorAll('[data-theme-pick]').forEach((b) => b.onclick = (ev) => {
    ev.preventDefault();
    s.theme = b.dataset.themePick; saveSettings(); applyDisplay(); renderSettings();
  });

  $app.querySelectorAll('[data-k]').forEach((r) => r.oninput = () => {
    s[r.dataset.k] = +r.value; saveSettings();
    const fmt = { rate: (v) => v + '×', repeat: (v) => v + '회', gapFactor: (v) => '대사 길이 × ' + v, dailyGoal: (v) => v + '분' }[r.dataset.k];
    document.getElementById('v-' + r.dataset.k).textContent = fmt(+r.value);
  });
  $app.querySelectorAll('[data-t]').forEach((c) => c.onchange = () => {
    s[c.dataset.t] = c.checked; saveSettings();
    if (c.dataset.t === 'narration' && player.kind === 'scene' && player.sceneId) loadScene(sceneById(player.sceneId), { index: 0 });
  });
  $app.querySelectorAll('[data-voice]').forEach((sel) => sel.onchange = () => { s.voices[sel.dataset.voice] = sel.value; saveSettings(); });
  const SAMPLES = { theodore: "Hey, how's it going?", samantha: "Hello, I'm here.", female: "That sounds about right.", male: 'Good to see you, Theodore.', narrator: 'Email from Amy.', korean: '솔직하게 말해두고 싶어.' };
  $app.querySelectorAll('[data-test]').forEach((b) => b.onclick = () => {
    player.pause(); cancelSpeech();
    const slot = b.dataset.test;
    speak(SAMPLES[slot], { voiceName: s.voices[slot], rate: s.rate, lang: slot === 'korean' ? 'ko-KR' : 'en-US' });
  });
  const $st = document.getElementById('status');
  const $persist = document.getElementById('persist');
  if ($persist) ensurePersistent().then((ok) => {
    $persist.textContent = ok ? '🔒 영구 저장 켜짐 — 브라우저가 대본을 자동으로 지우지 않습니다.'
      : ok === false ? '⚠ 영구 저장이 허용되지 않았습니다. 홈 화면에 앱을 추가하면 대부분 허용됩니다.'
      : '이 브라우저는 영구 저장 상태를 알려주지 않습니다.';
  });
  document.getElementById('export')?.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state.script)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'her-script.json' });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  const $re = document.getElementById('reimport');
  $re.onchange = () => $re.files[0] && importFile($re.files[0], $st);

  // Korean translation
  document.getElementById('saveKey').onclick = () => {
    setKey(document.getElementById('apikey').value);
    toast(getKey() ? 'API 키를 저장했어요 (이 기기에만)' : 'API 키를 지웠어요');
    const all = document.getElementById('koAll');
    all.disabled = !getKey();
    all.innerHTML = '남은 장면 모두 해석하기' + (getKey() ? '' : '<small class="why">API 키 필요</small>');
  };
  document.getElementById('koAll').onclick = async (ev) => {
    if (!getKey()) return toast('API 키를 먼저 저장하세요.');
    const btn = ev.currentTarget;
    const $ks = document.getElementById('koStatus');
    const todo = state.script.scenes.filter((x) => dialogueCount(x) > 0 && !hasScene(x.id));
    if (!todo.length) { $ks.textContent = '모든 장면이 이미 해석돼 있어요.'; return; }
    if (!confirm(`${todo.length}개 장면을 해석할까요? API 사용 요금이 청구됩니다.`)) return;
    btn.disabled = true;
    let done = 0;
    for (const sc of todo) {
      $ks.textContent = `해석 중… ${done}/${todo.length} · ${sceneTitle(sc)}`;
      try {
        await translateScene(sc.id, sceneTitle(sc), sc.items.map((it, i) => ({ ...it, itemIndex: i })).filter((it) => it.t === 'd'));
        done++;
        const c = document.getElementById('koCount'); if (c) c.textContent = translatedCount();
      } catch (e) {
        $ks.textContent = `멈춤 (${done}/${todo.length}): ${e.message}`;
        btn.disabled = false;
        return;
      }
    }
    btn.disabled = false;
    $ks.textContent = `완료: ${done}개 장면을 해석했어요.`;
    if (!s.showKo) { s.showKo = true; saveSettings(); const t = $app.querySelector('[data-t="showKo"]'); if (t) t.checked = true; }
  };

  // Backup / restore of everything the app keeps on this device
  const $bk = document.getElementById('bkStatus');
  document.getElementById('backup').onclick = async () => {
    $bk.textContent = '백업 만드는 중…';
    const n = await makeBackup(document.getElementById('bkScript').checked);
    $bk.textContent = `백업 완료: 녹음 ${n}개 포함. 파일을 Google Drive 등에 보관하세요.`;
  };
  const $rs = document.getElementById('restore');
  $rs.onchange = async () => {
    const f = $rs.files[0]; if (!f) return;
    try {
      const b = JSON.parse(await f.text());
      if (b?.app !== 'her-shadowing' || !b.localStorage) throw new Error('이 앱의 백업 파일이 아니에요.');
      if (!confirm(`${new Date(b.exportedAt).toLocaleString('ko-KR')} 백업으로 복원할까요? 지금 기기의 학습 기록과 녹음은 백업 내용으로 바뀝니다.`)) return;
      $bk.textContent = '복원 중…';
      const keep = new Set(['her.apikey', 'her.dictcache', ...(b.localStorage['her.script'] ? [] : ['her.script'])]);
      Object.keys(localStorage).filter((k) => k.startsWith('her.') && !keep.has(k)).forEach((k) => localStorage.removeItem(k));
      Object.entries(b.localStorage).forEach(([k, v]) => localStorage.setItem(k, v));
      await importRecordings(b.recordings || []);
      $bk.textContent = '복원 완료. 앱을 다시 불러옵니다…';
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      $bk.textContent = '복원 실패: ' + e.message;
    }
  };
  document.getElementById('reset').onclick = () => {
    if (!confirm('진도·완료 장면·익힌 표현 기록을 지울까요? (대본은 유지)')) return;
    state.done.clear(); state.mastered.clear(); state.progress = null;
    ['done', 'mastered', 'progress'].forEach(LS.del);
    $st.textContent = '학습 기록을 초기화했습니다.';
  };
}
