/*
 * Reads a picture of a notebook page with Gemini, straight from the iPad using your own API key
 * (entered once in the app and kept only on this iPad). Used to label pages (title, tags, searchable
 * text) and to read handwriting for Check my work. The prompts match backend/checker.py.
 *
 * window.SkybridgeAI = { hasKey, getKey, setKey, indexPage(imageBase64), readWork(imageBase64, { problem, mode }), explain(error) }
 */
(() => {
  const KEY = "skybridge.geminiKey";
  // Free Flash models, in the order tried. A model that is busy or out of quota is rested for a while
  // and the next one is used; one that doesn't exist is skipped for the rest of the visit.
  const MODELS = ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
  const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
  const ATTEMPT_MS = 30000;
  const PDF_ATTEMPT_MS = 120000;
  // Requests go one at a time with a gap, so a burst (many pages to read, a check, To text) stays under
  // the free per-minute limits. What you asked for jumps ahead of background reading.
  const timing = { gapMs: 3500, restBusyMs: 20000, restRateMs: 60000, waitMs: 15000 };
  const rest = new Map(); // model -> when it may be tried again
  const restWhy = new Map(); // model -> what put it to rest ("429", "429 today", "503", ...)
  const DAILY_REST_MS = 30 * 60000; // out of the day's free requests: no point asking again for a while
  const missing = new Set();
  const queue = [];
  let draining = false;
  let lastStart = 0;
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

  function schedule(job, background) {
    return new Promise((resolve, reject) => {
      const item = { job, resolve, reject, background };
      const firstBackground = queue.findIndex((other) => other.background);
      if (background || firstBackground < 0) queue.push(item);
      else queue.splice(firstBackground, 0, item);
      drain();
    });
  }

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length) {
        const item = queue.shift();
        const wait = lastStart + timing.gapMs - Date.now();
        if (wait > 0) await sleep(wait);
        lastStart = Date.now();
        try { item.resolve(await item.job()); } catch (error) { item.reject(error); }
      }
    } finally {
      draining = false;
    }
  }

  function storage(action, value) {
    try {
      if (action === "set") { if (value) localStorage.setItem(KEY, value); else localStorage.removeItem(KEY); return null; }
      return localStorage.getItem(KEY) || "";
    } catch { return ""; }
  }
  const getKey = () => storage("get");
  const setKey = (value) => storage("set", String(value || "").trim());
  const hasKey = () => Boolean(getKey());

  class AiError extends Error {
    constructor(message, kind, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra); }
  }

  const INDEX_PROMPT = `You are labelling one page of a student's handwritten math notebook. The image is that page.
Answer with JSON only: {"title": "...", "tags": ["..."], "text": "..."}
- title: a short, general name of the topic: 2 to 4 words and at most 24 characters, like "Matrix addition" or
  "LU decomposition" or "HW4 row reduction". Name the topic, not the details: no equations, no full sentences.
  If the page is empty or unreadable, use "Untitled page".
- tags: 2 to 5 short lowercase topic tags, like "row reduction" or "elementary matrices".
- text: a plain-text transcription of everything written, one line per line, matrices as rows
  ("1, 2; 3, 4"), under 3000 characters. Copy what is written; do not solve, correct or comment.`;

  const TRANSCRIBE_PROMPT = `The image is a piece of a student's handwriting (maybe one word, maybe several lines of math).
Answer with JSON only: {"text": "..."}
- text: exactly what is written, as plain typed text, one line per written line. Matrices as rows with
  commas between entries and semicolons between rows ("1, 2; 3, 4"). Write fractions as 1/2, powers as x^2,
  square roots as sqrt(x). Copy what is there, even if it is wrong. Do not solve, correct or comment.
  If nothing legible is written, answer {"text": ""}.`;

  const PRACTICE_RULE = "They are practising: never give the correct value or the next step, only what is wrong and where.";
  const EXPLAIN_RULE = "You may say what the correct value is and why.";

  const readPrompt = (problem, mode) => `You are checking a student's handwritten math. The image is one page of the student's notebook.
The problem: ${problem && problem.trim() ? problem.trim() : "(not given: work it out from the page)"}

1. Transcribe what they wrote, line by line. Write matrices as rows: "1, 2; 3, 4" (commas between
   entries, semicolons between rows, fractions as 1/2). Do not fix their mistakes while transcribing.
   An augmented matrix like [R | U] or [A | I], drawn with a vertical bar or dashed line, is two matrices:
   split every row at the bar (count the columns on each side; every row splits at the same place) and
   write them separately. Never check an augmented matrix as one block: for [A | I] reduced to [I | U],
   check "inverse" of A against U (and multiply A by U to get I) as separate checks. In matrices, list each matrix you read, one per line: "U = 0, 1/2, 1/2; 0, 0, 1; ...".
2. Turn every numeric claim they wrote into a check for an exact calculator. Check each step from
   their OWN previous line, not from the original problem, so one slip is found once, where it happened.
   Each check has: what (short label like "R2 - 2R1 on the first matrix"), operation, and the fields it needs:
   - row_operations: matrix (the matrix before), steps ("R2 - 2R1; swap R1 R3; R3 * 1/2"), compare (their result)
   - rref: matrix, compare (their RREF);  rank / determinant: matrix, compare (their number)
   - inverse / transpose: matrix, compare;  multiply: matrices ("A | B", in order), compare (their product)
   - solve: matrix (A), target (b as "1; 2; 3"), compare (their x);  evaluate: expression, compare
   For "U with UA = R" check multiply with matrices "U | A" and compare R, plus determinant of U
   (must not be 0). For UAV, LU or PA = LU, multiply their factors out the same way.
   Leave a field empty when it does not apply. Copy numbers exactly as written.
3. verdict: "correct", "wrong", "incomplete" (right so far but unfinished) or "unreadable".
   first_mistake: where the first mistake is (which line or step and which entry), without the correct value.
   mistake_box: where that first mistake sits in the picture, as "ymin,xmin,ymax,xmax" with every number from 0
   to 1000 (0,0 is the top left corner of the image). Box just the wrong entry or expression. Empty if no mistake.
   feedback: one or two sentences for the student. ${mode === "explain" ? EXPLAIN_RULE : PRACTICE_RULE}
Answer with JSON only.`;

  const STR = { type: "STRING" };
  const READING_SCHEMA = {
    type: "OBJECT",
    properties: {
      transcription: STR,
      matrices: STR,
      checks: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: Object.fromEntries(["what", "operation", "matrix", "matrices", "steps", "target", "expression", "compare"].map((k) => [k, STR])),
          required: ["what", "operation"],
        },
      },
      verdict: STR,
      first_mistake: STR,
      mistake_box: STR,
      feedback: STR,
    },
    required: ["transcription", "checks", "verdict"],
  };

  function parseJson(text) {
    let body = String(text || "").trim();
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(body);
    if (fenced) body = fenced[1].trim();
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end < start) throw new AiError("The model did not answer with JSON.", "format");
    let data;
    try { data = JSON.parse(body.slice(start, end + 1)); } catch { throw new AiError("The model did not answer with JSON.", "format"); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new AiError("The model did not answer with JSON.", "format");
    return data;
  }

  async function call(model, image, prompt, config) {
    const controller = new AbortController();
    // `image` is a base64 picture, or { mime, data } for a PDF (which takes longer to read).
    const media = image && typeof image === "object" ? image : image ? { mime: "image/png", data: image } : null;
    const timer = setTimeout(() => controller.abort(), media?.mime === "application/pdf" ? PDF_ATTEMPT_MS : ATTEMPT_MS);
    let response;
    try {
      response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": getKey() },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [...(media ? [{ inline_data: { mime_type: media.mime, data: media.data } }] : []), { text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", ...config },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new AiError(error.name === "AbortError" ? "Gemini took too long." : "No connection to Gemini.", error.name === "AbortError" ? "timeout" : "network", { model });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      let detail = "";
      let retryAfter = Number(response.headers.get("retry-after")) || 0;
      let daily = false;
      try {
        const body = await response.json();
        detail = body?.error?.message || "";
        // Google says how long to wait in the error's details ("retryDelay": "34s").
        const wait = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(JSON.stringify(body));
        if (wait) retryAfter = Math.max(retryAfter, Number(wait[1]));
        // Google names the limit that was hit: a "...PerDay" quota is the day's allowance, not a busy minute.
        daily = response.status === 429 && /PerDay/i.test(JSON.stringify(body));
      } catch {}
      const kind = response.status === 429 ? "rate"
        : response.status === 404 ? "missing"
        : response.status >= 500 ? "busy"
        : /api key/i.test(detail) || response.status === 401 || response.status === 403 ? "key"
        : "bad";
      throw new AiError(detail.slice(0, 160) || `Gemini answered ${response.status}.`, kind, { status: response.status, retryAfter, model, daily });
    }
    const data = await response.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("");
    if (!text.trim()) throw new AiError("Gemini gave an empty answer.", "empty");
    return text;
  }

  // Each model in turn. A rate limit or a busy server rests that model and moves on to the next; when
  // every model is resting, a request you made waits a moment and goes round once more, while
  // background reading gives up and tries again later (smart.js backs off).
  async function attempt(image, prompt, schema, extra, background) {
    const tried = [];
    let last = null;
    for (let round = 0; round < 2; round += 1) {
      const now = Date.now();
      let models = MODELS.filter((name) => !missing.has(name) && (rest.get(name) || 0) <= now);
      if (!models.length) models = MODELS.filter((name) => !missing.has(name)); // all resting: try anyway
      // A model that is resting is skipped, but the message still says so, so it never looks like it wasn't there.
      for (const name of MODELS) {
        if (!missing.has(name) && !models.includes(name) && restWhy.has(name) && !tried.some((t) => t.startsWith(`${name.replace("gemini-", "")}:`))) tried.push(`${name.replace("gemini-", "")}: ${restWhy.get(name)}, resting`);
      }
      for (const model of models) {
        const configs = [
          { ...(schema ? { responseSchema: schema } : {}), thinkingConfig: { thinkingBudget: 1024 }, ...extra },
          { ...extra }, // a model that doesn't take that config
        ];
        for (const config of configs) {
          try {
            const text = await call(model, image, prompt, config);
            restWhy.delete(model);
            return { model, text };
          } catch (error) {
            last = error;
            if (error.kind === "key" || error.kind === "network") { error.tried = tried; throw error; }
            if (error.kind !== "bad") tried.push(`${model.replace("gemini-", "")}: ${error.status || error.kind}`);
            restWhy.set(model, error.kind === "rate" ? (error.daily ? "429 today" : "429") : String(error.status || error.kind));
            if (error.kind === "rate") rest.set(model, Date.now() + (error.daily ? DAILY_REST_MS : Math.max(timing.restRateMs, (error.retryAfter || 0) * 1000)));
            else if (error.kind === "busy" || error.kind === "timeout") rest.set(model, Date.now() + timing.restBusyMs);
            else if (error.kind === "missing") missing.add(model);
            if (error.kind !== "bad") break; // another config won't help; the next model might
          }
        }
        await sleep(300);
      }
      const transient = last && ["rate", "busy", "timeout"].includes(last.kind);
      if (background || !transient) break;
      // Something you asked for: let the soonest model recover (a few seconds at most), then one more round.
      const soon = Math.min(...MODELS.filter((name) => !missing.has(name)).map((name) => rest.get(name) || 0));
      await sleep(Math.min(timing.waitMs, Math.max(2000, soon - Date.now())));
    }
    if (last) {
      last.tried = tried;
      // Every model that exists said the same: the day's free requests are used up.
      const live = MODELS.filter((name) => !missing.has(name));
      last.allDaily = live.length > 0 && live.every((name) => restWhy.get(name) === "429 today");
    }
    throw last || new AiError("No model answered.", "empty");
  }

  async function generate(image, prompt, schema, extra = {}, { background = false } = {}) {
    if (!hasKey()) throw new AiError("Add your Gemini key first.", "key");
    return schedule(() => attempt(image, prompt, schema, extra, background), background);
  }

  // A notebook name that fits a list: cut at a word boundary, never mid-word.
  const MAX_TITLE = 28;
  function shortTitle(raw) {
    const words = String(raw ?? "").split(/\s+/).filter(Boolean).join(" ");
    if (words.length <= MAX_TITLE) return words;
    const head = words.slice(0, MAX_TITLE);
    return (head.includes(" ") ? head.slice(0, head.lastIndexOf(" ")) : head).replace(/[ ,;:-]+$/, "");
  }

  function cleanIndex(data) {
    const tags = [];
    for (const raw of Array.isArray(data.tags) ? data.tags : []) {
      const tag = String(raw).toLowerCase().split(/\s+/).filter(Boolean).join(" ").slice(0, 30);
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
    const title = shortTitle(data.title) || "Untitled page";
    const text = Array.isArray(data.text) ? data.text.join("\n") : String(data.text ?? "");
    return { title, tags: tags.slice(0, 6), text: text.trim().slice(0, 4000) };
  }

  async function indexPage(image, options = {}) {
    const { model, text } = await generate(image, INDEX_PROMPT, null, {}, { background: options.background !== false });
    return { model, ...cleanIndex(parseJson(text)) };
  }

  async function transcribe(image) {
    const { model, text } = await generate(image, TRANSCRIBE_PROMPT, null);
    const data = parseJson(text);
    const out = Array.isArray(data.text) ? data.text.join("\n") : String(data.text ?? "");
    return { model, text: out.trim().slice(0, 6000) };
  }

  // Words only (no picture): a practice problem. `prompt` is built by practice.js.
  async function ask(prompt, schema, { background = false } = {}) {
    const { model, text } = await generate(null, prompt, schema, { temperature: 0.9 }, { background });
    return { model, data: parseJson(text) };
  }

  // A PDF (base64) with a prompt: what you asked for, so it goes ahead of background reading.
  async function askPdf(base64, prompt, schema) {
    const { model, text } = await generate({ mime: "application/pdf", data: base64 }, prompt, schema, { maxOutputTokens: 32000 });
    return { model, data: parseJson(text) };
  }

  async function readWork(image, { problem = "", mode = "practice" } = {}) {
    const { model, text } = await generate(image, readPrompt(problem, mode), READING_SCHEMA);
    return { model, reading: parseJson(text) };
  }

  // Says what went wrong and, for the free-tier problems, which model said what (429 is Google's
  // rate limit; 503 and 500 are Google being overloaded; 404 is a model that isn't offered).
  // True while every model is resting after a limit or a busy answer: background top-ups wait.
  function busy() {
    const now = Date.now();
    return MODELS.filter((name) => !missing.has(name)).every((name) => (rest.get(name) || 0) > now);
  }

  function explain(error) {
    const kind = error?.kind;
    const where = error?.tried?.length ? ` (${[...new Set(error.tried)].join(", ")})` : "";
    if (kind === "key") return "Gemini didn't accept the key. Check it in Notebooks, then Smart features.";
    if (kind === "rate" && error.allDaily) return `Today's free Gemini requests are used up${where}. They come back around midnight Pacific time (3 AM Eastern). Until then page names wait and practice uses the built-in problems.`;
    if (kind === "rate") return `Gemini's free limit was reached${where}. It slows down and tries again on its own.`;
    if (kind === "network") return "No connection to Gemini.";
    if (kind === "timeout") return `Gemini took too long${where}. It tries again on its own.`;
    if (kind === "busy") return `Google's servers are busy${where}. It tries again on its own.`;
    if (kind === "missing") return `None of the Gemini models answered${where}. They may not be offered to this key.`;
    if (kind === "format" || kind === "empty") return "Gemini's answer couldn't be read. Try again.";
    return error?.message || "Reading the page failed.";
  }

  window.SkybridgeAI = { hasKey, getKey, setKey, indexPage, transcribe, ask, askPdf, readWork, explain, busy, cleanIndex, shortTitle, parseJson, timing, MODELS };
})();
