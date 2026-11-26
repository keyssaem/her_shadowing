import { englishVoices, koreanVoices, speak, cancelSpeech } from './tts.js';
import { hasScene, translatedCount, translateScene, getKey, setKey } from './translate.js';
import { exportRecordings, importRecordings } from './recorder.js';
import { LS, state, saveSettings, ensurePersistent, $app, esc, sceneById, sceneTitle, dialogueCount, player, loadScene } from './core.js';
import { importFile } from './view-home.js';
import { shell, toast } from './ui.js';

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

  shell('설정', `
    <section class="panel"><h3>재생</h3>
      ${range('rate', '말하기 속도', 0.6, 1.3, 0.05, (v) => v + '×')}
      ${range('repeat', '쉐도잉 반복 횟수', 1, 4, 1, (v) => v + '회')}
      ${range('gapFactor', '따라 말할 시간', 0.8, 2.5, 0.1, (v) => '대사 길이 × ' + v)}
      ${toggle('narration', '지문(장면 묘사)도 읽기', '듣기 연습용. 쉐도잉 간격 없이 읽음')}
      ${toggle('roleReveal', '롤플레이: 내 차례 뒤 정답 들려주기')}
      ${toggle('drillKoreanFirst', '표현 드라이브: 한국어 뜻 먼저', '끄면 영어만 반복')}
      ${toggle('loopScene', '장면 끝나면 처음부터 반복')}
      ${toggle('wakeLock', '재생 중 화면 켜두기')}
      ${toggle('voiceMotivation', '응원 메시지 음성으로 듣기', '재생 중 카드 사이에 짧게 한국어+영어로')}
      ${range('dailyGoal', '하루 목표', 5, 60, 5, (v) => v + '분')}
      ${toggle('autoSpeed', '장면 속도 자동 단계', '장면을 끝까지 할 때마다 "말하기 속도" −0.15 → −0.05 → 그대로. 예: 0.95면 0.8 → 0.9 → 0.95배')}
    </section>
    <section class="panel"><h3>한국어 해석 (Claude API)</h3>
      <p class="muted small">대사를 Claude로 번역해 이 기기에만 저장합니다. 본인의 Anthropic API 키가 필요하고(console.anthropic.com), 키는 이 기기에만 저장되며 번역할 대사와 함께 Anthropic API로만 전송됩니다. 대본 전체 해석 비용은 대략 1~2달러로 예상됩니다.</p>
      <label class="field"><span>API 키</span>
        <span class="row"><input type="password" id="apikey" class="text-in" placeholder="sk-ant-..." value="${esc(getKey())}" autocomplete="off">
        <button class="ghost" id="saveKey">저장</button></span></label>
      ${toggle('showKo', '장면에서 해석 보기', '드라이브 화면에도 대사 아래 표시')}
      <p class="muted small">해석된 장면: <b id="koCount">${translatedCount()}</b> / ${state.script ? state.script.scenes.filter((x) => dialogueCount(x) > 0).length : 0}</p>
      <div class="row wrap"><button class="ghost" id="koAll">남은 장면 모두 해석하기</button></div>
      <p id="koStatus" class="status"></p>
    </section>
    <section class="panel"><h3>학습 데이터 백업</h3>
      <p class="muted small">진도·Drill Dictionary·점수·연속 학습일·편지·해석·녹음을 파일 하나로 저장합니다. 폰을 바꾸거나 크롬 데이터를 지우기 전에 받아두세요. API 키는 백업에 넣지 않습니다.</p>
      <label class="switch block"><input type="checkbox" id="bkScript" checked><span>대본 데이터도 포함<small>끄면 복원 후 PDF를 다시 불러와야 해요</small></span></label>
      <div class="row wrap">
        <button class="ghost" id="backup">⬇ 백업 파일 만들기</button>
        <label class="ghost">⬆ 백업에서 복원<input type="file" id="restore" accept=".json,application/json" hidden></label>
      </div>
      <p id="bkStatus" class="status"></p>
    </section>
    <section class="panel"><h3>목소리</h3>
      ${voiceSel('theodore', 'Theodore', en)}
      ${voiceSel('samantha', 'Samantha', en)}
      ${voiceSel('female', '다른 여성 인물', en)}
      ${voiceSel('male', '다른 남성 인물', en)}
      ${voiceSel('narrator', '지문 · TEXT VOICE', en)}
      ${voiceSel('korean', '한국어 뜻', ko)}
      <p class="muted small">기기에 설치된 음성을 씁니다. Android는 'Google 텍스트 음성 변환', iPhone은 설정 › 손쉬운 사용 › 음성 콘텐츠 › 음성에서 고품질(향상된) 영어 음성을 받으면 훨씬 자연스러워집니다.</p>
    </section>
    <section class="panel"><h3>데이터</h3>
      ${state.script ? `<p class="muted small">불러온 대본: 장면 ${state.script.stats.scenes}개 · 대사 ${state.script.stats.dialogue}줄</p>
      <p class="muted small" id="persist">저장 상태 확인 중…</p>` : ''}
      <div class="row wrap">
        ${state.script ? '<button class="ghost" id="export">대본 데이터 내보내기 (.json)</button>' : ''}
        <label class="ghost">다시 불러오기<input type="file" id="reimport" accept=".pdf,.json" hidden></label>
        <button class="ghost danger" id="reset">학습 기록 초기화</button>
      </div>
      <p id="status" class="status"></p>
    </section>`, { back: '#/' });

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
    const withScript = document.getElementById('bkScript').checked;
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
    $bk.textContent = `백업 완료: 녹음 ${recordings.length}개 포함. 파일을 Google Drive 등에 보관하세요.`;
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
