const STOP = new Set("the a an and or of to in on for is are was were be been it its this that these those with as by at from what which who whom how why when where do does did can could would should will shall may might there their them they we you your i me my our not no yes if then than so such into about between over under also more most less least each any all some other only own same very just".split(" "));
const PASSAGE_CHARS = 1200;
const CONTEXT_CHARS = 6000;

function words(text) {
  return text.toLowerCase().match(/[a-z0-9؀-ۿ]+/g) || [];
}

function terms(text) {
  return words(text).filter((w) => w.length > 2 && !STOP.has(w));
}

export function makePassages(text) {
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const passages = [];
  let current = "";
  for (const block of blocks) {
    if (current && current.length + block.length > PASSAGE_CHARS) {
      passages.push(current);
      current = "";
    }
    if (block.length > PASSAGE_CHARS * 1.5) {
      const sentences = block.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if (current && current.length + s.length > PASSAGE_CHARS) {
          passages.push(current);
          current = "";
        }
        current += (current ? " " : "") + s;
      }
    } else {
      current += (current ? "\n\n" : "") + block;
    }
  }
  if (current) passages.push(current);
  return passages;
}

export function findRelevant(text, question) {
  const passages = makePassages(text);
  const qTerms = [...new Set(terms(question))];
  if (!passages.length) return [];
  const df = new Map();
  const counts = passages.map((p) => {
    const c = new Map();
    for (const w of terms(p)) c.set(w, (c.get(w) || 0) + 1);
    for (const w of c.keys()) df.set(w, (df.get(w) || 0) + 1);
    return c;
  });
  const n = passages.length;
  const scored = passages.map((p, i) => {
    let score = 0;
    for (const q of qTerms) {
      const tf = counts[i].get(q) || 0;
      if (tf) score += (1 + Math.log(tf)) * Math.log(1 + n / (df.get(q) || 1));
    }
    return { index: i, text: p, score };
  });
  const ranked = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const pick = ranked.length ? ranked : scored.slice(0, 3);
  const chosen = [];
  let used = 0;
  for (const s of pick) {
    if (used + s.text.length > CONTEXT_CHARS && chosen.length) continue;
    chosen.push(s);
    used += s.text.length;
    if (used >= CONTEXT_CHARS) break;
  }
  return chosen.sort((a, b) => a.index - b.index).map((s) => ({ ...s, total: n }));
}
