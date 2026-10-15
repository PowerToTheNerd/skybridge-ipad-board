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

  // A line the reader wrote with matrix literals in it ("A = 2, 1; 4, 3 | 1, 0; 0, 1", "rref -> 1, 0; 0, 1 | U = ...")
  // as one line of typeset maths: the words stay words and every literal becomes a bracketed matrix.
  const NUM = "-?\\d+(?:\\.\\d+)?(?:\\s*\\/\\s*\\d+)?";
  const LITERAL = new RegExp(`^${NUM}(?:\\s*,\\s*${NUM})*(?:\\s*;\\s*${NUM}(?:\\s*,\\s*${NUM})*)*$`);
  function lineTex(text) {
    const parts = String(text || "").split("|").map((part) => part.trim());
    if (!parts.some((part) => /;/.test(part) || /,/.test(part))) return null;
    const out = [];
    let found = 0;
    for (const part of parts) {
      const at = part.lastIndexOf("=");
      const arrow = /^(.*?)(?:->|→)\s*(.*)$/.exec(part);
      let head = "";
      let body = part;
      if (arrow) { head = arrow[1].trim(); body = arrow[2].trim(); }
      else if (at >= 0) { head = part.slice(0, at).trim(); body = part.slice(at + 1).trim(); }
      if (!LITERAL.test(body)) { out.push(`\\text{${part.replace(SAFE, "")}}`); continue; }
      const rows = body.split(";").map((row) => row.split(",").map((cell) => cell.trim()));
      found += 1;
      const label = head.replace(SAFE, "");
      const sign = arrow ? "\\to" : "=";
      out.push(`${label ? (/^[A-Za-z]$/.test(label) ? label : `\\text{${label}}`) + ` ${sign} ` : ""}${bmatrix(rows)}`);
    }
    return found ? out.join(" \;\\middle|\; ").replace(/\\middle\|/g, "\\mid") : null;
  }

  // The report the check made ({ head, tone, line, goal, matrices, read, right, off, hint, model }) as the items a
  // notebook page shows, top to bottom: a heading, then one item per paragraph or equation.
  const TONES = { right: "#3f9d5f", partly: "#c98a1b", wrong: "#cf5252", unsure: "#8a94a0" };
  function items(report) {
    const out = [];
    const heading = (title) => out.push({ before: 0.8, gap: 0.45, problem: { title, text: "", lines: [] } });
    const para = (text, extra = {}) => out.push({ gap: 0.5, problem: { title: "", text, lines: [] }, ...extra });
    out.push({ gap: 0.9, problem: { title: report.head || "Checked", text: report.line || "", lines: [] }, titleColor: TONES[report.tone] });
    if (report.goal) { heading("The page asks for"); para(report.goal); }
    const plain = [];
    const tex = [];
    for (const line of report.read?.length ? report.read : report.lines || []) {
      const made = lineTex(line);
      if (made) tex.push(made); else plain.push(line);
    }
    const shown = new Set(tex.join(" ").match(/(?:^|[^\\A-Za-z])[A-Za-z](?= =)/g)?.map((s) => s.trim()) || []);
    for (const matrix of report.matrices || []) if (matrix.rows?.length && !shown.has(String(matrix.name))) tex.push(latexOf(matrix));
    if (plain.length || tex.length) {
      heading("What I read");
      for (const line of plain) para(`• ${line}`);
      for (const line of tex) out.push({ gap: 0.4, problem: { title: "", text: "", lines: [line] } });
    }
    if (report.right?.length) { heading("What's right"); for (const line of report.right) para(`• ${line}`); }
    if (report.off?.length) { heading("What's off"); for (const line of report.off) para(`• ${line}`); }
    if (report.hint) { heading("Hint"); para(report.hint); }
    if (report.model) para(`Read by ${report.model}. The numbers are checked exactly here.`, { small: true });
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
