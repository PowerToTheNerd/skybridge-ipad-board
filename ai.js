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
  // What the free key allows (Google AI Studio's rate-limit page): requests per minute and per day. The count of
  // today's requests is kept on this iPad (the day turns over at midnight Pacific, when Google resets it).
  const LIMITS = {
    "gemini-3.8-flash": { label: "Gemini 3.8 Flash", rpm: 5, rpd: 20 },
    "gemini-2.5-flash": { label: "Gemini 2.5 Flash", rpm: 5, rpd: 20 },
    "gemini-2.5-flash-lite": { label: "Gemini 2.5 Flash-Lite", rpm: 10, rpd: 20 },
  };
  const USAGE_KEY = "skybridge.geminiUsage";
  const recent = new Map(); // model -> start times of its requests in the last minute
  const usageListeners = new Set();
  const pacificDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  function readUsage() {
    try {
      const saved = JSON.parse(localStorage.getItem(USAGE_KEY) || "{}");
      if (saved.day === pacificDay() && saved.counts) return saved;
    } catch {}
    return { day: pacificDay(), counts: {} };
  }
  // Google said "used up for today" for this model: fill its bar, even when this iPad counted fewer requests
  // (the free quota belongs to the key, so Skybridge on the PC and AI Studio use it too).
  function markOut(model) {
    const usage = readUsage();
    usage.out = { ...(usage.out || {}), [model]: true };
    usage.counts[model] = Math.max(usage.counts[model] || 0, LIMITS[model]?.rpd || 0);
    try { localStorage.setItem(USAGE_KEY, JSON.stringify(usage)); } catch {}
    usageListeners.forEach((fn) => fn());
  }
  function tally(model) {
    const usage = readUsage();
    usage.counts[model] = (usage.counts[model] || 0) + 1;
    try { localStorage.setItem(USAGE_KEY, JSON.stringify(usage)); } catch {}
    usageListeners.forEach((fn) => fn());
  }
  const usedToday = (model) => readUsage().counts[model] || 0;
  const liveStatus = () => ({ used: window.SkybridgeLive?.used() || 0, on: Boolean(window.SkybridgeLive?.usable()), error: lastLiveError });
  function usage() {
    const { counts, out = {} } = readUsage();
    return MODELS.map((name) => ({ model: name, label: LIMITS[name]?.label || name, out: Boolean(out[name]), missing: missing.has(name), used: counts[name] || 0, rpd: LIMITS[name]?.rpd || 0, rpm: LIMITS[name]?.rpm || 0 }));
  }
  // Seconds a model must wait before another request fits in its per-minute allowance.
  function minuteWait(model) {
    const limit = LIMITS[model]?.rpm;
    if (!limit) return 0;
    const now = Date.now();
    const stamps = (recent.get(model) || []).filter((at) => now - at < 60000);
    recent.set(model, stamps);
    return stamps.length >= limit ? stamps[0] + 60000 - now : 0;
  }
  const rest = new Map(); // model -> when it may be tried again
  const restWhy = new Map(); // model -> what put it to rest ("429", "429 today", "503", ...)
  const DAILY_REST_MS = 30 * 60000; // out of the day's free requests: no point asking again for a while
  // A model Google says it can't find for this key is skipped for half an hour, then tried again (and always listed).
  const MISSING_MS = 30 * 60000;
  const missing = {
    at: new Map(),
    has(name) {
      const when = this.at.get(name);
      if (when && Date.now() - when > MISSING_MS) { this.at.delete(name); return false; }
      return Boolean(when);
    },
    add(name) { this.at.set(name, Date.now()); },
  };
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
  const hasGeminiKey = () => Boolean(getKey());
  // "Can an AI request run?": a Gemini key, or a local model that is switched on.
  const hasKey = () => hasGeminiKey() || Boolean(window.SkybridgeLocal?.usable({ image: false }) || window.SkybridgeLocal?.usable({ image: true }));

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
    recent.set(model, [...(recent.get(model) || []), Date.now()]);
    tally(model);
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
    // Google already said, today, that every model that exists is used up: don't spend requests finding that out again.
    const outToday = readUsage().out || {};
    const askable = MODELS.filter((name) => !missing.has(name));
    if (askable.length && askable.every((name) => outToday[name])) {
      const error = new AiError("Used up for today.", "rate", { daily: true, status: 429 });
      error.tried = MODELS.map((name) => `${name.replace("gemini-", "")}: ${missing.has(name) ? "not found for this key (404)" : "429 today"}`);
      error.allDaily = missing.at.size === 0;
      error.someDaily = true;
      throw error;
    }
    for (let round = 0; round < 2; round += 1) {
      const now = Date.now();
      for (const name of MODELS) {
        const wait = minuteWait(name);
        if (wait > 0 && (rest.get(name) || 0) < now + wait) { rest.set(name, now + wait); restWhy.set(name, "per-minute limit"); }
      }
      let models = MODELS.filter((name) => !missing.has(name) && (rest.get(name) || 0) <= now);
      if (!models.length) models = MODELS.filter((name) => !missing.has(name)); // all resting: try anyway
      // A model whose day's allowance looks spent here goes last, so the others are used first.
      models = [...models.filter((name) => usedToday(name) < (LIMITS[name]?.rpd || Infinity)), ...models.filter((name) => usedToday(name) >= (LIMITS[name]?.rpd || Infinity))];
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
            if (error.kind === "rate" && error.daily) markOut(model);
            if (error.kind === "rate") rest.set(model, Date.now() + (error.daily ? DAILY_REST_MS : Math.max(timing.restRateMs, (error.retryAfter || 0) * 1000)));
            else if (error.kind === "busy" || error.kind === "timeout") rest.set(model, Date.now() + timing.restBusyMs);
            else if (error.kind === "missing") missing.add(model);
            if (error.kind !== "bad") break; // another config won't help; the next model might
          }
        }
        await sleep(300);
      }
      const transient = last && ["rate", "busy", "timeout"].includes(last.kind) && !last.daily;
      if (background || !transient) break;
      // Something you asked for: let the soonest model recover (a few seconds at most), then one more round.
      const soon = Math.min(...MODELS.filter((name) => !missing.has(name)).map((name) => rest.get(name) || 0));
      await sleep(Math.min(timing.waitMs, Math.max(2000, soon - Date.now())));
    }
    if (last) {
      // What happened to every model, so nothing is left out of the message.
      last.tried = MODELS.map((name) => {
        const short = name.replace("gemini-", "");
        if (missing.has(name)) return `${short}: not found for this key (404)`;
        if (restWhy.has(name)) return `${short}: ${restWhy.get(name)}`;
        const said = tried.find((t) => t.startsWith(`${short}:`));
        return said || `${short}: not tried`;
      });
      // Every model that exists said the same: the day's free requests are used up.
      const live = MODELS.filter((name) => !missing.has(name));
      last.allDaily = live.length > 0 && missing.at.size === 0 && live.every((name) => restWhy.get(name) === "429 today");
      last.someDaily = MODELS.some((name) => restWhy.get(name) === "429 today");
    }
    throw last || new AiError("No model answered.", "empty");
  }

  // The local model, when it is set up for this kind of request. Requests to it go one at a time.
  let localTail = Promise.resolve();
  async function viaLocal(image, prompt, schema, extra) {
    const Local = window.SkybridgeLocal;
    const run = localTail.then(async () => ({ model: Local.label(), text: await Local.chat({ prompt, image: typeof image === "string" ? image : null, schema, temperature: extra.temperature }) }));
    localTail = run.catch(() => {});
    return run;
  }

  // Gemini Live (no daily limit) for a picture task, when it is switched on. `live` says how to ask it and how to
  // turn its spoken answer into the JSON text the rest of this file reads. Any failure falls through to Flash.
  let liveRest = 0;
  async function viaLive(image, live) {
    const Live = window.SkybridgeLive;
    if (!live || typeof image !== "string" || !Live?.usable() || Date.now() < liveRest) return null;
    try {
      const { model, text } = await Live.ask({ image, prompt: live.prompt });
      return { model, text: live.toJson(text) };
    } catch (error) {
      lastLiveError = error.message;
      if (error.kind === "key" || error.kind === "network") liveRest = Date.now() + 5 * 60000; // don't retry at once
      return null;
    }
  }
  let lastLiveError = "";

  async function generate(image, prompt, schema, extra = {}, { background = false, live = null } = {}) {
    const Local = window.SkybridgeLocal;
    const pdf = Boolean(image && typeof image === "object");
    if (Local?.usable({ image: Boolean(image), pdf })) {
      try {
        return await viaLocal(image, prompt, schema, extra);
      } catch (error) {
        // "Instead of Gemini" never falls back; otherwise Gemini takes over when there is a key.
        if (Local.config().mode === "only" || !hasGeminiKey()) throw error;
      }
    } else if (Local && Local.config().mode === "only" && Local.endpoint(Local.config().url) && !pdf) {
      throw new AiError("Local only is on, but this needs a model that reads pictures. Switch on Can read pictures, or choose Before Gemini.", "local");
    }
    if (!hasGeminiKey()) throw new AiError("Add your Gemini key first.", "key");
    const spoken = await viaLive(image, live);
    if (spoken) return spoken;
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

  // Live answers by voice, so it is asked for three spoken parts and they are read back out of the transcript.
  const INDEX_LIVE = `This picture is one page of a student's handwritten math notebook. Answer out loud in exactly this form, in plain words:
"Title." then a short general name of the topic, 2 to 4 words, no equations (say "Untitled page" if it is empty).
"Tags." then 2 to 5 short topic tags separated by commas.
"Text." then what is written, line by line, in plain words, copying it without solving or correcting.
Say the words Title, Tags and Text before each part, and nothing else.`;
  function spokenIndex(said) {
    const parts = String(said).split(/\b(title|tags|text)\b[\s.:,-]*/i);
    const found = {};
    for (let i = 1; i + 1 < parts.length; i += 2) found[parts[i].toLowerCase()] ||= parts[i + 1].trim();
    if (!found.title) throw new Error("Live's answer had no title");
    return JSON.stringify({ title: (found.title || "").replace(/[.\s]+$/, ""), tags: (found.tags || "").split(/[,;]| and /).map((tag) => tag.replace(/[.\s]+$/, "").trim()).filter(Boolean), text: found.text || "" });
  }

  async function indexPage(image, options = {}) {
    const { model, text } = await generate(image, INDEX_PROMPT, null, {}, { background: options.background !== false, live: { prompt: INDEX_LIVE, toJson: spokenIndex } });
    return { model, ...cleanIndex(parseJson(text)) };
  }

  const TRANSCRIBE_LIVE = `The picture is a piece of a student's handwriting. Say out loud exactly what is written, line by line, in plain words, and nothing else.
Say each number as it is written, say "equals", "plus", "minus" and "times" for those symbols, and say "row" before each row of a matrix. Copy what is there even if it is wrong. Do not solve, correct or comment. If nothing is written, say "nothing".`;
  // "row 1 2 row 3 4" is a matrix: rows with commas between entries and semicolons between rows.
  function spokenText(said) {
    const lines = String(said).split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const rows = line.split(/\brow\b[\s:,.-]*/i).map((row) => row.trim().replace(/[.,\s]+$/, "")).filter(Boolean);
      if (!/\brow\b/i.test(line) || !rows.length) return line;
      return rows.map((row) => row.split(/[\s,]+/).filter(Boolean).join(", ")).join("; ");
    });
    // Said aloud, symbols come back as words.
    const out = lines.join("\n")
      .replace(/\bequals\b/gi, "=").replace(/\bplus\b/gi, "+").replace(/\bminus\b/gi, "-")
      .replace(/\btimes\b/gi, "*").replace(/\bdivided by\b/gi, "/").replace(/\bsquared\b/gi, "^2");
    return JSON.stringify({ text: /^nothing\.?$/i.test(out) ? "" : out });
  }

  async function transcribe(image) {
    const { model, text } = await generate(image, TRANSCRIBE_PROMPT, null, {}, { live: { prompt: TRANSCRIBE_LIVE, toJson: spokenText } });
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
    if (kind === "local") return `${error.message} (Notebooks > Smart features > Local model)`;
    if (kind === "key") return "Gemini didn't accept the key. Check it in Notebooks, then Smart features.";
    if (kind === "rate" && error.allDaily) return `Today's free Gemini requests are used up${where}. They come back around midnight Pacific time (3 AM Eastern). Until then page names wait and practice uses the built-in problems.`;
    if (kind === "rate" && error.someDaily) return `Gemini's free requests are used up for some models today${where}. The rest were busy or not available to your key. Live (unlimited) can take over: Notebooks > Smart features > Gemini Live.`;
    if (kind === "rate") return `Gemini's free limit was reached${where}. It slows down and tries again on its own.`;
    if (kind === "network") return "No connection to Gemini.";
    if (kind === "timeout") return `Gemini took too long${where}. It tries again on its own.`;
    if (kind === "busy") return `Google's servers are busy${where}. It tries again on its own.`;
    if (kind === "missing") return `None of the Gemini models answered${where}. They may not be offered to this key.`;
    if (kind === "format" || kind === "empty") return "Gemini's answer couldn't be read. Try again.";
    return error?.message || "Reading the page failed.";
  }

  window.SkybridgeAI = { hasKey, hasGeminiKey, modelState: () => MODELS.map((name) => ({ model: name, rest: restWhy.get(name) || "", missing: missing.has(name) })), getKey, setKey, usage, liveStatus, onUsage: (fn) => { usageListeners.add(fn); window.SkybridgeLive?.onUsage(fn); }, LIMITS, indexPage, transcribe, ask, askPdf, readWork, explain, busy, cleanIndex, shortTitle, parseJson, timing, MODELS };
})();
