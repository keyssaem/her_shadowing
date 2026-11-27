// Step-based playback engine. Each "track" is a list of cards; each card expands
// into steps (speak / wait / beep) according to the current mode and settings.
// Designed for hands-free use: Media Session hooks map headset / steering-wheel
// buttons to play, pause, next and previous.

import { speak, cancelSpeech, estimateSeconds, speakable, roleOf, pitchOf, isHqOn } from './tts.js';
import { beepHq } from './hq-tts.js';

let audioCtx = null;
function beep(freq = 880, ms = 140) {
  // With high-quality voices on, tones are real audio files too (screen-off safe).
  if (isHqOn()) return beepHq(freq, ms);
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + ms / 1000 + 0.05);
  } catch { /* audio not available */ }
  return new Promise((r) => setTimeout(r, ms + 60));
}

// A looping near-silent audio element keeps a Media Session alive so hardware
// media buttons reach the page.
function silentWavUrl(seconds = 2) {
  const rate = 8000, n = rate * seconds;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true);
  v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/** Split a long line into shadowable chunks of whole sentences. */
export function chunkLine(text, maxWords = 16) {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [text];
  const out = [];
  let cur = [];
  const words = (s) => s.trim().split(/\s+/).length;
  for (const s of sentences) {
    const cw = cur.reduce((n, x) => n + words(x), 0);
    if (cur.length && cw + words(s) > maxWords) { out.push(cur.join(' ').trim()); cur = []; }
    cur.push(s.trim());
  }
  if (cur.length) out.push(cur.join(' ').trim());
  return out.filter(Boolean);
}

export class Player {
  constructor({ getSettings, onChange }) {
    this.getSettings = getSettings;
    this.onChange = onChange;
    this.cards = [];
    this.index = 0;
    this.playing = false;
    this.token = 0;
    this.status = '';
    this.title = '';
    this.kind = 'scene'; // 'scene' | 'drill'
    this.keepAlive = null;
    this.wakeLock = null;
    this.queue = []; // announcements spoken between cards (motivation messages)
    this.setupMediaSession();
    // Browsers drop the screen wake lock whenever the page is hidden (e.g. a
    // quick look at the navigation app). Take it again when we come back.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.playing) this.requestWakeLock();
    });
  }

  load({ cards, index = 0, title = '', kind = 'scene' }) {
    this.stop();
    this.cards = cards;
    this.index = Math.min(index, Math.max(0, cards.length - 1));
    this.title = title;
    this.kind = kind;
    this.emit();
  }

  get current() { return this.cards[this.index]; }

  emit() {
    this.onChange?.(this);
    if ('mediaSession' in navigator && this.current) {
      const c = this.current;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: (c.kind === 'line' && c.sp ? c.sp + ': ' : '') + (c.text || c.en || c.ko || '').slice(0, 80),
          artist: this.title,
          album: 'Her Shadowing',
        });
        navigator.mediaSession.playbackState = this.playing ? 'playing' : 'paused';
      } catch { /* ignore */ }
    }
  }

  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (a, h) => { try { ms.setActionHandler(a, h); } catch { /* unsupported */ } };
    set('play', () => this.play());
    set('pause', () => this.pause());
    set('nexttrack', () => this.next());
    set('previoustrack', () => this.replay());
    set('seekforward', () => this.next());
    set('seekbackward', () => this.prev());
  }

  async startKeepAlive() {
    if (!this.keepAlive) {
      this.keepAlive = new Audio(silentWavUrl());
      this.keepAlive.loop = true;
      this.keepAlive.volume = 0.01;
    }
    try { await this.keepAlive.play(); } catch { /* needs gesture */ }
    await this.requestWakeLock();
  }
  async requestWakeLock() {
    if (!('wakeLock' in navigator) || !this.getSettings().wakeLock) return;
    if (this.wakeLock && !this.wakeLock.released) return;
    try { this.wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not allowed right now */ }
  }
  stopKeepAlive() {
    try { this.keepAlive?.pause(); } catch { /* ignore */ }
    try { this.wakeLock?.release(); } catch { /* ignore */ }
    this.wakeLock = null;
  }

  play() {
    if (!this.cards.length) return;
    if (this.playing) return;
    this.playing = true;
    this.startKeepAlive();
    this.run();
  }
  pause() {
    this.playing = false;
    this.token++;
    cancelSpeech();
    this.stopKeepAlive();
    this.status = '';
    this.emit();
  }
  stop() { this.pause(); }
  toggle() { this.playing ? this.pause() : this.play(); }

  jump(i) {
    const wasPlaying = this.playing;
    this.token++;
    cancelSpeech();
    this.index = Math.max(0, Math.min(i, this.cards.length - 1));
    this.playing = false;
    this.emit();
    if (wasPlaying) this.play();
  }
  // During an audio quiz question, the media buttons answer instead of moving:
  // next track = option 1, previous track = option 2.
  next() { if (this.answer(1)) return; this.jump(this.index + 1); }
  prev() { if (this.answer(2)) return; this.jump(this.index - 1); }
  replay() { if (this.answer(2)) return; this.onReplay?.(this.current); this.jump(this.index); }

  /** Resolve a pending audio-quiz answer (1 or 2). Returns true if one was waiting. */
  answer(choice) {
    if (!this.awaiting) return false;
    const resolve = this.awaiting;
    this.awaiting = null;
    resolve(choice);
    this.emit();
    return true;
  }
  waitAnswer(ms, token) {
    return new Promise((resolve) => {
      this.awaiting = resolve;
      this.emit(); // let the on-screen answer buttons enable now
      const end = Date.now() + ms;
      const tick = () => {
        if (this.awaiting !== resolve) return; // answered
        if (token !== this.token || Date.now() >= end) { this.awaiting = null; resolve(0); return; }
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  async sleep(ms, token) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (token !== this.token) return false;
      await new Promise((r) => setTimeout(r, Math.min(150, end - Date.now())));
    }
    return token === this.token;
  }

  /** Queue steps to be spoken at the next card boundary. */
  announce(steps) { this.queue.push(...steps); }

  async flushAnnouncements(token) {
    while (this.queue.length) {
      if (token !== this.token) { this.queue = []; return false; }
      const st = this.queue.shift();
      this.status = st.label || '💬';
      this.chunk = null;
      this.emit();
      if (st.type === 'speak') await speak(st.text, st);
      else if (st.type === 'wait') { if (!(await this.sleep(st.ms, token))) return false; }
      else if (st.type === 'beep') await beep(st.freq);
    }
    return token === this.token;
  }

  async run() {
    const token = ++this.token;
    while (this.playing && token === this.token && this.index < this.cards.length) {
      this.emit();
      const steps = this.stepsFor(this.current);
      for (const st of steps) {
        if (token !== this.token) return;
        this.status = st.label || '';
        this.chunk = st.chunk || null;
        // Expose the current pause so the UI can show a countdown bar.
        const timed = st.type === 'wait' || st.type === 'answer';
        this.waitMs = timed ? st.ms : 0;
        this.waitEnd = timed ? Date.now() + st.ms : 0;
        this.emit();
        if (st.type === 'speak') await speak(st.text, st);
        else if (st.type === 'wait') { const ok = await this.sleep(st.ms, token); this.waitEnd = 0; if (!ok) return; }
        else if (st.type === 'answer') {
          const choice = await this.waitAnswer(st.ms, token);
          this.waitEnd = 0;
          if (token !== this.token) return;
          // Feedback for the answer is spoken right away (correct / wrong / timeout).
          for (const f of this.onAnswer?.(this.current, choice) || []) {
            if (token !== this.token) return;
            this.status = f.label || this.status; this.emit();
            if (f.type === 'speak') await speak(f.text, f);
            else if (f.type === 'wait') { if (!(await this.sleep(f.ms, token))) return; }
            else if (f.type === 'beep') await beep(f.freq, f.dur);
          }
        }
        else if (st.type === 'beep') await beep(st.freq);
      }
      if (token !== this.token) return;
      this.onCardDone?.(this.current, this.index);
      if (this.index >= this.cards.length - 1) {
        if (this.getSettings().loopScene) {
          this.onFinished?.();
          if (!(await this.flushAnnouncements(token))) return;
          this.index = 0;
          continue;
        }
        this.onFinished?.();
        if (!(await this.flushAnnouncements(token))) return;
        this.playing = false;
        this.status = '끝';
        this.stopKeepAlive();
        this.emit();
        return;
      }
      if (!(await this.flushAnnouncements(token))) return;
      this.index++;
    }
  }

  stepsFor(card) {
    const s = this.getSettings();
    const rate = card.rate ?? s.rate; // scene lines may carry an auto speed step
    // Android often exposes a single genderless voice per locale. When a male role
    // ends up on the same voice as Samantha, lower its pitch so speakers stay distinct.
    const voiceFor = (sp) => {
      const role = roleOf(sp);
      const voiceName = s.voices[role];
      let pitch = pitchOf(sp);
      if ((role === 'theodore' || role === 'male') && voiceName && voiceName === s.voices.samantha) pitch *= 0.8;
      return { voiceName, pitch, rate };
    };
    const gapMs = (text) => Math.round(estimateSeconds(text, rate) * s.gapFactor * 1000) + 400;
    const steps = [];

    if (card.kind === 'missionBrief') {
      // Morning: today's real-life mission (situation in Korean, the phrase in English).
      const m = card.m;
      const ko = { voiceName: s.voices.korean, lang: 'ko-KR', rate: 1.05 };
      steps.push({ type: 'beep', freq: 1046, label: '🎯 오늘의 실전 미션' });
      steps.push({ type: 'speak', text: `오늘의 실전 미션. ${m.situation} 이 표현을 한 번 써보세요.`, ...ko, label: `🎯 ${m.situation}` });
      for (let r = 0; r < 2; r++) {
        steps.push({ type: 'speak', text: speakable(m.en), voiceName: s.voices.samantha, rate, slot: 'samantha', label: `🎯 ${m.en}` });
        steps.push({ type: 'wait', ms: 900 });
      }
      steps.push({ type: 'speak', text: m.ko, ...ko, label: `🎯 ${m.ko}` });
      steps.push({ type: 'wait', ms: 400 });
      return steps;
    }

    if (card.kind === 'mission') {
      // Evening check-in, answered with the buttons: 1 = used it, 2 = not yet.
      const m = card.m;
      const ko = { voiceName: s.voices.korean, lang: 'ko-KR', rate: 1.05 };
      steps.push({ type: 'beep', freq: 1046, label: '🎯 미션 체크' });
      steps.push({ type: 'speak', text: '오늘의 미션, 써봤나요?', ...ko, label: '🎯 오늘의 미션, 써봤나요?' });
      steps.push({ type: 'speak', text: speakable(m.en), voiceName: s.voices.samantha, rate, slot: 'samantha', label: `🎯 ${m.en}` });
      steps.push({ type: 'speak', text: '써봤으면 다음 곡, 못 썼으면 이전 곡 버튼을 누르세요.', ...ko, label: '1 = 써봤어요 · 2 = 못 썼어요' });
      steps.push({ type: 'beep', freq: 1175 });
      steps.push({ type: 'answer', ms: 8000, label: '🎯 다음 곡 = 써봤어요 · 이전 곡 = 못 썼어요' });
      return steps;
    }

    if (card.kind === 'two') {
      // Audio two-choice quiz: Korean meaning, then "1번 ..., 2번 ...", then answer by button.
      const q = card.q;
      const en = { voiceName: s.voices.samantha, rate, pitch: 1 };
      const ko = { voiceName: s.voices.korean, lang: 'ko-KR', rate: 1.05 };
      steps.push({ type: 'beep', freq: 988, label: '🎮 퀴즈' });
      steps.push({ type: 'speak', text: q.prompt, ...ko, label: `🎮 "${q.prompt}" 영어로는?` });
      steps.push({ type: 'speak', text: '1번', ...ko, label: '1번' });
      steps.push({ type: 'speak', text: speakable(q.options[0]), ...en, label: `1번 · ${q.options[0]}` });
      steps.push({ type: 'speak', text: '2번', ...ko, label: '2번' });
      steps.push({ type: 'speak', text: speakable(q.options[1]), ...en, label: `2번 · ${q.options[1]}` });
      steps.push({ type: 'beep', freq: 1175 });
      steps.push({ type: 'answer', ms: 7000, label: '🎮 1번 = 다음 곡 · 2번 = 이전 곡' });
      return steps;
    }

    if (card.kind === 'cue') {
      // Spoken section announcement inside a drive session.
      steps.push({ type: 'beep', freq: 784, label: '🚗 ' + card.ko });
      steps.push({ type: 'speak', text: card.ko, voiceName: s.voices.korean, lang: 'ko-KR', rate: 1.05, label: '🚗 ' + card.ko });
      steps.push({ type: 'wait', ms: 400 });
      return steps;
    }

    if (card.kind === 'action') {
      steps.push({ type: 'speak', text: speakable(card.text), ...voiceFor(null), rate: rate * 1.05, label: '📜 장면 설명' });
      steps.push({ type: 'wait', ms: 300 });
      return steps;
    }

    if (card.kind === 'expr') {
      if (s.drillKoreanFirst && card.ko) {
        steps.push({ type: 'speak', text: card.ko, voiceName: s.voices.korean, lang: 'ko-KR', rate: 1, label: '🇰🇷 뜻을 들어요' });
        steps.push({ type: 'beep', freq: 660 });
        steps.push({ type: 'wait', ms: gapMs(card.en), label: '🗣 영어로 말해보세요' });
      }
      for (let r = 0; r < s.repeat; r++) {
        steps.push({ type: 'speak', text: speakable(card.en), ...voiceFor(card.sp || 'SAMANTHA'), label: '🎧 들어보세요' });
        steps.push({ type: 'wait', ms: gapMs(card.en), label: '🗣 따라 말하세요' });
      }
      if (card.source) {
        steps.push({ type: 'speak', text: speakable(card.source.text), ...voiceFor(card.source.sp), label: '🎬 영화 속 대사' });
        steps.push({ type: 'wait', ms: 700 });
      }
      return steps;
    }

    if (card.kind === 'word') {
      // word → (repeat) → English definition → Korean note → context chunk to shadow → word
      const wordVoice = { voiceName: s.voices.samantha, rate, pitch: 1 };
      for (let r = 0; r < s.repeat; r++) {
        steps.push({ type: 'speak', text: card.text, ...wordVoice, label: '🎧 단어를 들어요' });
        steps.push({ type: 'wait', ms: gapMs(card.text), label: '🗣 따라 말하세요' });
      }
      if (card.def) {
        steps.push({ type: 'speak', text: (card.pos ? card.pos + '. ' : '') + card.def, voiceName: s.voices.narrator, rate, label: '📖 영어 뜻' });
        steps.push({ type: 'wait', ms: 500 });
      }
      if (card.ko) {
        steps.push({ type: 'speak', text: card.ko, voiceName: s.voices.korean, lang: 'ko-KR', rate: 1, label: '🇰🇷 한국어' });
        steps.push({ type: 'wait', ms: 400 });
      }
      if (card.ctx?.text) {
        const chunks = chunkLine(card.ctx.text);
        const lc = card.text.toLowerCase();
        const chunk = chunks.find((c) => c.toLowerCase().includes(lc)) || chunks[0];
        steps.push({ type: 'speak', text: speakable(chunk), ...voiceFor(card.ctx.sp), label: '🎬 대사 속에서' });
        steps.push({ type: 'wait', ms: gapMs(chunk), label: '🗣 따라 말하세요' });
      }
      steps.push({ type: 'speak', text: card.text, ...wordVoice, label: '🎧 단어를 들어요' });
      steps.push({ type: 'wait', ms: 600 });
      return steps;
    }

    // Dialogue line
    const text = speakable(card.text);
    const mode = s.mode;
    if (mode === 'listen') {
      steps.push({ type: 'speak', text, ...voiceFor(card.sp), label: '🎧 들어보세요' });
      steps.push({ type: 'wait', ms: 350 });
      return steps;
    }
    if (mode === 'role' && card.sp === s.myRole) {
      steps.push({ type: 'beep', freq: 880 });
      steps.push({ type: 'wait', ms: gapMs(card.text), label: '🗣 내 차례! 말해보세요' });
      if (s.roleReveal) steps.push({ type: 'speak', text, ...voiceFor(card.sp), label: '✅ 정답 확인' });
      steps.push({ type: 'wait', ms: 350 });
      return steps;
    }
    if (mode === 'role') {
      steps.push({ type: 'speak', text, ...voiceFor(card.sp), label: '🎧 상대 대사' });
      steps.push({ type: 'wait', ms: 300 });
      return steps;
    }
    // shadow
    const chunks = chunkLine(text);
    for (const chunk of chunks) {
      const shown = chunks.length > 1 ? chunk : null;
      for (let r = 0; r < s.repeat; r++) {
        steps.push({ type: 'speak', text: chunk, ...voiceFor(card.sp), label: r ? `🎧 한 번 더 (${r + 1}/${s.repeat})` : '🎧 들어보세요', chunk: shown });
        steps.push({ type: 'wait', ms: gapMs(chunk), label: '🗣 따라 말하세요', chunk: shown });
      }
    }
    return steps;
  }
}
