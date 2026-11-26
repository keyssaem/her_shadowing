// Voice recordings (IndexedDB) + speech-recognition-based pronunciation scoring.

// ---------- IndexedDB ----------
let dbp = null;
function db() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('her-rec', 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore('recs', { keyPath: 'id', autoIncrement: true });
      s.createIndex('key', 'key');
      s.createIndex('created', 'created');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('recs', mode);
    const store = t.objectStore('recs');
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
};
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

const MAX_PER_KEY = 10;

export async function saveRecording(rec) {
  const id = await tx('readwrite', (s) => reqP(s.add(rec)));
  // Keep the very first take (for "then vs now") and the latest ones.
  const list = await listByKey(rec.key);
  if (list.length > MAX_PER_KEY) await deleteRecording(list[1].id);
  return id;
}
export const listByKey = async (key) =>
  (await tx('readonly', (s) => reqP(s.index('key').getAll(key)))).sort((a, b) => a.created - b.created);
export const listAll = async () =>
  (await tx('readonly', (s) => reqP(s.getAll()))).sort((a, b) => b.created - a.created);
export const deleteRecording = (id) => tx('readwrite', (s) => reqP(s.delete(id)));

// ---------- backup ----------
const blobToB64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
const b64ToBlob = (b64, type) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};

/** All recordings as JSON-safe objects (audio as base64). */
export async function exportRecordings() {
  const all = await listAll();
  const out = [];
  for (const r of all) {
    const { blob, id, ...rest } = r;
    out.push({ ...rest, audio: await blobToB64(blob) });
  }
  return out;
}

/** Replace all recordings with the given backup list. */
export async function importRecordings(list) {
  await tx('readwrite', (s) => reqP(s.clear()));
  for (const r of list || []) {
    const { audio, ...rest } = r;
    await tx('readwrite', (s) => reqP(s.add({ ...rest, blob: b64ToBlob(audio, rest.mime || 'audio/webm') })));
  }
}

// ---------- recording ----------
export const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

function pickMime() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return types.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
}

/** Start recording; returns { stop(): Promise<{blob, mime, dur}> }. */
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mime = pickMime();
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  const t0 = Date.now();
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  mr.start();
  return {
    stop: () => new Promise((resolve) => {
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = mr.mimeType || mime || 'audio/webm';
        resolve({ blob: new Blob(chunks, { type }), mime: type, dur: Date.now() - t0 });
      };
      mr.stop();
    }),
  };
}

let current = null;
export function stopPlayback() {
  if (current) { current.pause(); current = null; }
}
/** Play a recorded blob; resolves when it ends (or is stopped). */
export function playBlob(blob) {
  stopPlayback();
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    current = a;
    const done = () => { URL.revokeObjectURL(url); if (current === a) current = null; resolve(); };
    a.onended = done;
    a.onerror = done;
    a.onpause = () => { if (!a.ended) done(); };
    a.play().catch(done);
  });
}

// ---------- speech recognition ----------
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : undefined;
export const canScore = () => !!SR;

/** Listen once; returns { stop(), result: Promise<string[] alternatives> }. */
export function listen(onInterim) {
  const rec = new SR();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.maxAlternatives = 3;
  rec.continuous = false;
  const finals = [];
  let alts = [];
  const result = new Promise((resolve, reject) => {
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          finals.push(res[0].transcript);
          alts = [...res].map((x) => x.transcript);
        } else interim += res[0].transcript;
      }
      onInterim?.((finals.join(' ') + ' ' + interim).trim());
    };
    rec.onerror = (e) => reject(new Error(
      e.error === 'not-allowed' ? '마이크 권한이 필요해요.'
        : e.error === 'no-speech' ? '말소리가 들리지 않았어요. 다시 해볼까요?'
          : e.error === 'network' ? '음성 인식에 인터넷 연결이 필요해요.'
            : '음성 인식 오류: ' + e.error));
    rec.onend = () => {
      if (!finals.length) return reject(new Error('말소리가 들리지 않았어요. 다시 해볼까요?'));
      // Combine multi-segment results; offer alternatives for the last segment.
      const head = finals.slice(0, -1).join(' ');
      resolve((alts.length ? alts : [finals.at(-1)]).map((a) => (head + ' ' + a).trim()));
    };
  });
  rec.start();
  return { stop: () => { try { rec.stop(); } catch { /* ignore */ } }, result };
}

// ---------- scoring ----------
const CONTRACTIONS = {
  "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are', "he's": 'he is', "she's": 'she is',
  "it's": 'it is', "that's": 'that is', "what's": 'what is', "there's": 'there is', "here's": 'here is', "let's": 'let us',
  "i've": 'i have', "you've": 'you have', "we've": 'we have', "i'll": 'i will', "you'll": 'you will', "we'll": 'we will',
  "i'd": 'i would', "you'd": 'you would', "he'd": 'he would', "don't": 'do not', "doesn't": 'does not', "didn't": 'did not',
  "can't": 'can not', cannot: 'can not', "won't": 'will not', "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not',
  "haven't": 'have not', "wouldn't": 'would not', "couldn't": 'could not', "shouldn't": 'should not',
  gonna: 'going to', wanna: 'want to', gotta: 'got to', gimme: 'give me', kinda: 'kind of', "'cause": 'because', cause: 'because',
  ok: 'okay', 'o.k.': 'okay', mr: 'mister', 'mr.': 'mister',
  "how's": 'how is', "where's": 'where is', "who's": 'who is', "she'll": 'she will', "he'll": 'he will',
  "they'll": 'they will', "it'll": 'it will', "we'd": 'we would', "they'd": 'they would', "she'd": 'she would',
  "they've": 'they have', "who've": 'who have', "would've": 'would have', "could've": 'could have',
  "should've": 'should have', "y'all": 'you all', "ma'am": 'madam',
};
// Typed or recognised text often drops the apostrophe ("im", "dont", "hows").
// Map those spellings too; both sides are normalised the same way, so a
// possessive like "its" expanding to "it is" still compares equal.
// Skip bare spellings that are ordinary words ("were", "well", "ill", ...).
const REAL_WORDS = new Set(['were', 'well', 'ill', 'id', 'wed', 'shed', 'hell', 'shell', 'cause']);
for (const [k, v] of Object.entries(CONTRACTIONS)) {
  const bare = k.replace(/'/g, '');
  if (bare !== k && !(bare in CONTRACTIONS) && !REAL_WORDS.has(bare)) CONTRACTIONS[bare] = v;
}
function normWords(s) {
  return s.toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/).filter(Boolean)
    .flatMap((w) => (CONTRACTIONS[w] || w.replace(/'/g, '')).split(' '))
    .filter(Boolean);
}

/** Word-level LCS alignment: which target words were heard. */
function align(target, heard) {
  const n = target.length, m = heard.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = target[i] === heard[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const ok = new Array(n).fill(false);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (target[i] === heard[j]) { ok[i] = true; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return { ok, matched: dp[0][0] };
}

/**
 * Score a target sentence against recognition alternatives.
 * Returns { score, heard, words: [{ text, ok }] } where words follow the
 * original target text (display form), each marked heard / missed.
 */
export function scoreAgainst(targetText, alternatives) {
  // Display tokens and their normalized pieces (a contraction may expand to two words).
  const display = targetText.match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)*(?:,\d+)*/g) || [];
  const pieces = display.map((w) => normWords(w));
  const target = pieces.flat();
  let best = null;
  for (const alt of alternatives) {
    const heard = normWords(alt);
    const { ok, matched } = align(target, heard);
    const score = target.length ? Math.round((matched / target.length) * 100) : 0;
    if (!best || score > best.score) best = { score, ok, heard: alt };
  }
  let p = 0;
  const words = display.map((text, i) => {
    const k = pieces[i].length;
    const okAll = k === 0 || best.ok.slice(p, p + k).every(Boolean);
    p += k;
    return { text, ok: okAll };
  });
  return { score: best.score, heard: best.heard, words };
}
