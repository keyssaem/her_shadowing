// High-quality voices via OpenAI text-to-speech, cached as audio files on the
// device (IndexedDB). Real <audio> playback keeps going with the screen off or
// another app in front, which the browser's built-in speech cannot do.
//
// Clips are generated at normal speed and played with playbackRate, so one
// file serves every speed setting. The API key stays on this device and is
// sent only to api.openai.com.

const API = 'https://api.openai.com/v1/audio/speech';
const MODEL = 'tts-1';
export const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
export const DEFAULT_HQ_VOICES = { theodore: 'echo', samantha: 'nova', female: 'shimmer', male: 'onyx', narrator: 'fable', korean: 'nova' };
export const PRICE_PER_MCHAR = 15; // USD per 1M characters (tts-1), shown as an estimate only

const ls = {
  get(k, d) { try { const v = localStorage.getItem('her.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('her.' + k, JSON.stringify(v)); } catch { /* full */ } },
};
export const getOpenAIKey = () => ls.get('openaikey', '');
export const setOpenAIKey = (k) => ls.set('openaikey', (k || '').trim());

// ---------- clip cache (IndexedDB) ----------
let dbp = null;
function db() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('her-tts', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('clips');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
const idb = async (mode, fn) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('clips', mode);
    const r = fn(t.objectStore('clips'));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
};
export const clipKey = (voice, text) => `${MODEL}|${voice}|${text}`;
const getClip = (key) => idb('readonly', (s) => s.get(key)).catch(() => null);
const putClip = (key, blob) => idb('readwrite', (s) => s.put(blob, key)).catch(() => {});
export const hasClip = async (key) => !!(await idb('readonly', (s) => s.getKey(key)).catch(() => null));
export const clipCount = () => idb('readonly', (s) => s.count()).catch(() => 0);
export const clearClips = () => idb('readwrite', (s) => s.clear());

/** Fetch (or read from cache) the audio clip for text in an OpenAI voice. */
export async function clip(text, voice) {
  const key = clipKey(voice, text);
  const cached = await getClip(key);
  if (cached) return cached;
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new Error('no-key');
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, voice, input: text, response_format: 'mp3' }),
  });
  if (!res.ok) {
    const msg = res.status === 401 ? 'OpenAI API 키가 올바르지 않아요.' : res.status === 429 ? '요청이 많거나 크레딧이 부족해요.' : `OpenAI 오류 (${res.status})`;
    throw new Error(msg);
  }
  const blob = await res.blob();
  await putClip(key, blob);
  return blob;
}

// ---------- playback ----------
// One reusable element: switching its src keeps working while the page is in
// the background, where creating new players can be blocked.
let el = null;
let gen = 0;
export function stopHq() { gen++; if (el) { el.pause(); el.removeAttribute('src'); el.load(); } }

/** Play text in an OpenAI voice. Resolves true when it finished, false when stopped. */
export async function speakHq(text, { voice, rate = 1 }) {
  const my = ++gen;
  const blob = await clip(text, voice);
  if (my !== gen) return false;
  el ||= Object.assign(new Audio(), { preload: 'auto' });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve) => {
    let finished = false;
    const done = (ok) => {
      if (finished) return;
      finished = true;
      clearInterval(watch);
      el.onended = el.onerror = null;
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    // Stop promptly when cancelled (pause / next / another clip started).
    const watch = setInterval(() => { if (my !== gen) done(false); }, 150);
    el.onended = () => done(my === gen);
    el.onerror = () => done(false);
    el.src = url;
    el.playbackRate = rate;
    el.preservesPitch = true;
    el.play().catch(() => done(false));
  });
}

// Short tone as a real audio file, so cues still sound with the screen off.
const toneCache = new Map();
function toneBlob(freq, ms) {
  const k = `${freq}:${ms}`;
  if (toneCache.has(k)) return toneCache.get(k);
  const rate = 22050, n = Math.round(rate * ms / 1000);
  const buf = new ArrayBuffer(44 + n * 2); const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 200, (n - i) / 400);
    v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * freq * i) / rate) * 9000 * env, true);
  }
  const blob = new Blob([buf], { type: 'audio/wav' });
  toneCache.set(k, blob);
  return blob;
}
export async function beepHq(freq = 880, ms = 140) {
  const my = ++gen;
  el ||= Object.assign(new Audio(), { preload: 'auto' });
  const url = URL.createObjectURL(toneBlob(freq, ms));
  await new Promise((resolve) => {
    el.onended = el.onerror = () => { URL.revokeObjectURL(url); resolve(); };
    el.src = url; el.playbackRate = 1;
    el.play().catch(resolve);
    setTimeout(resolve, ms + 400);
  });
  return my === gen;
}

/** Characters → estimated USD for generating them. */
export const estimateCost = (chars) => (chars / 1e6) * PRICE_PER_MCHAR;
