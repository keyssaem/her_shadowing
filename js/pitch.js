// Intonation (pitch contour) analysis for comparing a native line with your
// recording. Pure functions on raw audio samples, so they are unit-tested;
// decoding audio files happens in the browser (decodeToMono).

const MIN_HZ = 70, MAX_HZ = 420;

/**
 * Pitch track with a simple normalised autocorrelation detector.
 * Returns [{ t (seconds), hz | null }] every `hop` samples.
 */
export function pitchTrack(samples, sampleRate, { frame = 1024, hop = 256 } = {}) {
  const out = [];
  const minLag = Math.floor(sampleRate / MAX_HZ);
  const maxLag = Math.min(Math.floor(sampleRate / MIN_HZ), frame - 1);
  // Loudness gate relative to the whole clip, so quiet room noise is "unvoiced".
  let peak = 0;
  for (let i = 0; i < samples.length; i += 64) peak = Math.max(peak, Math.abs(samples[i]));
  const gate = Math.max(0.02, peak * 0.08);
  for (let start = 0; start + frame <= samples.length; start += hop) {
    let rms = 0;
    for (let i = 0; i < frame; i++) rms += samples[start + i] ** 2;
    rms = Math.sqrt(rms / frame);
    let hz = null;
    if (rms > gate) {
      let best = 0, bestLag = 0;
      for (let lag = minLag; lag <= maxLag; lag++) {
        let num = 0, e1 = 0, e2 = 0;
        for (let i = 0; i + lag < frame; i += 2) {
          const a = samples[start + i], b = samples[start + i + lag];
          num += a * b; e1 += a * a; e2 += b * b;
        }
        const r = num / Math.sqrt(e1 * e2 + 1e-12);
        if (r > best) { best = r; bestLag = lag; }
      }
      if (best > 0.55 && bestLag) hz = sampleRate / bestLag;
    }
    out.push({ t: (start + frame / 2) / sampleRate, hz });
  }
  return smooth(out);
}

/** Median-of-3 smoothing; drops single-frame octave jumps. */
function smooth(track) {
  return track.map((p, i) => {
    const w = [track[i - 1]?.hz, p.hz, track[i + 1]?.hz].filter((x) => x);
    if (!p.hz || w.length < 2) return p;
    const m = w.sort((a, b) => a - b)[Math.floor(w.length / 2)];
    return { t: p.t, hz: Math.abs(12 * Math.log2(p.hz / m)) > 7 ? m : p.hz };
  });
}

/**
 * Voiced part only, time normalised to 0..1 and pitch in semitones relative to
 * the speaker's median, so a deep and a high voice can be compared.
 */
export function contour(track) {
  const voiced = track.filter((p) => p.hz);
  if (voiced.length < 4) return [];
  const t0 = voiced[0].t, t1 = voiced[voiced.length - 1].t;
  const med = voiced.map((p) => p.hz).sort((a, b) => a - b)[Math.floor(voiced.length / 2)];
  return track
    .filter((p) => p.t >= t0 && p.t <= t1)
    .map((p) => ({ x: (p.t - t0) / Math.max(1e-6, t1 - t0), st: p.hz ? 12 * Math.log2(p.hz / med) : null }));
}

/** Resample a contour to n points (null where unvoiced). */
export function resample(c, n = 60) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const x = k / (n - 1);
    let nearest = null, d = Infinity;
    for (const p of c) { const dd = Math.abs(p.x - x); if (dd < d) { d = dd; nearest = p; } }
    out.push(nearest && d < 0.04 ? nearest.st : null);
  }
  return out;
}

/** 0–100: how alike two intonation shapes are (Pearson correlation on shared voiced points). */
export function similarity(a, b, n = 60) {
  const ra = resample(a, n), rb = resample(b, n);
  const pairs = ra.map((v, i) => [v, rb[i]]).filter(([x, y]) => x != null && y != null);
  if (pairs.length < 8) return null;
  const ma = pairs.reduce((s, [x]) => s + x, 0) / pairs.length;
  const mb = pairs.reduce((s, [, y]) => s + y, 0) / pairs.length;
  let num = 0, da = 0, db = 0;
  for (const [x, y] of pairs) { num += (x - ma) * (y - mb); da += (x - ma) ** 2; db += (y - mb) ** 2; }
  if (da < 1e-6 || db < 1e-6) return null;
  const r = num / Math.sqrt(da * db);
  return Math.max(0, Math.min(100, Math.round(((r + 1) / 2) ** 1.5 * 100)));
}

/** SVG path for a contour inside a w×h box (range ±maxSt semitones). Gaps where unvoiced. */
export function contourPath(c, w = 300, h = 120, maxSt = 8) {
  let d = '', pen = false;
  for (const p of c) {
    if (p.st == null) { pen = false; continue; }
    const x = (p.x * w).toFixed(1);
    const y = (h / 2 - (Math.max(-maxSt, Math.min(maxSt, p.st)) / maxSt) * (h / 2 - 6)).toFixed(1);
    d += `${pen ? 'L' : 'M'}${x} ${y} `;
    pen = true;
  }
  return d.trim();
}

/** Browser only: decode an audio Blob to mono Float32 samples. */
export async function decodeToMono(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const ch = buf.getChannelData(0);
    // Downsample to ~16 kHz to keep the analysis fast on phones.
    const step = Math.max(1, Math.floor(buf.sampleRate / 16000));
    const out = new Float32Array(Math.floor(ch.length / step));
    for (let i = 0; i < out.length; i++) out[i] = ch[i * step];
    return { samples: out, sampleRate: buf.sampleRate / step };
  } finally { ctx.close?.(); }
}
