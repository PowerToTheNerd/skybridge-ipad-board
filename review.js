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

  // A line the reader wrote with matrices in it, as one line of typeset maths. Two shapes turn up:
  //   augmented, rows split by ";" and each row split by "|":  "A = 2, 1 | 1, 0 ; 4, 3 | 0, 1"  (one block per "|" column)
  //   blocks split by "|", rows by ";":                        "rref -> 1, 0; 0, 1 | U = 7/4, -1; 1/2, 3"
  // Labels ("A =", "rref ->") stay with their block. `orphans` are short label-only lines the reader wrote apart
  // ("U", "rref ->"): they go to a block that has no label of its own. Returns { tex, used } or null.
  const NUM = "-?\\d+(?:\\.\\d+)?(?:\\s*\\/\\s*\\d+)?";
  const CELL = new RegExp(`^${NUM}$`);
  const parseRows = (body) => {
    const rows = body.split(";").map((row) => row.split(",").map((cell) => cell.trim()));
    return rows.every((row) => row.length === rows[0].length && row.every((cell) => CELL.test(cell))) ? rows : null;
  };
  const isIdentity = (rows) => rows.length === rows[0].length && rows.every((row, r) => row.every((cell, c) => Number(cell) === (r === c ? 1 : 0)));
  const labelOf = (head) => {
    const bare = String(head || "").replace(/[=:]\s*$/, "").replace(/\s*(->|→)\s*$/, "").trim().replace(SAFE, "");
    return bare;
  };
  function lineTex(text, orphans = []) {
    const raw = String(text || "").trim();
    if (!/[,;]/.test(raw)) return null;
    let blocks = null; // [{ head, arrow, rows }]
    const split = raw.split(";").map((row) => row.split("|").map((cell) => cell.trim()));
    const columns = split[0].length;
    if (columns > 1 && split.length > 0 && split.every((row) => row.length === columns)) {
      // augmented: take the label (if any) off the first cell of the first row
      let head = "";
      let arrow = false;
      const first = split[0][0];
      const m = /^(.*?)(->|→|=)\s*(.*)$/.exec(first);
      if (m && !/[,]/.test(m[1])) { head = m[1].trim(); arrow = m[2] !== "="; split[0][0] = m[3]; }
      blocks = [];
      for (let j = 0; j < columns; j += 1) {
        const rows = parseRows(split.map((row) => row[j]).join(";"));
        if (!rows) { blocks = null; break; }
        blocks.push({ head: j === 0 ? head : "", arrow: j === 0 && arrow, rows });
      }
    }
    if (!blocks) {
      blocks = [];
      for (const part of raw.split("|").map((p) => p.trim())) {
        const arrow = /^(.*?)(->|→)\s*(.*)$/.exec(part);
        const eq = /^([^,;=]*)=\s*(.*)$/.exec(part);
        const head = arrow ? arrow[1] : eq ? eq[1] : "";
        const body = arrow ? arrow[3] : eq ? eq[2] : part;
        const rows = parseRows(body);
        if (!rows) return null;
        blocks.push({ head: head.trim(), arrow: !!arrow, rows });
      }
      // Blocks side by side have the same number of rows; anything else is not a matrix line we understand.
      if (blocks.length > 1 && blocks.some((block) => block.rows.length !== blocks[0].rows.length)) return null;
    }
    // Labels that stand apart ("rref ->" before the first block, "U" for a block that is not the identity).
    const used = [];
    const take = (match) => { const i = orphans.findIndex((o, k) => !used.includes(k) && match(o)); if (i >= 0) { used.push(i); return orphans[i]; } return null; };
    blocks.forEach((block, j) => {
      if (block.head) return;
      if (j === 0 && isIdentity(block.rows)) { const o = take((x) => /(->|→)/.test(x)); if (o) { block.head = o; block.arrow = true; return; } }
      if (isIdentity(block.rows)) { block.head = "I"; return; }
      const o = take((x) => !/(->|→)/.test(x));
      if (o) block.head = o;
    });
    const tex = blocks.map((block) => {
      const name = labelOf(block.head);
      const lead = name ? `${/^[A-Za-z]$/.test(name) ? name : `\\text{${name}}`} ${block.arrow ? "\\to" : "="} ` : "";
      return lead + bmatrix(block.rows);
    }).join(" \\;\\mid\\; ");
    return { tex, used };
  }

  // The report the check made ({ head, tone, line, goal, matrices, read, right, off, hint, model }) as the items a
  // notebook page shows, top to bottom: a heading, then one item per paragraph or equation.
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
    out.push({ gap: 0.5, problem: { title: report.head || "Checked", text: report.line || "", lines: [] }, titleColor: TONES[report.tone] });
    if (report.model) para(`Read by ${report.model}. The numbers are checked exactly here.`, { small: true, gap: 0.2 });
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
      tex.push(made.tex);
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
