// Web Speech synthesis wrapper with per-role voices and cancellation.
import { speakHq, stopHq, getOpenAIKey, DEFAULT_HQ_VOICES } from './hq-tts.js';

const FEMALE_SPEAKERS = new Set([
  'SAMANTHA', 'FEMALE OS VOICE', 'AMY', 'CATHERINE', 'BLIND DATE', 'SEXYKITTEN', 'ISABELLA',
  'TATIANA', 'JOCELYN', 'WAITRESS', 'NICE LADY', 'FEMALE VOICE #1',
  'MIDDLE-AGED WOMAN LETTER WRITER', 'RECEPTIONIST', 'ELLIE',
]);

/** Which voice slot a script speaker uses. */
export function roleOf(sp) {
  if (!sp) return 'narrator';
  if (sp === 'THEODORE') return 'theodore';
  if (sp === 'SAMANTHA' || sp === 'FEMALE OS VOICE') return 'samantha';
  if (sp === 'TEXT VOICE') return 'narrator';
  return FEMALE_SPEAKERS.has(sp) ? 'female' : 'male';
}

export function pitchOf(sp) {
  if (sp === 'ALIEN CHILD' || sp === 'JOCELYN') return 1.5;
  if (sp === 'TEXT VOICE') return 0.85;
  return 1;
}

const FEMALE_HINT = /(female|woman|samantha|zira|jenny|aria|ava|allison|susan|karen|moira|tessa|fiona|victoria|serena|emma|libby|sonia|natasha|michelle|joanna|salli|kendra|kimberly|ivy|google us english|google uk english female)/i;
const MALE_HINT = /(male|\bman\b|david|mark|guy|daniel|alex|fred|aaron|tom|arthur|oliver|ryan|eric|christopher|roger|steffan|brian|matthew|joey|justin|rishi|gordon|google uk english male)/i;

let voicesCache = [];
export function loadVoices() {
  return new Promise((resolve) => {
    const get = () => (voicesCache = speechSynthesis.getVoices());
    if (get().length) return resolve(voicesCache);
    speechSynthesis.onvoiceschanged = () => resolve(get());
    setTimeout(() => resolve(get()), 1500);
  });
}
export const englishVoices = () => voicesCache.filter((v) => /^en[-_]/i.test(v.lang));
export const koreanVoices = () => voicesCache.filter((v) => /^ko[-_]/i.test(v.lang));

function rank(v) {
  let s = 0;
  if (/en[-_]US/i.test(v.lang)) s += 3;
  if (/natural|neural|online|premium|enhanced/i.test(v.name)) s += 4;
  if (/google/i.test(v.name)) s += 2;
  if (v.localService) s += 1;
  return s;
}

/** Pick sensible default voice names for each slot. */
export function defaultVoices() {
  const en = englishVoices().slice().sort((a, b) => rank(b) - rank(a));
  const fem = en.filter((v) => FEMALE_HINT.test(v.name) && !/male/i.test(v.name.replace(/female/i, '')));
  const mal = en.filter((v) => MALE_HINT.test(v.name) && !FEMALE_HINT.test(v.name));
  const pick = (list, i = 0) => (list[i] || list[0] || en[0] || {}).name || '';
  const samantha = en.find((v) => /samantha/i.test(v.name))?.name || pick(fem);
  return {
    theodore: pick(mal),
    samantha,
    female: pick(fem.filter((v) => v.name !== samantha)) || samantha,
    male: pick(mal, 1),
    narrator: pick(en.filter((v) => /en[-_]GB/i.test(v.lang))) || pick(en),
    korean: (koreanVoices()[0] || {}).name || '',
  };
}

const findVoice = (name) => voicesCache.find((v) => v.name === name);

// Chrome cuts utterances off after ~15 s, so long text is split by sentence.
function splitForSpeech(text) {
  const parts = text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [text];
  const out = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > 180 && cur) { out.push(cur.trim()); cur = p; } else cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Make stage-y script text speakable.
export function speakable(text) {
  return text
    .replace(/--+/g, ', ')
    .replace(/(\w)-(\s|$)/g, '$1, ')
    .replace(/\.\.\./g, '... ')
    .replace(/\bOS's\b/g, "O.S.'s")
    .replace(/\bOS\b/g, 'O.S.');
}

let generation = 0;
export function cancelSpeech() {
  generation++;
  stopHq();
  try { speechSynthesis.cancel(); } catch { /* no speech engine */ }
}

// ---------- high-quality voice routing ----------
// When enabled (and an OpenAI key is saved), speech goes through cached OpenAI
// audio clips so it keeps playing with the screen off. Device voices are the
// fallback when a clip can't be fetched (e.g. offline and not cached yet).
let hq = { enabled: false, voices: {}, deviceVoices: {} };
export function configureHq(cfg) { hq = { ...hq, ...cfg }; }
export const isHqOn = () => hq.enabled && !!getOpenAIKey();
function hqVoiceFor({ voiceName, lang, slot }) {
  if (/^ko/i.test(lang || '')) return hq.voices.korean || DEFAULT_HQ_VOICES.korean;
  const s = slot || Object.keys(hq.deviceVoices).find((k) => k !== 'korean' && hq.deviceVoices[k] === voiceName) || 'narrator';
  return hq.voices[s] || DEFAULT_HQ_VOICES[s] || 'alloy';
}

/** Speak text; resolves when finished or cancelled. */
export async function speak(text, opts = {}) {
  if (isHqOn()) {
    const gen = generation;
    try {
      const ok = await speakHq(text, { voice: hqVoiceFor(opts), rate: opts.rate || 1 });
      return ok && gen === generation;
    } catch {
      if (gen !== generation) return false;
      // fall through to the device voice
    }
  }
  return speakDevice(text, opts);
}

async function speakDevice(text, { voiceName, rate = 1, pitch = 1, lang = 'en-US' } = {}) {
  const gen = generation;
  const voice = findVoice(voiceName);
  for (const chunk of splitForSpeech(text)) {
    if (gen !== generation) return false;
    await new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(chunk);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = lang;
      u.rate = rate;
      u.pitch = pitch;
      let done = false;
      const finish = () => { if (!done) { done = true; clearInterval(keep); resolve(); } };
      u.onend = finish;
      u.onerror = finish;
      // Chrome on some platforms stalls unless nudged.
      const keep = setInterval(() => {
        if (gen !== generation) return finish();
        if (!speechSynthesis.speaking) return finish();
        if (speechSynthesis.paused) speechSynthesis.resume();
      }, 5000);
      speechSynthesis.speak(u);
    });
  }
  return gen === generation;
}

/** Rough spoken duration (seconds) used to size shadowing gaps. */
export function estimateSeconds(text, rate = 1) {
  const words = text.trim().split(/\s+/).length;
  return words / (2.6 * rate) + 0.5;
}
