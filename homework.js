/*
 * Homework PDFs: pick a PDF and Gemini (with your own key) reads it once and splits it into its problems
 * (1A, 1B, 2...). They are kept on this iPad, keyed by the file's fingerprint, so the same PDF is never
 * read again. A problem goes on a page like a practice problem and never shows an answer, even if the
 * PDF has them.
 *
 * window.SkybridgeHomework = { importPdf(file) -> { ok, set, cached | error }, list(), get(id), remove(id), restore(set), onChange(fn), problemOf(set, index) }
 */
(() => {
  const AI = window.SkybridgeAI;
  const DB = "skybridge-homework";
  const STORE = "sets";
  const MAX_BYTES = 18 * 1024 * 1024; // inline upload limit with room for the request
  const MAX_PROBLEMS = 120;

  const STR = { type: "STRING" };
  const SCHEMA = {
    type: "OBJECT",
    properties: {
      title: STR,
      problems: { type: "ARRAY", items: { type: "OBJECT", properties: { label: STR, text: STR, lines: { type: "ARRAY", items: STR } }, required: ["label", "text", "lines"] } },
    },
    required: ["title", "problems"],
  };

  const PROMPT = `This PDF is a student's homework or problem set. Extract EVERY problem as its own item, in order.
Answer with JSON only: {"title": "...", "problems": [{"label": "...", "text": "...", "lines": ["..."]}, ...]}
- title: the assignment name, at most 40 characters (for example "Homework 4"). If there is none, use the file's subject.
- label: the problem number as printed, joined with its part letter: "1A", "1B", "2", "3.4 12". At most 12 characters, no spaces if possible. Every lettered or numbered part (a), (b)... is its own item.
- text: the task in one to three sentences, copied faithfully from the PDF. If a part relies on a shared setup above it (like "Let A be the matrix below"), repeat what it needs so the item stands alone.
- lines: the given matrices, equations and expressions, each as LaTeX on its own line. Write a matrix like "A = \\begin{bmatrix} 2 & 1 \\\\ 4 & 3 \\end{bmatrix}" (rows separated by \\\\, entries by &). Leave it empty if there is nothing to show.
Never solve anything. NEVER include an answer, a solution, steps or a hint, even if the PDF prints them (leave those out). Skip headers, instructions to the whole class, and anything that is not a problem.
If a problem needs a picture or graph you cannot write down, say "(see the figure in the PDF)" in text.`;

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
  async function all() {
    const db = await openDb();
    if (!db) return [...memory.values()];
    return new Promise((resolve) => {
      const request = db.transaction(STORE).objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([...memory.values()]);
    });
  }
  async function put(set) {
    memory.set(set.id, set);
    const db = await openDb();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(set);
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    });
  }
  async function drop(id) {
    memory.delete(id);
    const db = await openDb();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    });
  }

  const listeners = new Set();
  const changed = () => listeners.forEach((fn) => fn());
  const list = async () => (await all()).sort((a, b) => b.added - a.added);
  const get = async (id) => (await all()).find((set) => set.id === id) || null;

  async function fingerprint(buffer) {
    try {
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch {
      let h = 5381; // no WebCrypto (an insecure page): a plain hash of every 7th byte, plus the size
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 7) h = (Math.imul(h, 33) ^ bytes[i]) >>> 0;
      return `${h.toString(36)}-${bytes.length}`;
    }
  }

  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  const clean = (value, max) => String(value ?? "").split(/\s+/).join(" ").trim().slice(0, max);
  function cleanProblems(raw) {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(raw) ? raw : []) {
      const lines = (Array.isArray(item?.lines) ? item.lines : [item?.lines]).map((line) => clean(line, 500)).filter(Boolean).slice(0, 8);
      const text = clean(item?.text, 900);
      if (!text && !lines.length) continue;
      let label = clean(item?.label, 12) || String(out.length + 1);
      while (seen.has(label)) label = `${label}'`;
      seen.add(label);
      // An answer the PDF printed is never kept.
      if (/\b(solution|answer key)\b/i.test(`${text} ${lines.join(" ")}`)) continue;
      out.push({ label, text, lines });
      if (out.length >= MAX_PROBLEMS) break;
    }
    return out;
  }

  async function importPdf(file) {
    if (!file) return { ok: false, error: "No file picked." };
    if (file.size > MAX_BYTES) return { ok: false, error: "That PDF is over 18 MB. Try a smaller scan or split it." };
    const buffer = await file.arrayBuffer();
    if (new TextDecoder("latin1").decode(buffer.slice(0, 5)) !== "%PDF-") return { ok: false, error: "That doesn't look like a PDF." };
    const id = await fingerprint(buffer);
    const have = await get(id);
    if (have) return { ok: true, set: have, cached: true };
    if (!AI?.hasKey()) return { ok: false, error: "Reading a PDF needs your free Gemini key. Add it under Notebooks, then Smart features." };
    if (navigator.onLine === false) return { ok: false, error: "No connection. Reading a new PDF needs the internet (once)." };
    try {
      const { data } = await AI.askPdf(toBase64(buffer), PROMPT, SCHEMA);
      const problems = cleanProblems(data.problems);
      if (!problems.length) return { ok: false, error: "Couldn't find any problems in that PDF. If it is a photo, try a clearer scan." };
      const name = clean(file.name.replace(/\.pdf$/i, ""), 40) || "Homework";
      const set = { id, name: clean(data.title, 40) || name, file: name, added: Date.now(), problems };
      await put(set);
      changed();
      return { ok: true, set, cached: false };
    } catch (error) {
      return { ok: false, error: AI.explain(error) };
    }
  }

  // The card for one problem: the same shape a practice problem has.
  const problemOf = (set, index) => {
    const item = set.problems[index];
    return item ? { topic: "homework", pick: "homework", source: "homework", set: set.id, index, title: item.label, text: item.text, lines: item.lines } : null;
  };

  window.SkybridgeHomework = {
    importPdf, list, get, problemOf,
    remove: async (id) => { const set = await get(id); await drop(id); changed(); return set; },
    restore: async (set) => { await put(set); changed(); },
    onChange: (fn) => listeners.add(fn),
  };
})();
