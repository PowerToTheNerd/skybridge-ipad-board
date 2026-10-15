/*
 * The Review page: what Check my work found, written out on a notebook page of its own, the way a problem is pinned to
 * the paper (the same typeset layout: real brackets, fractions and Greek). A button at the top right goes back to your
 * page and forth to the review as often as you like. The review lives with the page until it is deleted, the problem is
 * solved (a later check says Correct) or it is kept as a normal page. Checking again redraws the same review.
 *
 * It only lays out what the check already found, so it makes no model call of its own. pad.js owns the notebooks; this
 * file turns a report into the items to draw and runs the button and the little Keep / Delete bar.
 *
 * window.SkybridgeReview = { init({ open, back, keep, remove }), sync(nb), items(report), latexOf(matrix), cellOf(text), lineTex(text) }
 */
(() => {
  const html = document.documentElement;
  const el = {
    button: document.getElementById("reviewBtn"),
    label: document.getElementById("reviewBtnLabel"),
    long: document.getElementById("reviewBtnLong"),
    bar: document.getElementById("reviewBar"),
    keep: document.getElementById("reviewKeep"),
    remove: document.getElementById("reviewRemove"),
  };
  let hooks = {};

  // A cell the reader wrote ("-5/2", "x^2") as LaTeX. Anything that is not plain maths characters is dropped, so
  // nothing a model wrote can become a command.
  const SAFE = /[^A-Za-z0-9.+\-*/^_() ¹⁻₀-₉]/g;
  function cellOf(text) {
    const value = String(text ?? "").trim();
    const fraction = /^(-?)(\d+)\s*\/\s*(\d+)$/.exec(value);
    if (fraction) return `${fraction[1]}\\tfrac{${fraction[2]}}{${fraction[3]}}`;
    return value.replace(SAFE, "").replace(/\s+/g, " ").trim() || "?";
  }
  const bmatrix = (rows) => `\\begin{bmatrix} ${rows.map((row) => row.map(cellOf).join(" & ")).join(" \\\\ ")} \\end{bmatrix}`;
  function latexOf(matrix) {
    const name = String(matrix.name || "").replace(SAFE, "");
    return `${name ? `${name} = ` : ""}${bmatrix(matrix.rows || [])}`;
  }

  // A line the reader wrote with matrices in it, as typeset maths. Readers write them every way: commas or spaces
  // between entries, ";" between rows, "|" for the bar of an augmented matrix (or between two matrices), labels like
  // "A =" or "RREF ->" before, and sometimes a loose label ("U") after, all on one line. The line is cut into runs of
  // numbers and the words between them; only a run that is cleanly rectangular becomes a matrix. If anything about
  // the line is off, it returns null and the line stays plain text.
  const NUM = /^-?\d+(?:\.\d+)?(?:\/\d+)?$/;
  const isIdentity = (rows) => rows.length === rows[0].length && rows.every((row, r) => row.every((cell, c) => Number(cell) === (r === c ? 1 : 0)));
  const rectangle = (rows) => rows.length > 0 && rows.every((row) => row.length === rows[0].length && row.length > 0);
  const labelWord = (word) => String(word || "").replace(/^[^A-Za-z]+/, "").replace(/[^A-Za-z0-9'^]+$/, "").replace(SAFE, "");

  // The blocks (each a list of rows) of one run of tokens, or null when it is not clean.
  function blocksOf(run) {
    const rows = [[]];
    for (const token of run) { if (token === ";") rows.push([]); else rows[rows.length - 1].push(token); }
    if (rows.length > 1 && rows[rows.length - 1].length === 0) rows.pop();
    if (rows.some((row) => !row.length)) return null;
    // Augmented: every row has the same "|" columns of the same widths.
    const split = rows.map((row) => { const groups = [[]]; for (const t of row) { if (t === "|") groups.push([]); else groups[groups.length - 1].push(t); } return groups; });
    const columns = split[0].length;
    if (split.every((groups) => groups.length === columns) && split.every((groups) => groups.every((group, j) => group.length > 0 && group.length === split[0][j].length))) {
      return Array.from({ length: columns }, (_, j) => split.map((groups) => groups[j]));
    }
    // Blocks side by side: split the whole run at "|", rows by ";" inside each block.
    if (run.includes("|")) {
      const parts = [[]];
      for (const t of run) { if (t === "|") parts.push([]); else parts[parts.length - 1].push(t); }
      const made = parts.map((part) => { const out = [[]]; for (const t of part) { if (t === ";") out.push([]); else out[out.length - 1].push(t); } if (out.length > 1 && !out[out.length - 1].length) out.pop(); return out; });
      if (made.every(rectangle) && made.every((block) => block.length === made[0].length)) return made;
      return null;
    }
    return rectangle(rows) ? [rows] : null;
  }

  // -> { tex, texes, rest, used } or null. `orphans` are loose label-only lines ("U", "rref ->") for blocks without one.
  function lineTex(text, orphans = []) {
    const raw = String(text || "").trim().replace(/−/g, "-");
    if (!raw || /,\s*[,;|]|[;|]\s*,/.test(raw)) return null;
    const words = raw.replace(/\s*\/\s*/g, "/").replace(/[[\]()]/g, " ").replace(/->|→|⟶/g, " ARROW ").replace(/([;|=])/g, " $1 ").replace(/,/g, " ").split(/\s+/).filter(Boolean);
    // Cut into runs (numbers, ";" and "|") and the words around them.
    const parts = [];
    for (const token of words) {
      const inRun = NUM.test(token) || token === ";" || token === "|";
      const last = parts[parts.length - 1];
      if (last && last.run === inRun) last.tokens.push(token); else parts.push({ run: inRun, tokens: [token] });
    }
    const out = [];
    const rest = [];
    const used = [];
    const take = (match) => { const i = orphans.findIndex((o, k) => !used.includes(k) && match(o)); if (i >= 0) { used.push(i); return orphans[i]; } return null; };
    parts.forEach((part, index) => {
      if (part.run) return;
      // words before a run: "LU ?A =" -> label A, rest "LU ?"; words after it: one loose label for the last block.
      const next = parts[index + 1];
      const tokens = part.tokens.slice();
      part.label = null;
      part.arrow = false;
      if (next?.run && (tokens[tokens.length - 1] === "=" || tokens[tokens.length - 1] === "ARROW")) {
        part.arrow = tokens.pop() === "ARROW";
        const at = tokens.length - 1;
        if (at >= 0 && labelWord(tokens[at])) { part.label = labelWord(tokens[at]); tokens.splice(at, 1); }
      }
      part.rest = tokens;
    });
    const regions = [];
    parts.forEach((part, index) => {
      if (!part.run) return;
      // A "|" at the edge of a run only separates it from the next matrix's label.
      while (part.tokens[0] === "|") part.tokens.shift();
      while (part.tokens[part.tokens.length - 1] === "|") { part.tokens.pop(); part.bar = true; }
      const clean = blocksOf(part.tokens);
      const numbers = part.tokens.filter((t) => NUM.test(t)).length;
      const before = parts[index - 1] && !parts[index - 1].run ? parts[index - 1] : null;
      const marked = part.tokens.some((t) => t === ";" || t === "|") || (before && (before.label || before.arrow));
      if (!clean || numbers < 2 || !marked) { regions.push(null); return; }
      regions.push({ blocks: clean, before, index });
    });
    if (regions.every((region) => !region)) return null;
    // Any run that looked like a matrix but isn't clean makes the whole line unsafe to typeset.
    if (parts.filter((part) => part.run && part.tokens.filter((t) => NUM.test(t)).length >= 2).length !== regions.filter(Boolean).length) return null;
    let regionIndex = 0;
    let joinNext = false;
    const texes = [];
    parts.forEach((part, index) => {
      if (!part.run) return;
      const region = regions[regionIndex++];
      if (!region) { rest.push(part.tokens.join(" ")); return; }
      const after = parts[index + 1] && !parts[index + 1].run ? parts[index + 1] : null;
      // A loose single label right after the run (and not the next run's own label) belongs to its last block.
      let trailing = "";
      if (after && !after.label && !after.arrow && after.rest.length === 1 && /^[A-Za-z]{1,6}$/.test(after.rest[0]) && region.blocks.length > 1) { trailing = after.rest[0]; after.rest = []; }
      const blocks = region.blocks.map((rows, j) => ({ rows, head: j === 0 && region.before ? region.before.label || "" : "", arrow: j === 0 && !!region.before?.arrow }));
      const last = blocks[blocks.length - 1];
      if (trailing && !last.head) last.head = trailing;
      blocks.forEach((block, j) => {
        if (block.head) return;
        if (j === 0 && isIdentity(block.rows)) { const o = take((x) => /(->|→)/.test(x)); if (o) { block.head = o.replace(/\s*(->|→)\s*$/, ""); block.arrow = true; return; } }
        if (isIdentity(block.rows)) { block.head = "I"; return; }
        const o = take((x) => !/(->|→)/.test(x));
        if (o) block.head = o;
      });
      const line = blocks.map((block) => {
        const name = labelWord(block.head);
        const lead = name ? `${/^[A-Za-z]$/.test(name) ? name : `\\text{${name}}`} ${block.arrow ? "\\to" : "="} ` : "";
        return lead + bmatrix(block.rows);
      }).join(" \\;\\mid\\; ");
      // Two matrices the reader separated with a bar stay on one line.
      if (joinNext) texes[texes.length - 1] += ` \\;\\mid\\; ${line}`; else texes.push(line);
      joinNext = !!part.bar;
    });
    // Words that stayed words ("LU ?", a stray "U") are kept as plain text, in order.
    const plainWords = parts.filter((part) => !part.run).flatMap((part) => part.rest || []).filter((w) => w !== "=" && w !== "ARROW" && w !== "|");
    const leftover = [...plainWords, ...rest].join(" ").replace(/\s+/g, " ").trim();
    return { tex: texes[0], texes, rest: leftover ? [leftover] : [], used };
  }

  const TONES = { right: "#3f9d5f", partly: "#c98a1b", wrong: "#cf5252", unsure: "#8a94a0" };
  const HINT = "#3b82f6";
  // "A times U gives I" (an exact check that passed) as a line of maths with a tick: A × U = I ✓
  function checkTex(text) {
    const m = /^([A-Za-z][\w']{0,5}(?:\^-1|⁻¹)?)\s+(?:times|x|×)\s+([A-Za-z][\w']{0,5}(?:\^-1|⁻¹)?)\s+(?:gives|equals|is|=)\s+(?:the\s+)?(identity|[A-Za-z][\w']{0,5})\b/i.exec(String(text).trim());
    if (!m) return null;
    const name = (x) => x.replace(/\^-1|⁻¹/, "^{-1}").replace(SAFE, (c) => (c === "{" || c === "}" ? c : ""));
    const out = /^identity$/i.test(m[3]) ? "I" : m[3];
    return `${name(m[1])} \\times ${name(m[2])} = ${name(out)} \\;\\checkmark`;
  }

  function items(report) {
    const out = [];
    const heading = (title, extra = {}) => out.push({ before: 0.7, gap: 0.35, problem: { title, text: "", lines: [] }, ...extra });
    const para = (text, extra = {}) => out.push({ gap: 0.4, problem: { title: "", text, lines: [] }, ...extra });
    const firstSentence = (text) => { const one = String(text || "").replace(/\s+/g, " ").trim(); const cut = /^(.+?[.!?])(\s|$)/.exec(one); return cut ? cut[1] : one; };
    out.push({ gap: 0.5, problem: { title: report.head || "Checked", text: firstSentence(report.line), lines: [] }, titleColor: TONES[report.tone] });
    if (report.model) para(`Read by ${report.model}${report.fellBack ? `, because your local model didn't answer: ${String(report.fellBack).replace(/[.\s]+$/, "")}` : ""}. The numbers are checked exactly here.`, { small: true, gap: 0.2 });
    if (report.goal) para(`The page asks for: ${report.goal}`, { before: 0.5 });
    const lines = (report.read?.length ? report.read : report.lines || []).map(String);
    const isOrphan = (line) => /^[A-Za-z]{1,6}\s*(->|→|=)?$/.test(line.trim());
    const orphans = lines.filter(isOrphan).map((line) => line.trim());
    const spent = new Set();
    const tex = [];
    const plain = [];
    for (const line of lines) {
      if (isOrphan(line)) continue;
      let made = null;
      try { made = lineTex(line, orphans.filter((_, k) => !spent.has(k))); } catch { made = null; }
      if (!made) { plain.push(line); continue; }
      const open = orphans.map((o, k) => k).filter((k) => !spent.has(k));
      made.used.forEach((i) => spent.add(open[i]));
      tex.push(...made.texes);
      plain.push(...made.rest);
    }
    orphans.forEach((o, k) => { if (!spent.has(k)) plain.push(o); });
    const shown = new Set(tex.join(" ").match(/(?:^|[^\\A-Za-z])[A-Za-z](?= =)/g)?.map((x) => x.trim()) || []);
    // Matrices the reader named but wrote no line for share a row, so the page uses its width.
    const rest = (report.matrices || []).filter((matrix) => matrix.rows?.length && !shown.has(String(matrix.name)));
    for (let i = 0; i < rest.length; i += 2) tex.push(rest.slice(i, i + 2).map(latexOf).join(" \\;\\;\\;\\; "));
    if (plain.length || tex.length) {
      heading("What I read");
      for (const line of plain) para(`• ${line}`);
      for (const line of tex) out.push({ gap: 0.3, problem: { title: "", text: "", lines: [line] } });
    }
    if (report.right?.length) {
      heading("What's right");
      for (const line of report.right) {
        const tick = checkTex(line);
        if (tick) out.push({ gap: 0.3, problem: { title: "", text: "", lines: [tick] } });
        else para(`• ${line}`);
      }
    }
    if (report.off?.length) { heading("What's off"); for (const line of report.off) para(`• ${line}`); }
    if (report.hint) { heading("Hint", { titleColor: HINT }); para(report.hint, { color: HINT }); }
    return out;
  }

  // The page on show: a review page (has reviewOf), a page with a review (has reviewId) or neither.
  function sync(nb) {
    if (!el.button) return;
    const onReview = !!nb?.reviewOf;
    const has = !!nb?.reviewId;
    el.button.hidden = !(onReview || has);
    el.button.setAttribute("aria-pressed", String(onReview));
    if (el.label) el.label.textContent = onReview ? "Back" : "Review";
    if (el.long) el.long.textContent = onReview ? " to my page" : "";
    el.button.title = onReview ? "Back to your page" : "View the review of this page";
    el.button.setAttribute("aria-label", onReview ? "Back to my page" : "View review");
    if (el.bar) el.bar.hidden = !onReview;
    if (onReview) html.dataset.review = "open"; else delete html.dataset.review;
    if (onReview || has) html.dataset.reviewHas = "1"; else delete html.dataset.reviewHas;
  }

  function init(given) {
    hooks = given || {};
    el.button?.addEventListener("click", () => (html.dataset.review === "open" ? hooks.back?.() : hooks.open?.()));
    el.keep?.addEventListener("click", () => hooks.keep?.());
    el.remove?.addEventListener("click", () => hooks.remove?.());
  }

  window.SkybridgeReview = { init, sync, items, latexOf, cellOf, lineTex };
})();
