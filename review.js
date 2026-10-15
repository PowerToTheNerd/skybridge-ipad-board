/*
 * The Review page: what Check my work found, laid out like a worksheet on a page of its own (not drawn on your
 * paper). It opens when a check finds something to look at, a button at the top right goes back to your page and
 * forth to the review as often as you like, and it is kept with the notebook page until you delete it, solve the
 * problem (a later check says Correct) or keep it as a page of its own. Checking again updates the same review.
 *
 * It only draws what the check already found (the verdict, the page's goal, the matrices it read, what is right and
 * what is off, a hint), so it makes no model call of its own. Matrices and equations are typeset with KaTeX.
 *
 * window.SkybridgeReview = { init({ title, keep, remove }), sync(review), show(review), hide(), toggle(), isOpen(), build(review), latexOf(matrix), cellOf(text) }
 */
(() => {
  "use strict";
  const html = document.documentElement;
  const el = {
    page: document.getElementById("reviewPage"),
    body: document.getElementById("reviewBody"),
    sub: document.getElementById("reviewSub"),
    button: document.getElementById("reviewBtn"),
    label: document.getElementById("reviewBtnLabel"),
    long: document.getElementById("reviewBtnLong"),
    keep: document.getElementById("reviewKeep"),
    remove: document.getElementById("reviewRemove"),
  };
  let hooks = {};
  let current = null;

  // A cell the reader wrote ("-5/2", "x^2") as LaTeX. Anything that is not plain maths characters is dropped, so
  // nothing a model wrote can become a command.
  const SAFE = /[^A-Za-z0-9.+\-*/^_() ¹⁻₀-₉]/g;
  function cellOf(text) {
    const value = String(text ?? "").trim();
    const fraction = /^(-?)(\d+)\s*\/\s*(\d+)$/.exec(value);
    if (fraction) return `${fraction[1]}\\tfrac{${fraction[2]}}{${fraction[3]}}`;
    return value.replace(SAFE, "").replace(/\s+/g, " ").trim() || "?";
  }
  function latexOf(matrix) {
    const rows = (matrix.rows || []).map((row) => row.map(cellOf).join(" & ")).join(" \\\\ ");
    const name = String(matrix.name || "").replace(SAFE, "");
    return `${name ? `${name} = ` : ""}\\begin{bmatrix} ${rows} \\end{bmatrix}`;
  }

  function node(tag, className, text) {
    const made = document.createElement(tag);
    if (className) made.className = className;
    if (text !== undefined) made.textContent = text;
    return made;
  }

  function equation(matrix) {
    const box = node("div", "rv-eq");
    if (window.katex) {
      try {
        window.katex.render(latexOf(matrix), box, { displayMode: false, throwOnError: false, strict: "ignore", trust: false });
        return box;
      } catch { /* fall through to the plain grid */ }
    }
    box.append(node("span", "rv-name", `${matrix.name} =`));
    const grid = node("div", "rv-grid");
    grid.style.gridTemplateColumns = `repeat(${matrix.rows[0].length}, auto)`;
    for (const row of matrix.rows) for (const cell of row) grid.append(node("span", "", cell));
    box.append(grid);
    return box;
  }

  const list = (items) => {
    const ul = node("ul", "rv-list");
    for (const item of items) ul.append(node("li", "", item));
    return ul;
  };
  function section(title, ...children) {
    const box = node("section", "rv-section");
    box.append(node("h3", "", title), ...children);
    return box;
  }

  // The report the check made ({ head, tone, line, goal, matrices, read, right, off, hint, model }) as a worksheet.
  function build(review) {
    const report = review?.report || {};
    const root = node("article", "rv");
    root.dataset.tone = report.tone || "";
    const verdict = node("p", "rv-verdict");
    verdict.append(node("b", "rv-pill", report.head || "Checked"), report.line ? ` ${report.line}` : "");
    root.append(verdict);
    if (report.goal) {
      const goal = node("p", "rv-goal");
      goal.append(node("span", "", "The page asks for"), document.createTextNode(report.goal));
      root.append(goal);
    }
    const read = report.read?.length ? report.read : report.lines || [];
    if (read.length || report.matrices?.length) {
      const grids = node("div", "rv-eqs");
      for (const matrix of report.matrices || []) grids.append(equation(matrix));
      root.append(section("What I read", ...(read.length ? [list(read)] : []), ...(report.matrices?.length ? [grids] : [])));
    }
    if (report.right?.length) root.append(section("What's right", list(report.right)));
    if (report.off?.length) root.append(section("What's off", list(report.off)));
    if (report.hint) root.append(section("Hint", node("p", "rv-hint", report.hint)));
    if (report.model) root.append(node("p", "rv-foot", `Read by ${report.model}. The numbers are checked exactly here.`));
    return root;
  }

  const isOpen = () => !!el.page && !el.page.hidden;
  const when = (time) => new Date(time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  function paint() {
    if (!el.button) return;
    const has = !!current;
    el.button.hidden = !has;
    const open = isOpen();
    el.button.setAttribute("aria-pressed", String(open));
    if (el.label) el.label.textContent = open ? "Back" : "Review";
    if (el.long) el.long.textContent = open ? " to my page" : "";
    if (has) html.dataset.reviewHas = "1"; else delete html.dataset.reviewHas;
    el.button.title = open ? "Back to your page" : "View the review of this page";
    el.button.setAttribute("aria-label", open ? "Back to my page" : "View review");
  }

  function show(review) {
    if (!el.page) return;
    if (review) current = review;
    if (!current) return;
    el.body.replaceChildren(build(current));
    if (el.sub) el.sub.textContent = [hooks.title?.(), current.at ? `checked ${when(current.at)}` : ""].filter(Boolean).join(" · ");
    el.page.hidden = false;
    el.page.scrollTop = 0;
    el.body.scrollTop = 0;
    html.dataset.review = "open";
    paint();
  }

  function hide() {
    if (!el.page) return;
    el.page.hidden = true;
    delete html.dataset.review;
    paint();
  }

  // The notebook page on show has this review (or none): the button follows it, and the review page closes.
  function sync(review) {
    current = review || null;
    hide();
  }

  function toggle() {
    if (isOpen()) hide();
    else show();
  }

  function init(given) {
    hooks = given || {};
    el.button?.addEventListener("click", toggle);
    el.keep?.addEventListener("click", () => hooks.keep?.());
    el.remove?.addEventListener("click", () => hooks.remove?.());
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && isOpen() && !document.querySelector("[role=dialog]:not([hidden])")) hide(); });
  }

  window.SkybridgeReview = { init, sync, show, hide, toggle, isOpen, build, latexOf, cellOf };
})();
