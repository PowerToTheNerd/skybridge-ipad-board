/*
 * How a homework (or practice) problem is shown: one reliable presentation of what was extracted.
 *
 * A saved problem is { title, text, lines }: `text` is the task in the PDF's own words, `lines` are the
 * given matrices and equations as LaTeX. The AI that read the PDF often wrote the same expression twice:
 * once raw inside the sentence ("UAV = [I_r 0; 0 0]") and once, properly, as a line. This file turns that
 * into blocks to draw, WITHOUT changing the saved problem:
 *
 *   - recognisable raw math in the sentence (a MATLAB style matrix like [a b; c d], a \begin{bmatrix} block,
 *     identifiers such as I_r or A^T) becomes real math, in the place it was written;
 *   - an expression that is also a given line is shown once (the line's LaTeX is used, in that place);
 *   - given lines not already shown follow under a short lead-in ("Given matrix:");
 *   - anything it can't read with confidence is left exactly as written.
 *
 * present(problem) -> { title, blocks: [{ k: "p", src }, { k: "d", src }], report }
 *   p: wording (may hold $inline math$)     d: a display equation or matrix (LaTeX)
 *   report: what it did, for tests and for the "Why does it look like this" notes.
 *
 * window.SkybridgePresent = { present, items, canonical, VERSION }
 */
(() => {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;

  const VERSION = 2; // bump when the way a problem is laid out changes, so pinned copies re-measure themselves

  const ENV = /\\begin\{([pbvBV]?)matrix\}([\s\S]*?)\\end\{\1matrix\}/g;
  const NOISE = /\\left|\\right|\\[,;:! ]|\\quad|\\qquad|\\displaystyle|~/g;
  const SYMBOLS = [[/\\times/g, "×"], [/\\cdot/g, "·"], [/\\leq?(?![a-zA-Z])/g, "≤"], [/\\geq?(?![a-zA-Z])/g, "≥"], [/\\neq?(?![a-zA-Z])/g, "≠"], [/\\pm/g, "±"]];

  // ---- matrices --------------------------------------------------------------------------------
  const cleanCell = (cell) => cell.replace(NOISE, " ").replace(/\s+/g, " ").trim();
  const operatorOnly = (token) => /^[+\-*/=<>]$/.test(token) && token !== "-";

  // Rows of cells from the inside of a \begin{..matrix}.
  function rowsOfEnv(body) {
    const rows = body.split(/\\\\/).map((row) => row.split("&").map(cleanCell)).filter((row) => row.some(Boolean));
    return rows.length ? rows : null;
  }

  // Rows of cells from the inside of [a b; c d] or [a, b; c, d]. Null when it is not clearly a matrix:
  // rows of different lengths, a lone operator as a "cell" ([x + 1; 2]), or empty cells.
  function rowsOfMatlab(inner) {
    const rows = inner.split(";").map((row) => row.trim()).filter((row, i, all) => row || i < all.length - 1);
    if (rows.length < 2 && !inner.includes(";")) return null;
    const grid = rows.filter(Boolean).map((row) => (row.includes(",") ? row.split(",") : row.split(/\s+/)).map((cell) => cell.trim()).filter(Boolean));
    if (!grid.length || grid.some((row) => !row.length)) return null;
    const width = grid[0].length;
    if (grid.some((row) => row.length !== width)) return null;
    if (grid.some((row) => row.some(operatorOnly))) return null;
    if (grid.some((row) => row.some((cell) => !/^[-+]?[A-Za-z0-9_.^{}\\*/()'′]+$/.test(cell)))) return null;
    return grid;
  }

  const latexOfRows = (rows, env = "b") => `\\begin{${env}matrix} ${rows.map((row) => row.join(" & ")).join(" \\\\ ")} \\end{${env}matrix}`;

  // Plain comparison form of an expression: matrices become a grid of cells, noise and spacing disappear,
  // braces around single tokens go. Two spellings of the same thing share one canonical form.
  function canonical(expr) {
    let text = String(expr || "").replace(/\$/g, "");
    text = text.replace(ENV, (all, env, body) => gridKey(rowsOfEnv(body)));
    text = text.replace(/\[([^\[\]]*;[^\[\]]*)\]/g, (all, inner) => {
      const rows = rowsOfMatlab(inner);
      return rows ? gridKey(rows) : all;
    });
    text = text.replace(NOISE, "");
    for (const [pattern, to] of SYMBOLS) text = text.replace(pattern, to);
    // x^{2} and x^2 are the same thing; so are \frac{a}{b} and (a)/(b), and (x) and x
    text = text.replace(/([\^_])\{([^{}]+)\}/g, "$1$2");
    for (let i = 0; i < 3; i += 1) text = text.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)");
    text = text.replace(/\s+/g, "").replace(/[{}]/g, "");
    return text.replace(/\(([A-Za-z0-9.]+)\)/g, "$1");
  }
  function gridKey(rows) {
    if (!rows) return "?";
    return `M(${rows.map((row) => row.map((cell) => cell.replace(/\s+/g, "").replace(/[{}]/g, "")).join(",")).join("|")})`;
  }

  // ---- finding raw math in a sentence --------------------------------------------------------------
  // "UAV = [I_r 0; 0 0]" / "A = \begin{bmatrix}..\end{bmatrix}" / "[1 2; 3 4]" with its left-hand side.
  // Returns [{ start, end, latex, rows }] in order. An expression that can't be read for certain is skipped.
  const SUP = /^\s*(\^\{[^{}]+\}|\^[A-Za-z0-9*+\-])/;
  // A token that is certainly a name in maths: UAV, A, U^*AV, A^{-1}, M_1, \Sigma.
  const mathy = (token) => /^[A-Za-z](?:[A-Za-z0-9]*)(?:_\{[^{}]+\}|_[A-Za-z0-9]|\^\{[^{}]+\}|\^[A-Za-z0-9*+\-])*[A-Za-z0-9]*$/.test(token) && (/[\^_]/.test(token) || /^[A-Z]+$/.test(token))
    || /^\\[A-Za-z]+$/.test(token);

  function findFragments(text) {
    const found = [];
    for (const hit of text.matchAll(/\\begin\{([pbvBV]?)matrix\}([\s\S]*?)\\end\{\1matrix\}/g)) {
      const rows = rowsOfEnv(hit[2]);
      if (rows) found.push({ start: hit.index, end: hit.index + hit[0].length, rows, env: hit[1] || "b" });
    }
    for (const hit of text.matchAll(/\[([^\[\]]*;[^\[\]]*)\]/g)) {
      if (found.some((f) => hit.index >= f.start && hit.index < f.end)) continue;
      const rows = rowsOfMatlab(hit[1]);
      if (rows) found.push({ start: hit.index, end: hit.index + hit[0].length, rows, env: "b" });
    }
    found.sort((a, b) => a.start - b.start);
    const out = [];
    for (const f of found) {
      let { start, end } = f;
      // the name before "=": the last token, plus earlier tokens that are names too ("A^T A =")
      const before = text.slice(0, start);
      const eq = /^([\s\S]*?)(\S+)\s*=\s*$/.exec(before);
      let name = "";
      if (eq && mathy(eq[2])) {
        const names = [eq[2]];
        const earlier = eq[1].split(/\s+/).filter(Boolean);
        while (earlier.length && names.length < 3 && (/^[A-Z]$/.test(earlier[earlier.length - 1]) || (mathy(earlier[earlier.length - 1]) && /[\^_\\]/.test(earlier[earlier.length - 1])))) names.unshift(earlier.pop());
        name = names.join(" ");
        start = before.length - (before.length - eq[1].length) + (eq[1].length - eq[1].trimEnd().length === 0 ? 0 : 0);
        start = before.lastIndexOf(names[0], before.length - 1);
      }
      const after = text.slice(end);
      const sup = SUP.exec(after);
      let suffix = "";
      if (sup) { suffix = sup[1]; end += sup[0].length; }
      const body = `${latexOfRows(f.rows, f.env)}${suffix}`;
      out.push({ start, end, latex: name ? `${name} = ${body}` : body, rows: f.rows });
    }
    return out;
  }

  // ---- identifiers in wording: I_r, A^T, x_1 become inline math ------------------------------------
  const INLINE = /(^|[^\\\w$])([A-Za-z](?:_\{[^{}]+\}|_[A-Za-z0-9]{1,2}|\^\{[^{}]+\}|\^[A-Za-z0-9*+\-]{1,2})+)(?![\w])/g;
  const DOLLAR = /\\\((.+?)\\\)|\$([^$]+)\$/g;
  function inlineMath(prose) {
    let out = "";
    let last = 0;
    const plain = (part) => part.replace(INLINE, (all, lead, token) => `${lead}$${token}$`);
    for (const hit of prose.matchAll(DOLLAR)) {
      out += plain(prose.slice(last, hit.index)) + hit[0];
      last = hit.index + hit[0].length;
    }
    return out + plain(prose.slice(last));
  }

  // ---- the whole problem -----------------------------------------------------------------------------
  function leadIn(lines) {
    const matrices = lines.filter((line) => /\\begin\{[pbvBV]?matrix\}/.test(line)).length;
    if (matrices && matrices === lines.length) return matrices === 1 ? "Given matrix:" : "Given matrices:";
    return "Given:";
  }

  function present(problem) {
    const title = String(problem?.title || "");
    const text = String(problem?.text || "").replace(/\s+/g, " ").trim();
    const lines = (problem?.lines || []).map((line) => String(line || "").trim()).filter(Boolean);
    const report = { converted: [], deduplicated: [], kept: [], leadIn: "" };
    const used = new Set();
    const blocks = [];
    const pushProse = (s) => {
      const clean = s.replace(/\s+/g, " ").trim();
      if (clean) blocks.push({ k: "p", src: inlineMath(clean) });
    };

    // 1. raw matrices (and their left-hand sides) in the sentence
    const fragments = findFragments(text);
    // 2. any other given line spelled out in the sentence: the same expression written with plain symbols
    //    (x^2, a/b, spacing), found as a run of whole words whose canonical form equals the line's
    const words = [...text.matchAll(/\S+/g)].map((hit) => ({ start: hit.index, end: hit.index + hit[0].length }));
    const plainMatches = [];
    lines.forEach((line, index) => {
      if (fragments.some((f) => canonical(f.latex) === canonical(line))) return;
      const key = canonical(line);
      if (key.length < 6 || /M\(/.test(key)) return;
      for (let i = 0; i < words.length; i += 1) {
        for (let j = i; j < Math.min(words.length, i + 40); j += 1) {
          const raw = text.slice(words[i].start, words[j].end);
          const trimmed = raw.replace(/[.,;:!?]+$/, "");
          if (canonical(trimmed) !== key) continue;
          const start = words[i].start;
          const end = words[i].start + trimmed.length;
          if (fragments.some((f) => start < f.end && end > f.start)) return;
          plainMatches.push({ start, end, latex: line, index });
          return;
        }
      }
    });

    const spans = [
      ...fragments.map((f) => {
        const index = lines.findIndex((line, i) => !used.has(i) && canonical(line) === canonical(f.latex));
        return { start: f.start, end: f.end, latex: index >= 0 ? lines[index] : f.latex, index, raw: text.slice(f.start, f.end), display: true };
      }),
      ...plainMatches.map((m) => ({ ...m, raw: text.slice(m.start, m.end), display: /\\(frac|sum|int|prod|lim|sqrt|begin)\b/.test(m.latex) })),
    ].sort((a, b) => a.start - b.start);

    let cursor = 0;
    let prose = "";
    for (const span of spans) {
      if (span.start < cursor) continue;
      if (span.index >= 0) {
        used.add(span.index);
        report.deduplicated.push({ raw: span.raw, line: span.latex });
      } else {
        report.converted.push({ raw: span.raw, latex: span.latex });
      }
      prose += text.slice(cursor, span.start);
      cursor = span.end;
      if (!span.display) {
        // a short equation inside a sentence stays in the sentence, typeset
        prose += `$${span.latex}$`;
        continue;
      }
      // a matrix or equation on its own: the wording before it ends with a colon unless it is just "Let"
      const trimmed = prose.replace(/\s+$/, "");
      if (trimmed) pushProse(/[.:;,!?]$/.test(trimmed) || trimmed.split(/\s+/).length < 3 ? trimmed : `${trimmed}:`);
      prose = "";
      blocks.push({ k: "d", src: span.latex });
      // punctuation that followed the expression belongs to the expression, not the next sentence
      const punct = /^\s*[,.;:]\s*/.exec(text.slice(cursor));
      if (punct) cursor += punct[0].length;
    }
    prose += text.slice(cursor);
    pushProse(prose);

    // 3. the lines not already shown
    const remaining = lines.filter((line, index) => !used.has(index));
    if (remaining.length) {
      const last = blocks.filter((b) => b.k === "p").pop();
      const introduces = blocks.length && blocks[blocks.length - 1].k === "p" && /(:|\b(below|following|given)\b[.:]?)$/i.test(blocks[blocks.length - 1].src);
      if (blocks.length && !introduces) {
        report.leadIn = leadIn(remaining);
        blocks.push({ k: "p", src: report.leadIn });
      }
      for (const line of remaining) blocks.push({ k: "d", src: line });
      void last;
    }
    if (!blocks.length && text) pushProse(text);
    // anything left as it was written is reported, so nothing is changed silently
    report.kept = blocks.filter((b) => b.k === "p").map((b) => b.src);
    return { title, blocks, report };
  }

  // The packet items the problem card draws (kind "text" and "math"), from the same blocks.
  function items(problem) {
    return present(problem).blocks.map((block) => (block.k === "d" ? { kind: "math", latex: block.src } : { kind: "text", text: block.src }));
  }

  root.SkybridgePresent = { present, items, canonical, inlineMath, findFragments, VERSION };
  if (typeof module === "object" && module.exports) module.exports = root.SkybridgePresent;
})();
