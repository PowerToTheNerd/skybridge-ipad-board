/*
 * Smart notebooks: each page gets a title and topic tags, and your handwriting becomes searchable
 * text. Pages are read by Skybridge on the PC when it is on (its local vision model, if you use
 * one), otherwise by Gemini with your own key when the iPad is online. A page written offline waits.
 * Also: Check my work without the PC (Gemini reads the page, mathcheck.js checks the numbers exactly).
 *
 * It only labels and verifies. It never solves your problems.
 *
 * window.SkybridgeSmart = { init(bridge), touched(), pump(), onRelay(message), search(query), check(), status(), onStatus(fn), pending() }
 */
(() => {
  const Notebooks = window.SkybridgeNotebooks;
  const AI = window.SkybridgeAI;
  const MathCheck = window.SkybridgeMath;
  const MIN_STROKES = 3; // a page with less than this isn't worth reading
  const timing = { idleMs: 10000, retryMs: 60000 }; // read a page after a pause in writing; wait before retrying a failure
  const PC_WAIT_MS = 70000;
  const MAX_SIDE = 1600;

  let bridge = null;
  let running = false;
  let again = false;
  let blockedUntil = 0; // no reading before this time (Google asked us to slow down)
  let failures = 0; // read attempts in a row that Google turned away: each waits twice as long as the last
  let timer = 0;
  let message = "";
  let waiting = 0;
  const listeners = new Set();
  const tried = new Map();
  const asked = new Map(); // read requests sent to the PC, waiting for an answer

  // Things worth telling the person (a page named, or why it was not): shown as a toast by the page.
  const noticeListeners = new Set();
  let lastNotice = { text: "", at: 0 };
  function notify(text, open = false) {
    // The same trouble is told once, not every retry.
    if (text === lastNotice.text && Date.now() - lastNotice.at < 5 * 60000) return;
    lastNotice = { text, at: Date.now() };
    noticeListeners.forEach((fn) => fn(text, open));
  }
  // Without a key the nudge comes at most once a day, so it never nags.
  function nudgeDue() {
    try {
      const last = Number(localStorage.getItem("skybridge.keyNudge") || 0);
      if (Date.now() - last < 24 * 3600 * 1000) return false;
      localStorage.setItem("skybridge.keyNudge", String(Date.now()));
    } catch { /* storage blocked: nudge once per visit */ }
    return true;
  }
  let force = false; // "Read now": don't wait for a pause in writing

  const status = () => message;
  function setStatus(text) {
    message = text;
    listeners.forEach((fn) => fn(text));
  }

  const reader = () => (bridge?.pcReady() ? "pc" : AI?.hasKey() && navigator.onLine !== false ? "gemini" : null);

  // ---- a picture of a page ---------------------------------------------------------------------
  function shrink(canvas, side = MAX_SIDE) {
    const scale = Math.min(1, side / Math.max(canvas.width, canvas.height));
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(canvas.width * scale));
    out.height = Math.max(1, Math.round(canvas.height * scale));
    out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height);
    return out.toDataURL("image/png").split(",")[1];
  }

  async function pictureOf(strokes) {
    const { canvas } = await window.SkybridgeExport.renderBoard({ strokes, withCard: false });
    return shrink(canvas);
  }

  // ---- reading pages (labels) ------------------------------------------------------------------
  function readViaPc(image) {
    return new Promise((resolve, reject) => {
      const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const timeout = setTimeout(() => { asked.delete(id); reject(Object.assign(new Error("No answer from the PC."), { kind: "pc" })); }, PC_WAIT_MS);
      asked.set(id, { resolve, reject, timeout });
      bridge.relaySend({ t: "read", id, image, mime: "image/png" });
    });
  }

  function onRelay(result) {
    const wait = asked.get(result.id);
    if (!wait) return;
    asked.delete(result.id);
    clearTimeout(wait.timeout);
    if (result.ok) wait.resolve({ model: "Skybridge", title: result.title, tags: result.tags || [], text: result.text || "" });
    else wait.reject(Object.assign(new Error(result.error || "The PC couldn't read the page."), { kind: "pc" }));
  }

  const manual = new Set(); // pages you asked to be read again
  const autoDone = new Set(); // pages read in the background this session: never read again that way
  const readLog = []; // what was read this session, for the Smart features page: { name, how, at, manual }
  const MAX_LOG = 50;
  async function readNotebook(meta, how) {
    const found = await Notebooks.load(meta.id);
    if (!found) return;
    const hash = Notebooks.hashOf(found.strokes);
    let image = null;
    try { image = await pictureOf(found.strokes); } catch { /* nothing drawn: nothing to read */ }
    let labels = null;
    if (image) {
      if (how === "pc") {
        try {
          labels = await readViaPc(image);
        } catch (error) {
          if (!AI.hasKey() || navigator.onLine === false) throw error;
        }
      }
      if (!labels) labels = await AI.indexPage(image, { background: !force });
    }
    const changes = { readHash: hash, readAt: Date.now() };
    if (labels) {
      const title = AI.shortTitle(labels.title) || "Untitled page";
      Object.assign(changes, { title, tags: labels.tags, text: labels.text });
      if (!meta.named && title !== "Untitled page") changes.name = title;
    }
    await bridge.saveMeta(meta.id, changes);
    readLog.push({ name: meta.name, how, at: Date.now(), manual: manual.has(meta.id) });
    if (readLog.length > MAX_LOG) readLog.shift();
    if (!manual.has(meta.id)) autoDone.add(meta.id);
    manual.delete(meta.id);
    return changes.name || "";
  }

  // Handwriting to typed text for the strokes you pick (the lasso's "To text"): read by the PC when
  // it is on, otherwise by Gemini with your key, the same readers that name pages.
  // Answers already paid for are kept for a while, so asking again about the same writing costs no call.
  const memo = new Map();
  const MEMO_MS = 30 * 60000;
  const MEMO_MAX = 24;
  function remember(key, value) {
    memo.set(key, { value, at: Date.now() });
    while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
  }
  function recall(key) {
    const hit = memo.get(key);
    if (!hit || Date.now() - hit.at > MEMO_MS) { memo.delete(key); return null; }
    return hit.value;
  }

  async function convert(strokes) {
    const key = `text|${Notebooks.hashOf(strokes)}`;
    const known = recall(key);
    if (known !== null) return { ok: true, text: known, cached: true };
    const how = reader();
    if (!how) {
      return { ok: false, error: navigator.onLine === false && AI?.hasKey() ? "No connection. Turning writing into text needs the internet or your PC." : "To turn writing into text, add your free Gemini key under Notebooks, then Smart features." };
    }
    let image;
    try { image = await pictureOf(strokes); } catch { return { ok: false, error: "There is nothing written there." }; }
    if (how === "pc") {
      try {
        const read = await readViaPc(image);
        const text = String(read.text || "").trim();
        if (text) remember(key, text);
        return { ok: true, text };
      } catch (error) {
        if (!AI?.hasKey() || navigator.onLine === false) return { ok: false, error: error.message };
      }
    }
    try {
      const text = (await AI.transcribe(image)).text;
      if (text) remember(key, text);
      return { ok: true, text };
    } catch (error) {
      return { ok: false, error: AI.explain(error) };
    }
  }

  async function dueNotebooks() {
    const books = await Notebooks.list();
    // A page is read once. After that (named by a reader or by you) it is left alone, however much you write
    // on it, until you ask for it again (Re-read on the page's row in the notebook list).
    const unread = books.filter((book) => book.count >= MIN_STROKES && book.hash && (manual.has(book.id) || (!book.readHash && !book.named && !autoDone.has(book.id))));
    waiting = unread.length;
    return unread;
  }

  async function pump() {
    if (!bridge) return;
    if (running) { again = true; return; } // asked while busy: look again when this round ends
    if (!force && Date.now() < blockedUntil) {
      // Slowing down after a rate limit or a busy server: whatever woke us, wait out the rest of it.
      clearTimeout(timer);
      timer = setTimeout(pump, blockedUntil - Date.now() + 100);
      return;
    }
    running = true;
    again = false;
    try {
      for (;;) {
        const unread = await dueNotebooks();
        const how = reader();
        if (!unread.length) { setStatus(""); break; }
        if (!how) {
          setStatus(`${unread.length} ${unread.length === 1 ? "page is" : "pages are"} waiting to be read`);
          const idle = unread.some((book) => bridge.openId() !== book.id || Date.now() - bridge.lastChange() >= timing.idleMs);
          if (idle && (force || (!AI?.hasKey() && nudgeDue()))) {
            notify(navigator.onLine === false && AI?.hasKey() ? "Pages can't be named while the iPad is offline. They will be when it is back online." : "Pages can't be named yet. Add your free Gemini key under Notebooks, then Smart features.", !AI?.hasKey());
          }
          break;
        }
        const ready = unread.filter((book) => Date.now() - (tried.get(book.id) || 0) > timing.retryMs);
        if (!ready.length) break;
        const next = ready[0];
        // The page you are writing on waits until you pause.
        if (!force && bridge.openId() === next.id && Date.now() - bridge.lastChange() < timing.idleMs) {
          clearTimeout(timer);
          timer = setTimeout(pump, timing.idleMs - (Date.now() - bridge.lastChange()) + 500);
          break;
        }
        tried.set(next.id, Date.now());
        setStatus(`Reading “${next.name}”…`);
        try {
          const named = await readNotebook(next, how);
          failures = 0;
          setStatus("");
          if (named) notify(`Named this page “${named}”`);
        } catch (error) {
          const why = error.kind === "pc" ? error.message : AI.explain(error);
          setStatus(why);
          notify(`Couldn't name “${next.name}”. ${why}`, error.kind === "key");
          // A key, connection, rate-limit or busy-server problem stops the loop. Hammering the next page would
          // only make it worse, so wait (twice as long each time, up to ten minutes) and try again.
          if (["key", "network", "rate", "busy", "timeout", "missing"].includes(error.kind)) {
            failures += 1;
            clearTimeout(timer);
            const delay = (error.allDaily ? 30 * 60000 : Math.min(10 * 60000, timing.retryMs * 2 ** (failures - 1))) + 500;
            blockedUntil = Date.now() + delay;
            timer = setTimeout(pump, delay);
            break;
          }
          continue;
        }
      }
    } finally {
      running = false;
      bridge?.refresh();
      if (again) { clearTimeout(timer); timer = setTimeout(pump, 300); }
    }
  }

  // Read every waiting page now, without waiting for a pause. Returns what happened, in words.
  async function readNow() {
    force = true;
    blockedUntil = 0;
    tried.clear();
    try {
      for (let i = 0; running && i < 300; i += 1) await new Promise((done) => setTimeout(done, 200));
      lastNotice = { text: "", at: 0 };
      await pump();
      for (let i = 0; running && i < 300; i += 1) await new Promise((done) => setTimeout(done, 200));
      const left = await dueNotebooks();
      return left.length ? message || `${left.length} still waiting` : "All pages are read";
    } finally {
      force = false;
    }
  }

  // Read one page again because you asked. A manual name is kept; the tags and searchable text are refreshed.
  async function reread(id) {
    manual.add(id);
    const text = await readNow();
    manual.delete(id);
    return text;
  }

  function touched() {
    clearTimeout(timer);
    timer = setTimeout(pump, timing.idleMs);
  }

  // ---- search -----------------------------------------------------------------------------------
  const plain = (text) => String(text || "").toLowerCase()
    .replace(/matrices/g, "matrix").replace(/vertices/g, "vertex")
    .replace(/[^a-z0-9/.\-+ ]+/g, " ")
    .split(/\s+/).filter(Boolean).map((word) => (word.length > 3 ? word.replace(/s$/, "") : word)).join(" ");

  function snippet(text, tokens) {
    const lines = String(text || "").split(/\n+/);
    const line = lines.find((l) => tokens.every((t) => plain(l).includes(t))) || lines.find((l) => tokens.some((t) => plain(l).includes(t)));
    return line ? line.trim().slice(0, 110) : "";
  }

  async function search(query) {
    const tokens = plain(query).split(" ").filter(Boolean);
    const books = await Notebooks.list();
    if (!tokens.length) return books.map((meta) => ({ meta, snippet: "" }));
    const found = [];
    for (const meta of books) {
      const name = plain(`${meta.name} ${meta.title || ""}`);
      const tags = plain((meta.tags || []).join(" "));
      const body = plain(meta.text);
      const everything = `${name} ${tags} ${body}`;
      if (!tokens.every((token) => everything.includes(token))) continue;
      const score = tokens.reduce((sum, token) => sum + (name.includes(token) ? 3 : 0) + (tags.includes(token) ? 2 : 0) + (body.includes(token) ? 1 : 0), 0);
      found.push({ meta, score, snippet: snippet(meta.text, tokens) });
    }
    return found.sort((a, b) => b.score - a.score || b.meta.updated - a.meta.updated);
  }

  // ---- Check my work with no PC ----------------------------------------------------------------
  const HEADS = { correct: "Correct", wrong: "Mistake found", incomplete: "Right so far", unreadable: "Couldn't read the page", unsure: "Numbers check out" };

  function summary(result, model) {
    const parts = [`Work check: ${HEADS[result.verdict] || result.verdict}.`];
    if (result.steps_checked) parts.push(`${result.steps_right}/${result.steps_checked} calculations right.`);
    if (result.where) parts.push(result.where);
    let line = `${parts.join(" ")} (${model}, numbers checked exactly)`;
    if (result.feedback) line += `\n${result.feedback}`;
    if (result.matrices) line += `\nRead from your work:\n${result.matrices}`;
    return line;
  }

  // The reader's "ymin,xmin,ymax,xmax" (0 to 1000 of the picture) as a box on the board.
  function boardBox(text, page) {
    const n = String(text || "").match(/-?\d+(?:\.\d+)?/g)?.map(Number);
    if (!n || n.length < 4 || !page.toBoard || n.slice(0, 4).some((v) => !Number.isFinite(v))) return null;
    const [y0, x0, y1, x1] = n.slice(0, 4).map((v) => Math.min(1000, Math.max(0, v)));
    if (y1 <= y0 || x1 <= x0) return null;
    const { width, height } = page.canvas;
    const [ax, ay] = page.toBoard((x0 / 1000) * width, (y0 / 1000) * height);
    const [bx, by] = page.toBoard((x1 / 1000) * width, (y1 / 1000) * height);
    return [ax, ay, bx, by];
  }

  // The writing as it was before Check added its own marks (a green "Correct!" or a red ring), so that
  // checking again without changing anything is answered from memory.
  const MARKS = new Set(["#34c38f", "#ef5350"]);
  const workKey = () => {
    const work = (window.SkybridgePad?.strokes || []).filter((stroke) => !(stroke.clean && MARKS.has(stroke.color)));
    return `check|${Notebooks.hashOf(work)}|${bridge?.problemText?.() || ""}`;
  };

  async function check() {
    const key = workKey();
    const known = recall(key);
    if (known) return { ...known, text: `${known.text}\n(Same page as your last check, so no new request was made.)`, cached: true };
    if (!AI.hasKey()) {
      return { ok: false, error: "To check without your PC, add your Gemini key under Notebooks, then Smart features." };
    }
    if (navigator.onLine === false && !window.SkybridgeLocal?.usable({ image: true })) return { ok: false, error: "No connection. Checking needs the internet or your PC." };
    let image;
    let page;
    try {
      page = await window.SkybridgeExport.renderBoard();
      image = shrink(page.canvas, AI.localWillRead?.() ? 1024 : MAX_SIDE); // a smaller picture is far quicker for a local model
    } catch (error) {
      return { ok: false, error: error.message || "There is nothing on the page yet." };
    }
    try {
      const { model, reading } = await AI.readWork(image, { problem: bridge.problemText?.() || "", mode: "practice" });
      const rows = MathCheck.runChecks(reading.checks);
      const result = MathCheck.verdict(reading, rows, "practice");
      const answer = { ok: true, text: summary(result, model), verdict: result.verdict, box: result.verdict === "wrong" ? boardBox(reading.mistake_box, page) : null };
      // A page nothing could be read from is worth asking again; a verdict is worth keeping.
      if (result.verdict !== "unreadable") remember(key, answer);
      return answer;
    } catch (error) {
      // Flash is out for today (or busy): Live has no daily limit, so it can give an opinion if the student allows it.
      // It is a voice model reading the picture, not the exact checker, and the answer says so.
      const Live = window.SkybridgeLive;
      if (["rate", "busy", "timeout", "missing"].includes(error?.kind) && Live?.usable() && Live.config().check) {
        try {
          const spoken = await Live.ask({ image, prompt: LIVE_CHECK(bridge.problemText?.() || "") });
          window.SkybridgeEngine?.record("check", { ok: true, engine: "live", model: spoken.model, trail: [{ engine: "gemini", why: AI.explain(error).slice(0, 90) }] });
          return { ok: true, verdict: "unverified", box: null, text: `Live's opinion (${spoken.model}). It read your page like a tutor would; the numbers were NOT checked exactly, so it can be wrong.\n${spoken.text}` };
        } catch (liveError) {
          return { ok: false, error: `${AI.explain(error)}\nLive couldn't help either: ${liveError.message}` };
        }
      }
      return { ok: false, error: AI.explain(error) };
    }
  }

  const LIVE_CHECK = (problem) => `This picture is a student's handwritten math. The problem: ${problem && problem.trim() ? problem.trim() : "(not given: work it out from the page)"}
Look at their work step by step and say, in three or four short sentences, whether it looks right. If a step looks wrong, say which line and which entry, but do NOT say the correct value or the next step: they are practising. Say that this is your reading of the picture and numbers were not verified.`;

  function init(given) {
    bridge = given;
    window.addEventListener("online", pump);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pump(); });
    setTimeout(pump, 4000);
  }

  window.SkybridgeSmart = {
    init, touched, pump, readNow, reread, readLog: () => readLog.slice(), convert, onRelay, search, check, status, timing, pending: () => waiting,
    onStatus: (fn) => listeners.add(fn),
    onNotice: (fn) => noticeListeners.add(fn),
  };
})();
