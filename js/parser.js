// Screenplay PDF parser.
// Works on the text layer produced by pdf.js (x/y coordinates per text item).
// Standard screenplay layout: action at the left margin, dialogue ~1in indented,
// parentheticals ~1.5in, character cues ~2in. Indents are measured relative to
// the action margin, so the parser does not depend on absolute page coordinates.

const FOOTER = /^Script provided for/i;
const PAGE_HEADER = /\bpg\.\s*(\d+)/i;
const NOISE = [/^\(CONTINUED\)$/i, /^CONTINUED:?(\s*\(\d+\))?$/i, /^\(MORE\)$/i];
const HEADING = /^(INT\.|EXT\.|INT\/EXT|I\/E\.)/;
const TRANSITION = /^(CUT TO|CUT OUT|FADE|DISSOLVE|SMASH CUT|MATCH CUT|INTERCUT|MONTAGE|BACK TO|THE END|END\b)/i;

// Act boundaries (script page where each act starts) for Her.
const ACT_STARTS = [1, 10, 35, 62, 84];

const norm = (s) =>
  s.replace(/[‘’′]/g, "'").replace(/[“”]/g, '"')
   .replace(/…/g, '...').replace(/\s+/g, ' ').trim();

/** Extract positioned text lines from a PDF. */
export async function extractLines(pdfjsLib, data, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const lines = [];
  let lastScriptPage = 0;
  let rowId = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items
      .filter((it) => typeof it.str === 'string' && it.str !== '')
      .map((it) => ({ x: it.transform[4], y: it.transform[5], w: it.width, s: it.str }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    // Group into rows by baseline.
    const rows = [];
    for (const it of items) {
      const row = rows.length && Math.abs(rows[rows.length - 1].y - it.y) < 2.5 ? rows[rows.length - 1] : null;
      if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
    }

    let scriptPage = null;
    const pageLines = [];
    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      const segs = [];
      for (const it of row.items) {
        const last = segs[segs.length - 1];
        const gap = last ? it.x - last.end : 0;
        if (!last || gap > 30) {
          if (it.s.trim() === '') continue;
          segs.push({ x: it.x, end: it.x + it.w, text: it.s });
        } else {
          const needSpace = gap > 1.5 && !last.text.endsWith(' ') && !it.s.startsWith(' ');
          last.text += (needSpace ? ' ' : '') + it.s;
          last.end = it.x + it.w;
        }
      }
      const rowText = segs.map((s) => s.text).join(' ');
      if (FOOTER.test(rowText.trim())) continue;
      const m = rowText.match(PAGE_HEADER);
      if (m && segs.length <= 3 && rowText.length < 40) { scriptPage = +m[1]; continue; }
      rowId++;
      for (const s of segs) {
        const text = norm(s.text);
        if (text) pageLines.push({ x: s.x, y: row.y, row: rowId, text });
      }
    }
    const pg = scriptPage ?? (lastScriptPage ? lastScriptPage + 1 : p);
    lastScriptPage = pg;
    for (const l of pageLines) lines.push({ ...l, page: pg, pdfPage: p });
    onProgress?.(p / pdf.numPages);
  }
  return lines;
}

const isCue = (t) =>
  t.length <= 45 &&
  /[A-Z]/.test(t) &&
  t === t.toUpperCase() &&
  /^[A-Z0-9][A-Z0-9 .,'\-#&/]*(\s*\([^)]*\))*$/.test(t) &&
  !TRANSITION.test(t) &&
  !/:$/.test(t);

const cleanName = (t) => t.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();

function joinLines(arr) {
  let out = '';
  for (const raw of arr) {
    const t = raw.trim();
    if (!out) { out = t; continue; }
    // "post-" + "verbally" => "post-verbally" (but keep "--" dashes spaced)
    if (/[A-Za-z]-$/.test(out) && !/--$/.test(out)) out += t;
    else out += ' ' + t;
  }
  return out;
}

const actOf = (page) => {
  let a = 1;
  ACT_STARTS.forEach((p, i) => { if (page >= p) a = i + 1; });
  return a;
};

/** Turn positioned lines into scenes with dialogue + action items. */
export function parseScript(rawLines) {
  const lines = rawLines.filter((l) => !NOISE.some((r) => r.test(l.text)));
  const longXs = lines.filter((l) => l.text.length > 45).map((l) => l.x).sort((a, b) => a - b);
  const margin = longXs.length ? longXs[Math.floor(longXs.length * 0.1)] : Math.min(...lines.map((l) => l.x));

  const scenes = [];
  let scene = null;
  let speech = null; // { sp, page, parts: [{ paren, lines: [] }], inParen }
  let action = null; // { page, lines: [], lastY }
  let dual = null;   // { a: speech, b: speech, mid }

  const pushItem = (it) => scene && scene.items.push(it);
  const flushSpeech = (s = speech) => {
    if (!s) return;
    for (const part of s.parts) {
      if (part.lines.length) {
        pushItem({ t: 'd', sp: s.sp, text: joinLines(part.lines), paren: part.paren || undefined, page: s.page });
      }
    }
    if (s === speech) speech = null;
  };
  const flushAction = () => {
    if (action && action.lines.length) pushItem({ t: 'a', text: joinLines(action.lines), page: action.page });
    action = null;
  };
  const flushAll = () => {
    if (dual) { flushSpeech(dual.a); flushSpeech(dual.b); dual = null; }
    flushSpeech(); flushAction();
  };
  const newSpeech = (name, page) => ({ sp: cleanName(name), page, parts: [{ paren: null, lines: [] }], inParen: false });
  const addToSpeech = (s, t) => {
    let part = s.parts[s.parts.length - 1];
    if (s.inParen || t.startsWith('(')) {
      if (!s.inParen && part.lines.length) { part = { paren: null, lines: [] }; s.parts.push(part); }
      part.paren = part.paren ? part.paren + ' ' + t : t;
      s.inParen = !t.includes(')');
      if (!s.inParen) part.paren = part.paren.replace(/^\(|\)$/g, '').trim();
      return;
    }
    part.lines.push(t);
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.text;
    const ind = l.x - margin;

    if (ind < 30 && HEADING.test(t)) {
      flushAll();
      scene = { id: 'sc' + (scenes.length + 1), heading: t, page: l.page, act: actOf(l.page), items: [] };
      scenes.push(scene);
      continue;
    }
    if (!scene) continue; // title page

    // Dual dialogue: two cues on the same row (columns may start at the margin).
    const next = lines[i + 1];
    if (isCue(t) && next && next.row === l.row && isCue(next.text)) {
      flushAll();
      dual = { a: newSpeech(t, l.page), b: newSpeech(next.text, l.page), mid: (l.x + next.x) / 2, page: l.page, lastY: l.y };
      i++;
      continue;
    }
    if (dual) {
      const contiguous = l.page === dual.page && dual.lastY - l.y < 18;
      if (!contiguous || (ind >= 100 && isCue(t))) {
        flushSpeech(dual.a); flushSpeech(dual.b); dual = null;
      } else {
        addToSpeech(l.x < dual.mid ? dual.a : dual.b, t);
        dual.lastY = l.y;
        continue;
      }
    }

    if (ind >= 100 && isCue(t)) {
      flushSpeech(); flushAction();
      speech = newSpeech(t, l.page);
      continue;
    }
    if (speech && ind >= 30) { addToSpeech(speech, t); continue; }

    // Action / transition
    flushSpeech();
    if (TRANSITION.test(t) && t === t.toUpperCase()) { flushAction(); pushItem({ t: 'x', text: t, page: l.page }); continue; }
    if (action && action.page === l.page && action.lastY - l.y < 18) {
      action.lines.push(t); action.lastY = l.y;
    } else {
      flushAction();
      action = { page: l.page, lines: [t], lastY: l.y };
    }
  }
  flushAll();

  const dialogue = scenes.reduce((n, s) => n + s.items.filter((it) => it.t === 'd').length, 0);
  return { version: 1, importedAt: new Date().toISOString(), stats: { scenes: scenes.length, dialogue }, scenes };
}
