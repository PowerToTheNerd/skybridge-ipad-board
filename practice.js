/*
 * Practice problems: pick a topic, and Gemini (with your own key) writes a batch for it, kept on this iPad
 * and given out one at a time, never the same one twice, so most of the time no call is needed at all. It goes on
 * the current page as a problem card, or into a new notebook. It never gives the answer: Check my work
 * grades what you write, with the exact checker.
 *
 * Problems are made to suit that checker: whole numbers or simple fractions, small matrices, and the
 * matrix really is invertible (or has an LU with no row swaps) when the topic needs that. A problem
 * that does not check out is thrown away and another is asked for.
 *
 * window.SkybridgePractice = { TOPICS, take(topicId) -> { ok, problem, fromBank, left | error }, counts(), onChange(fn), items(problem), problemText(problem) }
 */
(() => {
  const AI = window.SkybridgeAI;
  const MathCheck = window.SkybridgeMath;

  // need: "invertible" (det is not 0), "lu" (every leading minor is not 0, so no row swaps), or "any".
  const TOPICS = [
    { id: "add", label: "Matrix addition", need: "any", brief: "adding or subtracting two matrices of the same size, possibly with a scalar multiple (like 2A - B)" },
    { id: "multiply", label: "Matrix multiplication", need: "any", brief: "multiplying two matrices (sizes that match, such as 2x3 times 3x2 or 3x3 times 3x3)" },
    { id: "rref", label: "Row reduction", need: "any", brief: "reducing a matrix to reduced row echelon form by row operations (3x3 or 3x4, with at least one pivot that is not 1)" },
    { id: "lu", label: "LU decomposition", need: "lu", brief: "finding the LU decomposition of a 3x3 matrix (no row swaps needed, so L and U exist)" },
    { id: "inverse", label: "Inverses", need: "invertible", brief: "finding the inverse of an invertible 2x2 or 3x3 matrix by row reducing [A | I]" },
    { id: "det", label: "Determinants", need: "any", brief: "finding the determinant of a 3x3 or 4x4 matrix, using row operations or cofactor expansion" },
    { id: "elementary", label: "Elementary matrices", need: "invertible", brief: "writing a matrix as a product of elementary matrices, or finding the elementary matrix for a given row operation (3x3)" },
    { id: "system", label: "Linear systems", need: "any", brief: "solving a system of 3 linear equations in 3 unknowns by row reduction (give it as an augmented matrix)" },
    { id: "random", label: "Random", need: "any", brief: "any one linear algebra problem about matrices (pick the type at random)" },
  ];

  const STR = { type: "STRING" };
  const ONE = {
    type: "OBJECT",
    properties: { title: STR, text: STR, lines: { type: "ARRAY", items: STR } },
    required: ["title", "text", "lines"],
  };
  const SCHEMA = { type: "OBJECT", properties: { problems: { type: "ARRAY", items: ONE } }, required: ["problems"] };
  const BATCH = 5; // problems asked for in one call
  const LOW = 2; // unseen problems left before the bank is topped up in the background

  const promptFor = (topic, avoid, count) => `You write ${count} DIFFERENT practice problems for a student studying linear algebra. Topic: ${topic.brief}.
Answer with JSON only: {"problems": [{"title": "...", "text": "...", "lines": ["..."]}, ...]}
For each problem:
- title: the topic name, at most 28 characters.
- text: the instruction, one or two short sentences, like "Find the LU decomposition of A."
- lines: the given matrices or equations, each as LaTeX on its own line. Write a matrix like
  "A = \\begin{bmatrix} 2 & 1 \\\\ 4 & 3 \\end{bmatrix}" (rows separated by \\\\, entries by &).
Rules: use whole numbers (small, like -5 to 9) or simple fractions only. Make each one solvable by hand with one
exact answer, and vary the sizes and the numbers from problem to problem. NEVER include the answer, any steps, any hint,
or the word "solution".
Variety: ${Math.floor(Math.random() * 1e6)}.${avoid?.length ? ` Do not repeat these: ${avoid.slice(-8).join(" | ")}.` : ""}`;

  // The matrices written in a problem's lines, as rows of numbers (null if any is not exact numbers).
  function matricesOf(lines) {
    const found = [];
    for (const line of lines) {
      for (const match of String(line).matchAll(/\\begin\{[pbvBV]?matrix\}([\s\S]*?)\\end\{[pbvBV]?matrix\}/g)) {
        try {
          found.push(MathCheck.parseMatrix ? MathCheck.parseMatrix(match[1]) : null);
        } catch {
          return null;
        }
      }
    }
    return found.length ? found : null;
  }

  const asText = (matrix) => MathCheck.fmtMatrix(matrix);

  // Does the problem suit the checker? Returns "" when it does, else why not.
  function trouble(topic, problem) {
    if (!problem.title || !problem.text || !problem.lines.length) return "incomplete";
    if (/\b(solution|answer|hint)s?\b/i.test(`${problem.text} ${problem.lines.join(" ")}`)) return "gives the answer away";
    const matrices = matricesOf(problem.lines);
    if (!matrices) return "no readable matrix";
    if (matrices.some((m) => m.length > 4 || m[0].length > 5)) return "too big";
    const first = matrices[0];
    if (topic.need === "any") return "";
    if (first.length !== first[0].length) return "not square";
    const det = (m) => { try { return MathCheck.run({ operation: "determinant", matrix: asText(m) }); } catch { return null; } };
    const whole = det(first);
    if (!whole || whole.invertible !== true) return "not invertible";
    if (topic.need === "lu") {
      for (let k = 1; k < first.length; k += 1) {
        const minor = det(first.slice(0, k).map((row) => row.slice(0, k)));
        if (!minor || minor.invertible !== true) return "needs a row swap";
      }
    }
    return "";
  }

  // ---- the bank: problems written ahead, kept on the iPad, each given out once ----------------------
  // One call writes a batch; "next problem" then costs no call at all until the bank runs low.
  const DB = "skybridge-practice";
  const STORE = "bank";
  const memory = new Map();
  let dbPromise = null;
  function openDb() {
    dbPromise = dbPromise || new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
    return dbPromise;
  }
  async function rawRecords() {
    const db = await openDb();
    if (!db) return [...memory.values()];
    return new Promise((resolve) => {
      const request = db.transaction(STORE).objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([...memory.values()]);
    });
  }
  // The built-in bank (problems.json, made by backend/make_problems.py) is added once and again whenever
  // new problems ship. Seen marks are never touched. Built-ins sort ahead of Gemini's (small "at").
  // The answers in that file are for a checker only; they are dropped here and never shown.
  const seeded = (async () => {
    try {
      const response = await fetch("problems.json");
      if (!response.ok) return;
      const list = (await response.json()).problems || [];
      const have = new Set((await rawRecords()).map((r) => r.id));
      const db = await openDb();
      list.forEach((item, index) => {
        const id = `built:${item.id}`;
        if (have.has(id)) return;
        const record = {
          id, topic: item.topic, builtin: true, seen: false, at: index,
          problem: { topic: item.topic, title: item.title, text: item.text, lines: item.lines },
        };
        memory.set(id, record);
        if (db) db.transaction(STORE, "readwrite").objectStore(STORE).put(record);
      });
    } catch { /* offline before the first load: Gemini problems still work */ }
  })();
  const allRecords = async () => { await seeded; return rawRecords(); };

  async function putRecord(record) {
    memory.set(record.id, record);
    const db = await openDb();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    });
  }

  // The same problem in other words of spacing or case is the same problem.
  function fingerprint(problem) {
    const text = `${problem.text} ${problem.lines.join(" ")}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
    let h = 5381;
    for (let i = 0; i < text.length; i += 1) h = (Math.imul(h, 33) ^ text.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  const listeners = new Set();
  const changed = () => listeners.forEach((fn) => fn());
  async function counts() {
    const out = { total: 0 };
    for (const record of await allRecords()) {
      if (record.seen) continue;
      out[record.topic] = (out[record.topic] || 0) + 1;
      out.total += 1;
    }
    return out;
  }

  const concrete = TOPICS.filter((t) => t.id !== "random");
  const topicOf = (id) => TOPICS.find((t) => t.id === id) || TOPICS[TOPICS.length - 1];

  // Write a batch for a topic and keep the good ones. `background` is for quiet top-ups.
  const filling = new Map();
  function refill(topic, { background = false } = {}) {
    if (filling.has(topic.id)) return filling.get(topic.id);
    const job = (async () => {
      if (!AI?.hasKey()) return { ok: false, error: "That's every built-in problem for this topic. For more, add your free Gemini key under Notebooks, then Smart features." };
      if (navigator.onLine === false) return { ok: false, error: "No connection. New problems need the internet." };
      const records = await allRecords();
      const known = new Set(records.map((r) => r.id));
      const avoid = records.filter((r) => r.topic === topic.id).slice(-8).map((r) => r.problem.text);
      let why = "";
      try {
        const { data } = await AI.ask(promptFor(topic, avoid, BATCH), SCHEMA, { background });
        let added = 0;
        for (const raw of Array.isArray(data.problems) ? data.problems : []) {
          const lines = (Array.isArray(raw?.lines) ? raw.lines : [raw?.lines]).map((line) => String(line ?? "").trim()).filter(Boolean).slice(0, 6);
          const problem = {
            topic: topic.id,
            title: String(raw?.title || topic.label).split(/\s+/).join(" ").slice(0, 40) || topic.label,
            text: String(raw?.text || "").trim().slice(0, 300),
            lines,
          };
          why = trouble(topic, problem) || why;
          if (trouble(topic, problem)) continue;
          const id = `${topic.id}:${fingerprint(problem)}`;
          if (known.has(id)) continue; // already in the bank, seen or not
          known.add(id);
          await putRecord({ id, topic: topic.id, problem, seen: false, at: Date.now() });
          added += 1;
        }
        changed();
        return added ? { ok: true, added } : { ok: false, error: `Gemini's problems didn't check out${why ? ` (${why})` : ""}. Try again.` };
      } catch (error) {
        return { ok: false, error: AI.explain(error) };
      }
    })().finally(() => filling.delete(topic.id));
    filling.set(topic.id, job);
    return job;
  }

  let coolUntil = 0;
  // Keep the bank from running dry: quietly, only online, only when Google isn't pushing back.
  async function topUp(topic) {
    if (Date.now() < coolUntil || !AI?.hasKey() || navigator.onLine === false || AI.busy?.()) return;
    const records = (await allRecords()).filter((r) => r.topic === topic.id && !r.seen);
    // Gemini only tops up once the built-in problems for this topic are used up.
    if (records.some((r) => r.builtin) || records.length >= LOW) return;
    const result = await refill(topic, { background: true });
    if (!result.ok) coolUntil = Date.now() + 5 * 60000;
  }

  // The next problem for a topic that this iPad hasn't given yet. From the bank when it can; one call
  // (which fills the bank) when it can't. Random picks a topic that has problems waiting, if any.
  async function take(pick) {
    let topic = topicOf(pick);
    if (topic.id === "random") {
      const have = await counts();
      const stocked = concrete.filter((t) => (have[t.id] || 0) > 0);
      const pool = stocked.length ? stocked : concrete;
      topic = pool[Math.floor(Math.random() * pool.length)];
    }
    const waiting = async () => (await allRecords()).filter((r) => r.topic === topic.id && !r.seen).sort((a, b) => a.at - b.at);
    let pool = await waiting();
    let fromBank = true;
    if (!pool.length) {
      const made = await refill(topic);
      if (!made.ok) return made;
      pool = await waiting();
      fromBank = false;
      if (!pool.length) return { ok: false, error: "No new problem this time. Try again." };
    }
    const record = pool[0];
    record.seen = true;
    record.seenAt = Date.now();
    await putRecord(record);
    changed();
    const left = pool.length - 1;
    if (left < LOW) topUp(topic); // not waited for
    return { ok: true, problem: { ...record.problem, pick }, fromBank, left };
  }

  // The packet the problem card draws (the same card Gemini uses on My board).
  const items = (problem) => [
    { kind: "text", text: problem.text },
    ...problem.lines.map((line) => ({ kind: "math", latex: line })),
  ];

  const problemText = (problem) => (problem ? [problem.title, problem.text, ...problem.lines].join(". ") : "");

  window.SkybridgePractice = { TOPICS, take, counts, onChange: (fn) => listeners.add(fn), items, problemText, trouble };
})();
