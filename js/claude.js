// Shared Claude API client for in-browser features (translation, conversation
// practice). Uses the user's own API key, stored only on this device.

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.8.0/+esm';
export const MODEL = 'claude-opus-5-5';

const ls = {
  get(k, d) { try { const v = localStorage.getItem('her.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('her.' + k, JSON.stringify(v)); } catch { /* storage full */ } },
};

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
      // The key is the user's own and is sent only to the Anthropic API.
      return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    }).catch((e) => { clientP = null; throw new Error('Claude SDK를 불러오지 못했어요 (인터넷 연결 확인): ' + e.message); });
  }
  return clientP;
}

/**
 * One Messages API call. Returns the full response (append response.content to
 * the conversation as-is so thinking blocks are preserved between turns).
 */
export async function createMessage({ system, messages, maxTokens = 16000, effort = 'low' }) {
  const c = await client();
  let res;
  try {
    res = await c.beta.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort },
      system,
      messages,
    });
  } catch (e) {
    const status = e?.status;
    if (status === 401) throw new Error('API 키가 올바르지 않아요.');
    if (status === 429) throw new Error('요청이 많아요. 잠시 뒤 다시 시도하세요.');
    if (status === 400 && /credit|billing/i.test(e?.message || '')) throw new Error('API 크레딧이 부족해요.');
    throw new Error('Claude 요청 실패: ' + (e?.message || e));
  }
  if (res.stop_reason === 'refusal') throw new Error('이 요청은 응답이 거절됐어요.');
  if (res.stop_reason === 'max_tokens') throw new Error('응답이 너무 길어 잘렸어요.');
  return res;
}

export const textOf = (res) => res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
