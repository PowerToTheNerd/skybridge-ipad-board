/*
 * Homework PDFs: pick a PDF and Gemini (with your own key) reads it once and splits it into its problems
 * (1A, 1B, 2...). They are kept on this iPad, keyed by the file's fingerprint, so the same PDF is never
 * read again. A problem goes on a page like a practice problem and never shows an answer, even if the
 * PDF has them.
 *
 * With a picture-reading local model switched on, the PDF is instead turned into page pictures on the iPad (pdf.js)
 * and the local model reads them one page at a time, so no Gemini key or internet is needed.
 *
 * window.SkybridgeHomework = { importPdf(file, { onProgress }) -> { ok, set, cached | error }, list(), get(id), remove(id), restore(set), onChange(fn), problemOf(set, index) }
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

  // ---- The local model path: pdf.js renders each page, the local model reads it ----
  const MAX_PAGES = 40;
  const PAGE_WIDTH = 1500; // pixels: sharp enough for small print, small enough for a local model
  const PAGE_PROMPT = (n, total, text, first) => `This picture is page ${n} of ${total} of a student's homework PDF. Extract EVERY problem that appears on this page as its own item, in order.
Answer with JSON only: {"title": "...", "problems": [{"label": "...", "text": "...", "lines": ["..."]}]}
- title: ${first ? 'the assignment name, at most 40 characters (for example "Homework 4"); empty if none is printed' : 'leave empty'}.
- label: the problem number as printed, joined with its part letter: "1A", "1B", "2", "3.4 12". At most 12 characters. Every lettered or numbered part (a), (b)... is its own item.
- text: the task in one to three sentences, copied faithfully. If a part relies on a shared setup above it (like "Let A be the matrix below"), repeat what it needs so the item stands alone.
- lines: the given matrices, equations and expressions, each as LaTeX on its own line. Write a matrix like "A = \\begin{bmatrix} 2 & 1 \\\\ 4 & 3 \\end{bmatrix}" (rows separated by \\\\, entries by &). Copy every number and sign exactly; never guess a digit you can't see. Leave empty if there is nothing to show.
Never solve anything. NEVER include an answer, a solution, steps or a hint, even if the page prints them. Skip headers, class-wide instructions and anything that is not a problem. If a page has no problems, answer {"title": "", "problems": []}.
If a problem needs a figure you can't write down, say "(see the figure in the PDF)" in text.${text ? `\nThe PDF's own text for this page, which may be in an odd order, for checking numbers only:\n${text}` : ""}`;

  let pdfjsLoading = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    pdfjsLoading = pdfjsLoading || new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "vendor/pdfjs/pdf.min.js";
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      };
      script.onerror = () => { pdfjsLoading = null; reject(new Error("Couldn't load the PDF reader. Open the board once with a connection so it is saved on this iPad.")); };
      document.head.append(script);
    });
    return pdfjsLoading;
  }

  async function importLocal(buffer, onProgress) {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
    const total = Math.min(doc.numPages, MAX_PAGES);
    const found = [];
    const skipped = [];
    let title = "";
    for (let n = 1; n <= total; n++) {
      onProgress?.(`Reading page ${n} of ${total}…`);
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, PAGE_WIDTH / base.width) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      let text = "";
      try { text = (await page.getTextContent()).items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim().slice(0, 2500); } catch {}
      const image = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
      let data = null;
      for (let attempt = 0; attempt < 2 && !data; attempt++) {
        try { data = (await AI.askPage(image, PAGE_PROMPT(n, total, text, n === 1), null, "image/jpeg")).data; }
        catch (error) {
          // A server that can't be reached, or refuses, won't do better on the next page.
          if (error?.kind === "local" && /reach|accept|Pair|blocked|CORS|connected/i.test(error.message)) throw error;
        }
      }
      if (!data) { skipped.push(n); continue; }
      if (!title && data.title) title = clean(data.title, 40);
      found.push(...(Array.isArray(data.problems) ? data.problems : []));
    }
    return { title, problems: cleanProblems(found), skipped, pages: doc.numPages > total ? total : 0 };
  }

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

  async function importPdf(file, { onProgress } = {}) {
    if (!file) return { ok: false, error: "No file picked." };
    if (file.size > MAX_BYTES) return { ok: false, error: "That PDF is over 18 MB. Try a smaller scan or split it." };
    const buffer = await file.arrayBuffer();
    if (new TextDecoder("latin1").decode(buffer.slice(0, 5)) !== "%PDF-") return { ok: false, error: "That doesn't look like a PDF." };
    const id = await fingerprint(buffer);
    const have = await get(id);
    if (have) return { ok: true, set: have, cached: true };
    const Local = window.SkybridgeLocal;
    const local = Boolean(Local?.usable({ image: true }));
    const name = clean(file.name.replace(/\.pdf$/i, ""), 40) || "Homework";
    const save = async (data, how) => {
      if (!data.problems.length) return { ok: false, error: "Couldn't find any problems in that PDF. If it is a photo, try a clearer scan." };
      const set = { id, name: clean(data.title, 40) || name, file: name, added: Date.now(), problems: data.problems, by: how };
      await put(set);
      changed();
      const notes = [];
      if (data.skipped?.length) notes.push(`page ${data.skipped.join(", ")} couldn't be read`);
      if (data.pages) notes.push(`only the first ${data.pages} pages were read`);
      return { ok: true, set, cached: false, note: notes.join("; ") };
    };
    let localError = "";
    if (local) {
      try {
        return await save(await importLocal(buffer, onProgress), "local");
      } catch (error) {
        localError = error?.message || "The local model couldn't read the PDF.";
        if (Local.config().mode === "only" || !AI?.hasGeminiKey()) return { ok: false, error: localError };
        onProgress?.("The local model couldn't, asking Gemini…");
      }
    }
    if (!AI?.hasGeminiKey()) return { ok: false, error: "Reading a PDF needs your free Gemini key, or a local model that reads pictures. Add one under Notebooks, then Smart features." };
    if (navigator.onLine === false) return { ok: false, error: "No connection. Reading a new PDF with Gemini needs the internet (once)." };
    try {
      const { data } = await AI.askPdf(toBase64(buffer), PROMPT, SCHEMA);
      return await save({ title: data.title, problems: cleanProblems(data.problems) }, "gemini");
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
