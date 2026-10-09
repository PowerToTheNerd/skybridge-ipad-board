/*
 * Reads a picture of a notebook page with Gemini, straight from the iPad using your own API key
 * (entered once in the app and kept only on this iPad). Used to label pages (title, tags, searchable
 * text) and to read handwriting for Check my work. The prompts match backend/checker.py.
 *
 * window.SkybridgeAI = { hasKey, getKey, setKey, indexPage(imageBase64), readWork(imageBase64, { problem, mode }), explain(error) }
 */
(() => {
  const KEY = "skybridge.geminiKey";
  const MODELS = ["gemini-3.8-flash", "gemini-2.5-flash"];
  const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
  const ATTEMPT_MS = 30000;

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
    constructor(message, kind) { super(message); this.kind = kind; }
  }

  const INDEX_PROMPT = `You are labelling one page of a student's handwritten math notebook. The image is that page.
Answer with JSON only: {"title": "...", "tags": ["..."], "text": "..."}
- title: at most 60 characters, naming what the page is about, like "HW4 3a: U and V by row reduction".
  Use the problem number if one is written. If the page is empty or unreadable, use "Untitled page".
- tags: 2 to 5 short lowercase topic tags, like "row reduction" or "elementary matrices".
- text: a plain-text transcription of everything written, one line per line, matrices as rows
  ("1, 2; 3, 4"), under 3000 characters. Copy what is written; do not solve, correct or comment.`;

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
    const timer = setTimeout(() => controller.abort(), ATTEMPT_MS);
    let response;
    try {
      response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": getKey() },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ inline_data: { mime_type: "image/png", data: image } }, { text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", ...config },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new AiError(error.name === "AbortError" ? "Gemini took too long." : "No connection to Gemini.", error.name === "AbortError" ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.json())?.error?.message || ""; } catch {}
      const kind = response.status === 429 ? "rate"
        : response.status === 404 ? "missing"
        : response.status >= 500 ? "busy"
        : /api key/i.test(detail) || response.status === 401 || response.status === 403 ? "key"
        : "bad";
      throw new AiError(detail.slice(0, 160) || `Gemini answered ${response.status}.`, kind);
    }
    const data = await response.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("");
    if (!text.trim()) throw new AiError("Gemini gave an empty answer.", "empty");
    return text;
  }

  // Each model in turn; a rate limit, a missing model or a busy server moves on to the next.
  async function generate(image, prompt, schema) {
    if (!hasKey()) throw new AiError("Add your Gemini key first.", "key");
    let last = null;
    for (const model of MODELS) {
      const configs = [
        { ...(schema ? { responseSchema: schema } : {}), thinkingConfig: { thinkingBudget: 1024 } },
        {}, // a model that doesn't take that config
      ];
      for (const config of configs) {
        try {
          const text = await call(model, image, prompt, config);
          return { model, text };
        } catch (error) {
          last = error;
          if (error.kind === "key" || error.kind === "network") throw error;
          if (error.kind !== "bad") break; // another config won't help; the next model might
        }
      }
    }
    throw last || new AiError("No model answered.", "empty");
  }

  function cleanIndex(data) {
    const tags = [];
    for (const raw of Array.isArray(data.tags) ? data.tags : []) {
      const tag = String(raw).toLowerCase().split(/\s+/).filter(Boolean).join(" ").slice(0, 30);
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
    const title = String(data.title ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, 80) || "Untitled page";
    const text = Array.isArray(data.text) ? data.text.join("\n") : String(data.text ?? "");
    return { title, tags: tags.slice(0, 6), text: text.trim().slice(0, 4000) };
  }

  async function indexPage(image) {
    const { model, text } = await generate(image, INDEX_PROMPT, null);
    return { model, ...cleanIndex(parseJson(text)) };
  }

  async function readWork(image, { problem = "", mode = "practice" } = {}) {
    const { model, text } = await generate(image, readPrompt(problem, mode), READING_SCHEMA);
    return { model, reading: parseJson(text) };
  }

  function explain(error) {
    const kind = error?.kind;
    if (kind === "key") return "Gemini didn't accept the key. Check it in Notebooks, then Smart features.";
    if (kind === "rate") return "Gemini is rate limited right now. Try again in a minute.";
    if (kind === "network") return "No connection to Gemini.";
    if (kind === "timeout") return "Gemini took too long. Try again.";
    if (kind === "busy" || kind === "missing") return "Gemini is busy or the model isn't available. Try again shortly.";
    if (kind === "format" || kind === "empty") return "Gemini's answer couldn't be read. Try again.";
    return error?.message || "Reading the page failed.";
  }

  window.SkybridgeAI = { hasKey, getKey, setKey, indexPage, readWork, explain, cleanIndex, parseJson };
})();
