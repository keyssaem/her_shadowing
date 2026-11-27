// Pre-generate high-quality voice clips for the whole script so playback works
// offline and with the screen off. Builds exactly the texts the player speaks.
import { speakable, roleOf } from './tts.js';
import { chunkLine } from './player.js';
import { clip, clipKey, hasClip, estimateCost, DEFAULT_HQ_VOICES } from './hq-tts.js';

/** Every (voice, text) pair the player may speak for script lines and key expressions. */
export function plannedClips(scenes, expressions, hqVoices) {
  const v = { ...DEFAULT_HQ_VOICES, ...hqVoices };
  const seen = new Set();
  const out = [];
  const add = (voice, text) => {
    const t = text.trim();
    if (!t) return;
    const k = clipKey(voice, t);
    if (seen.has(k)) return;
    seen.add(k); out.push({ voice, text: t, key: k });
  };
  for (const sc of scenes) for (const it of sc.items) {
    if (it.t !== 'd') continue;
    const voice = v[roleOf(it.sp)] || v.narrator;
    const full = speakable(it.text);
    add(voice, full);                          // listen / role-play modes
    for (const c of chunkLine(full)) add(voice, c); // shadowing chunks
  }
  for (const e of expressions) {
    add(v[roleOf(e.source?.sp || 'SAMANTHA')] || v.samantha, speakable(e.en));
    if (e.ko) add(v.korean, e.ko);
  }
  return out;
}

/** Which planned clips are missing, and what generating them would cost. */
export async function missingClips(list) {
  const missing = [];
  for (const c of list) if (!(await hasClip(c.key))) missing.push(c);
  const chars = missing.reduce((n, c) => n + c.text.length, 0);
  return { missing, chars, usd: estimateCost(chars) };
}

/** Generate clips with a few requests in parallel. onProgress(done, total). */
export async function generateClips(list, onProgress, signal) {
  let done = 0, failed = 0, i = 0;
  const worker = async () => {
    while (i < list.length && !signal?.aborted) {
      const c = list[i++];
      try { await clip(c.text, c.voice); } catch (e) {
        failed++;
        if (/키|크레딧|401|429/.test(e.message)) throw e; // stop on account problems
      }
      done++;
      onProgress?.(done, list.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { done, failed };
}
