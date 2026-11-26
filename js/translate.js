// Korean translations of script lines via the Claude API, using the user's own
// API key. Runs entirely in the browser; results are cached on this device only.
import { createMessage, textOf } from './claude.js';

export { getKey, setKey } from './claude.js';

const ls = {
  get(k, d) { try { const v = localStorage.getItem('her.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('her.' + k, JSON.stringify(v)); } catch { throw new Error('기기 저장 공간이 부족해요.'); } },
};

let ko = ls.get('ko', {}); // { [sceneId]: { [itemIndex]: "한국어" } }
export const getKo = (sceneId, itemIndex) => ko[sceneId]?.[itemIndex];
export const hasScene = (sceneId) => !!ko[sceneId];
export const translatedCount = () => Object.keys(ko).length;

const SYSTEM = [
  'You translate English film dialogue into natural, spoken Korean for a Korean learner who shadows the English lines.',
  'Keep the tone and register of each speaker (casual, intimate, sarcastic, crude). Translate profanity and sexual content faithfully, do not soften it.',
  'Use natural Korean speech (반말/존댓말 as the relationship suggests), not literal word-for-word translation.',
  'Return ONLY a JSON array of strings, one Korean translation per input line, in the same order and with exactly the same count. No commentary.',
].join(' ');

function parseArray(text, n) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('번역 결과를 읽지 못했어요.');
  const arr = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(arr) || arr.length !== n) throw new Error(`번역 줄 수가 맞지 않아요 (${arr.length}/${n}).`);
  return arr.map((s) => String(s));
}

/**
 * Translate all dialogue lines of a scene and cache them.
 * lines: [{ itemIndex, sp, text }]
 */
export async function translateScene(sceneId, sceneTitle, lines) {
  if (!lines.length) return;
  const input = lines.map((l, i) => `${i + 1}. ${l.sp}: ${l.text}`).join('\n');
  const res = await createMessage({
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: `Scene: ${sceneTitle}\nTranslate each numbered line (speaker name is context only, do not translate it).\n\n${input}`,
    }],
  });
  const arr = parseArray(textOf(res), lines.length);
  const map = {};
  lines.forEach((l, i) => { map[l.itemIndex] = arr[i]; });
  ko[sceneId] = map;
  ls.set('ko', ko);
}
