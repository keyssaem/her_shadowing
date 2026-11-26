// Korean translations of script lines via the Claude API, using the user's own
// API key. Runs entirely in the browser; results are cached on this device only.

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.8.0/+esm';
const MODEL = 'claude-opus-5-5';

const ls = {
  get(k, d) { try { const v = localStorage.getItem('her.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('her.' + k, JSON.stringify(v)); } catch { throw new Error('기기 저장 공간이 부족해요.'); } },
};

let ko = ls.get('ko', {}); // { [sceneId]: { [itemIndex]: "한국어" } }
export const getKo = (sceneId, itemIndex) => ko[sceneId]?.[itemIndex];
export const hasScene = (sceneId) => !!ko[sceneId];
export const translatedCount = () => Object.keys(ko).length;
export const clearTranslations = () => { ko = {}; ls.set('ko', ko); };
export const reloadTranslations = () => { ko = ls.get('ko', {}); };

export const getKey = () => ls.get('apikey', '');
export const setKey = (k) => ls.set('apikey', (k || '').trim());

let clientP = null;
let clientKey = '';
async function client() {
  const key = getKey();
  if (!key) throw new Error('설정에서 Anthropic API 키를 먼저 넣어주세요.');
  if (!clientP || clientKey !== key) {
    clientKey = key;
    clientP = import(SDK_URL).then((m) => {
      const Anthropic = m.default || m.Anthropic;
      // The key is the user's own and never leaves this device except to the API.
      return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    });
  }
  return clientP;
}

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
  const c = await client();
  const input = lines.map((l, i) => `${i + 1}. ${l.sp}: ${l.text}`).join('\n');
  let res;
  try {
    res = await c.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Scene: ${sceneTitle}\nTranslate each numbered line (speaker name is context only, do not translate it).\n\n${input}`,
      }],
    });
  } catch (e) {
    const status = e?.status;
    if (status === 401) throw new Error('API 키가 올바르지 않아요.');
    if (status === 429) throw new Error('요청이 많아요. 잠시 뒤 다시 시도하세요.');
    if (status === 400 && /credit|billing/i.test(e?.message || '')) throw new Error('API 크레딧이 부족해요.');
    throw new Error('번역 요청 실패: ' + (e?.message || e));
  }
  if (res.stop_reason === 'refusal') throw new Error('이 장면은 번역이 거절됐어요.');
  if (res.stop_reason === 'max_tokens') throw new Error('장면이 길어 번역이 잘렸어요.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const arr = parseArray(text, lines.length);
  const map = {};
  lines.forEach((l, i) => { map[l.itemIndex] = arr[i]; });
  ko[sceneId] = map;
  ls.set('ko', ko);
}
