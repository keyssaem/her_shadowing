// Step-based playback engine. Each "track" is a list of cards; each card expands
// into steps (speak / wait / beep) according to the current mode and settings.
// Designed for hands-free use: Media Session hooks map headset / steering-wheel
// buttons to play, pause, next and previous.

import { speak, cancelSpeech, estimateSeconds, speakable, roleOf, pitchOf } from './tts.js';

let audioCtx = null;
function beep(freq = 880, ms = 140) {
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
    this.setupMediaSession();
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
          title: (c.sp ? c.sp + ': ' : '') + (c.text || c.en || '').slice(0, 80),
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
    try { if ('wakeLock' in navigator && this.getSettings().wakeLock) this.wakeLock = await navigator.wakeLock.request('screen'); } catch { /* ignore */ }
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
  next() { this.jump(this.index + 1); }
  prev() { this.jump(this.index - 1); }
  replay() { this.jump(this.index); }

  async sleep(ms, token) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (token !== this.token) return false;
      await new Promise((r) => setTimeout(r, Math.min(150, end - Date.now())));
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
        this.emit();
        if (st.type === 'speak') await speak(st.text, st);
        else if (st.type === 'wait') { if (!(await this.sleep(st.ms, token))) return; }
        else if (st.type === 'beep') await beep(st.freq);
      }
      if (token !== this.token) return;
      this.onCardDone?.(this.current, this.index);
      if (this.index >= this.cards.length - 1) {
        if (this.getSettings().loopScene) { this.index = 0; continue; }
        this.playing = false;
        this.status = '끝';
        this.stopKeepAlive();
        this.onFinished?.();
        this.emit();
        return;
      }
      this.index++;
    }
  }

  stepsFor(card) {
    const s = this.getSettings();
    const rate = s.rate;
    const voiceFor = (sp) => ({ voiceName: s.voices[roleOf(sp)], pitch: pitchOf(sp), rate });
    const gapMs = (text) => Math.round(estimateSeconds(text, rate) * s.gapFactor * 1000) + 400;
    const steps = [];

    if (card.kind === 'action') {
      steps.push({ type: 'speak', text: speakable(card.text), ...voiceFor(null), rate: rate * 1.05, label: '지문' });
      steps.push({ type: 'wait', ms: 300 });
      return steps;
    }

    if (card.kind === 'expr') {
      if (s.drillKoreanFirst && card.ko) {
        steps.push({ type: 'speak', text: card.ko, voiceName: s.voices.korean, lang: 'ko-KR', rate: 1, label: '한국어 뜻' });
        steps.push({ type: 'beep', freq: 660 });
        steps.push({ type: 'wait', ms: gapMs(card.en), label: '영어로 말해보세요' });
      }
      for (let r = 0; r < s.repeat; r++) {
        steps.push({ type: 'speak', text: speakable(card.en), ...voiceFor(card.sp || 'SAMANTHA'), label: '듣기' });
        steps.push({ type: 'wait', ms: gapMs(card.en), label: '따라 말하기' });
      }
      if (card.source) {
        steps.push({ type: 'speak', text: speakable(card.source.text), ...voiceFor(card.source.sp), label: '원래 대사' });
        steps.push({ type: 'wait', ms: 700 });
      }
      return steps;
    }

    // Dialogue line
    const text = speakable(card.text);
    const mode = s.mode;
    if (mode === 'listen') {
      steps.push({ type: 'speak', text, ...voiceFor(card.sp), label: '듣기' });
      steps.push({ type: 'wait', ms: 350 });
      return steps;
    }
    if (mode === 'role' && card.sp === s.myRole) {
      steps.push({ type: 'beep', freq: 880 });
      steps.push({ type: 'wait', ms: gapMs(card.text), label: '내 차례 — 말해보세요' });
      if (s.roleReveal) steps.push({ type: 'speak', text, ...voiceFor(card.sp), label: '정답' });
      steps.push({ type: 'wait', ms: 350 });
      return steps;
    }
    if (mode === 'role') {
      steps.push({ type: 'speak', text, ...voiceFor(card.sp), label: '상대 대사' });
      steps.push({ type: 'wait', ms: 300 });
      return steps;
    }
    // shadow
    const chunks = chunkLine(text);
    for (const chunk of chunks) {
      const shown = chunks.length > 1 ? chunk : null;
      for (let r = 0; r < s.repeat; r++) {
        steps.push({ type: 'speak', text: chunk, ...voiceFor(card.sp), label: r ? `다시 (${r + 1}/${s.repeat})` : '듣기', chunk: shown });
        steps.push({ type: 'wait', ms: gapMs(chunk), label: '따라 말하기', chunk: shown });
      }
    }
    return steps;
  }
}
