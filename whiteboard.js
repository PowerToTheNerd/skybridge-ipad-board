/* Whiteboard: renders the steps Gemini draws with the draw_on_whiteboard tool.
 * Content is laid out as DOM (KaTeX for math), then rough.js draws the
 * hand-drawn strokes (brackets, circles, boxes, arrows, plots) over it in the
 * Excalidraw style. Exposes window.SkybridgeWhiteboard = { setCardStyle, draw, clear, hooks }.
 * hooks.onDraw(packet) and hooks.onClear() let the iPad link mirror the board.
 * The iPad page (ipad-board/) runs this same file to show Gemini's board there.
 */
(() => {
  "use strict";

  const MAX_STEPS = 40;
  const HIGHLIGHT_COLORS = ["var(--wb-mark-1)", "var(--wb-mark-2)", "var(--wb-mark-3)"];
  const SVG_NS = "http://www.w3.org/2000/svg";
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const el = {
    card: document.getElementById("whiteboardCard"),
    board: document.getElementById("whiteboardBoard"),
    empty: document.getElementById("whiteboardEmpty"),
    count: document.getElementById("whiteboardCount"),
    clearBtn: document.getElementById("whiteboardClearBtn"),
    expandBtn: document.getElementById("whiteboardExpandBtn"),
  };
  if (!el.card || !el.board) return;

  let seed = 1;
  const hooks = {};

  // The iPad page can show this board scaled (data-scale on the board), and My board
  // scales the problem card while it follows the iPad (--problem-scale), so shapes
  // are measured in unscaled pixels.
  function scaleOf(node) {
    if (el.board.contains(node)) return Number(el.board.dataset.scale) || 1;
    const card = node.closest?.(".my-board-problem");
    return card ? Number(getComputedStyle(card).getPropertyValue("--problem-scale")) || 1 : 1;
  }

  function rect(node) {
    const box = node.getBoundingClientRect();
    const scale = scaleOf(node);
    if (scale === 1) return box;
    return {
      left: box.left / scale, top: box.top / scale, right: box.right / scale, bottom: box.bottom / scale,
      width: box.width / scale, height: box.height / scale,
    };
  }

  // Frames come from the window the board is in, which is a pop-out window
  // when the user moved it to another screen (popout.js).
  function nextFrame(callback) {
    return (el.board.ownerDocument.defaultView || window).requestAnimationFrame(callback);
  }
  const fontsReady = (document.fonts?.load?.("20px Virgil") || Promise.resolve()).catch(() => {});

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function looksLikeLatex(value) {
    return /[\\^_{}]/.test(value);
  }

  // Simple math (arithmetic, symbols, small powers) is written by hand in the
  // board font; KaTeX only typesets what handwriting can't show, like fractions.
  const HAND_SYMBOLS = {
    times: "\u00d7", cdot: "\u00b7", div: "\u00f7", pm: "\u00b1", mp: "\u2213", ne: "\u2260", neq: "\u2260",
    le: "\u2264", leq: "\u2264", ge: "\u2265", geq: "\u2265", approx: "\u2248", equiv: "\u2261",
    to: "\u2192", rightarrow: "\u2192", leftarrow: "\u2190", Rightarrow: "\u21d2", implies: "\u21d2",
    Leftrightarrow: "\u21d4", iff: "\u21d4", infty: "\u221e", cdots: "\u22ef", ldots: "\u2026", dots: "\u2026",
    circ: "\u00b0", degree: "\u00b0", in: "\u2208", cdotp: "\u00b7",
    alpha: "\u03b1", beta: "\u03b2", gamma: "\u03b3", delta: "\u03b4", Delta: "\u0394", epsilon: "\u03b5",
    theta: "\u03b8", lambda: "\u03bb", mu: "\u03bc", pi: "\u03c0", sigma: "\u03c3", Sigma: "\u03a3",
    phi: "\u03c6", omega: "\u03c9",
    det: "det", sin: "sin", cos: "cos", tan: "tan", log: "log", ln: "ln", exp: "exp", min: "min", max: "max",
    rank: "rank", tr: "tr",
  };
  // Returns [[kind, text], ...] with kind "", "sup", "sub" or "sym", or null when
  // the LaTeX needs real typesetting (fractions, roots, sums, environments).
  function toHandParts(latex) {
    let text = String(latex).trim();
    if (!text) return null;
    text = text.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, "$1");
    text = text.replace(/\\left|\\right/g, "").replace(/\\(?:qquad|quad)|\\[,;:! ]|~/g, " ");
    text = text.replace(/\\([A-Za-z]+)/g, (match, name) => HAND_SYMBOLS[name] ?? match);
    text = text.replace(/\*/g, "\u00d7");
    const parts = [];
    const pattern = /([\^_])\s*(?:\{([^{}]*)\}|(\S))/g;
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      parts.push(["", text.slice(last, match.index)]);
      parts.push([match[1] === "^" ? "sup" : "sub", (match[2] ?? match[3]).trim()]);
      last = match.index + match[0].length;
    }
    parts.push(["", text.slice(last)]);
    if (parts.some(([, part]) => /[\\{}^_&]/.test(part))) return null;
    return parts.filter(([, part]) => part);
  }

  // Symbols the board font draws small (\u00d7) or lacks get their own span.
  const HAND_SYMBOL_CHARS = /([\u00d7\u00f7\u00b1\u2260\u2264\u2265\u2248\u2261\u2192\u2190\u21d2\u21d4\u221e\u2208\u0394])/;

  function appendHand(target, parts) {
    for (const [kind, text] of parts) {
      if (kind) {
        target.append(make(kind, "wb-script", text));
        continue;
      }
      for (const piece of text.split(HAND_SYMBOL_CHARS)) {
        if (!piece) continue;
        if (HAND_SYMBOL_CHARS.test(piece)) target.append(make("span", "wb-sym", piece));
        else target.append(piece.replace(/\s+/g, " "));
      }
    }
    return target;
  }

  function renderLatex(target, latex, displayMode) {
    const hand = toHandParts(latex);
    if (hand) {
      target.classList.add("wb-hand-math");
      return appendHand(target, hand);
    }
    if (window.katex) {
      try {
        window.katex.render(latex, target, { displayMode, throwOnError: false, strict: "ignore", output: "html" });
        return target;
      } catch {
        // Fall through to plain text.
      }
    }
    target.textContent = latex;
    target.classList.add("wb-raw");
    return target;
  }

  // Text with $...$ math, or stray commands like \times, renders the math parts with KaTeX.
  const DOLLAR_MATH = /\$([^$]+)\$/g;
  const BARE_COMMAND = /(\\[A-Za-z]+(?:\{[^{}]*\})*(?:\s*[\^_]\s*(?:\{[^{}]*\}|\w))*)/g;

  function appendMatches(target, text, pattern, onPlain) {
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > last) onPlain(text.slice(last, match.index));
      target.append(renderLatex(make("span", "wb-inline-math"), match[1], false));
      last = match.index + match[0].length;
    }
    if (last < text.length) onPlain(text.slice(last));
  }

  function renderMixed(target, text) {
    const plain = (part) => appendMatches(target, part, BARE_COMMAND, (rest) => target.append(rest));
    appendMatches(target, text, DOLLAR_MATH, plain);
    return target;
  }

  function inlineContent(className, item) {
    const node = make("span", className);
    if (item.latex) return renderLatex(node, item.latex, false);
    return renderMixed(node, item.text || "");
  }

  function overlay(host) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "wb-ink");
    svg.setAttribute("aria-hidden", "true");
    host.appendChild(svg);
    return svg;
  }

  function roughOptions(extra) {
    return { roughness: 1.1, bowing: 0.9, strokeWidth: 1.6, stroke: "currentColor", seed, ...extra };
  }

  function addShape(svg, node, color) {
    if (color) node.style.color = color;
    svg.appendChild(node);
    return node;
  }

  function animateStrokes(svg, delay) {
    if (reduceMotion) return;
    svg.querySelectorAll("path").forEach((path, index) => {
      let length = 0;
      try { length = path.getTotalLength(); } catch { return; }
      if (!length) return;
      path.style.strokeDasharray = `${length}`;
      path.style.strokeDashoffset = `${length}`;
      path.style.transition = `stroke-dashoffset 420ms ease-out ${delay + index * 25}ms`;
      nextFrame(() => nextFrame(() => { path.style.strokeDashoffset = "0"; }));
    });
  }

  // ---------------------------------------------------------------------------
  // Plot expression parser: numbers, x, + - * / ^, functions, implicit products.
  // ---------------------------------------------------------------------------
  const FUNCS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, ln: Math.log, log: Math.log10,
    sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil,
  };
  const CONSTS = { pi: Math.PI, e: Math.E };

  function normalizeExpression(source) {
    let text = String(source).trim();
    text = text.replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, "");
    text = text.replace(/\\left|\\right/g, "").replace(/\\cdot|\\times/g, "*").replace(/\*\*/g, "^");
    for (let i = 0; i < 4; i += 1) {
      text = text.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "(($1)/($2))");
      text = text.replace(/\\sqrt\s*\{([^{}]*)\}/g, "sqrt($1)");
    }
    return text.replace(/\\/g, "").replace(/[{[]/g, "(").replace(/[}\]]/g, ")");
  }

  function compileExpression(source) {
    const text = normalizeExpression(source);
    const tokens = [];
    const pattern = /\s*(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[a-z]+|[-+*/^()])/giy;
    let match;
    while (pattern.lastIndex < text.length && (match = pattern.exec(text))) tokens.push(match[1].toLowerCase());
    if (pattern.lastIndex < text.trimEnd().length) throw new Error("bad expression");

    // Split runs like "xsin" into known names, then insert implicit multiplication.
    const split = [];
    for (const token of tokens) {
      if (/^[a-z]+$/.test(token) && !FUNCS[token] && !CONSTS[token] && token !== "x") {
        let rest = token;
        while (rest) {
          const name = Object.keys(FUNCS).concat(Object.keys(CONSTS), ["x"])
            .sort((a, b) => b.length - a.length).find((n) => rest.startsWith(n));
          if (!name) throw new Error(`unknown name ${rest}`);
          split.push(name);
          rest = rest.slice(name.length);
        }
      } else {
        split.push(token);
      }
    }
    const isValue = (t) => t && (/^[\d.]/.test(t) || t === "x" || t === ")" || CONSTS[t] !== undefined);
    const starts = (t) => t && (/^[\d.]/.test(t) || t === "x" || t === "(" || FUNCS[t] || CONSTS[t] !== undefined);
    const list = [];
    split.forEach((token, index) => {
      if (index && isValue(split[index - 1]) && starts(token)) list.push("*");
      list.push(token);
    });

    let pos = 0;
    const peek = () => list[pos];
    const take = () => list[pos++];
    function expr() {
      let node = term();
      while (peek() === "+" || peek() === "-") {
        const op = take(); const left = node; const right = term();
        node = op === "+" ? (x) => left(x) + right(x) : (x) => left(x) - right(x);
      }
      return node;
    }
    function term() {
      let node = unary();
      while (peek() === "*" || peek() === "/") {
        const op = take(); const left = node; const right = unary();
        node = op === "*" ? (x) => left(x) * right(x) : (x) => left(x) / right(x);
      }
      return node;
    }
    function unary() {
      if (peek() === "-") { take(); const inner = unary(); return (x) => -inner(x); }
      if (peek() === "+") { take(); return unary(); }
      return power();
    }
    function power() {
      const base = atom();
      if (peek() === "^") { take(); const exponent = unary(); return (x) => base(x) ** exponent(x); }
      return base;
    }
    function atom() {
      const token = take();
      if (token === undefined) throw new Error("unexpected end");
      if (token === "(") { const inner = expr(); if (take() !== ")") throw new Error("missing )"); return inner; }
      if (token === "x") return (x) => x;
      if (CONSTS[token] !== undefined) { const value = CONSTS[token]; return () => value; }
      if (FUNCS[token]) { const fn = FUNCS[token]; const arg = power(); return (x) => fn(arg(x)); }
      const value = Number(token);
      if (Number.isFinite(value)) return () => value;
      throw new Error(`unexpected ${token}`);
    }
    const fn = expr();
    if (pos !== list.length) throw new Error("trailing input");
    return fn;
  }

  // ---------------------------------------------------------------------------
  // Item builders. Each returns { node, ink(svgHost) } where ink draws strokes.
  // ---------------------------------------------------------------------------
  function buildText(item) {
    const node = make("p", item.kind === "note" ? "wb-item wb-note" : "wb-item wb-text");
    if (item.text) renderMixed(node, item.text);
    if (item.latex) node.append(renderLatex(make("span", "wb-inline-math"), item.latex, false));
    return { node };
  }

  const MATRIX_ENV = /\\begin\{([pbvBV]?)matrix\}([\s\S]*?)\\end\{\1matrix\}/g;
  const ENV_BRACKETS = { "": "none", p: "round", b: "square", B: "square", v: "bar", V: "bar" };

  // LaTeX like "A = \begin{bmatrix}...\end{bmatrix} \times ..." becomes hand-drawn matrices
  // with the symbols between them written by hand. Returns null when that isn't possible.
  function buildMatrixEquation(item, latex) {
    const parts = [];
    let last = 0;
    for (const match of latex.matchAll(MATRIX_ENV)) {
      parts.push({ text: latex.slice(last, match.index) });
      const rows = match[2].split(/\\\\/).map((row) => row.split("&").map((cell) => cell.trim()))
        .filter((row) => row.some(Boolean));
      if (!rows.length) return null;
      parts.push({ matrix: { kind: "matrix", rows, brackets: ENV_BRACKETS[match[1]] } });
      last = match.index + match[0].length;
    }
    if (!last) return null;
    parts.push({ text: latex.slice(last) });
    if (parts.some((part) => part.text?.trim() && !toHandParts(part.text))) return null;

    const node = make("div", "wb-item wb-math wb-matrix-equation");
    if (item.label) node.append(renderLabel(item.label));
    const children = [];
    for (const part of parts) {
      if (part.matrix) {
        const built = buildMatrix(part.matrix);
        node.append(built.node);
        children.push(built);
      } else if (part.text.trim()) {
        node.append(appendHand(make("span", "wb-op wb-hand-math"), toHandParts(part.text)));
      }
    }
    return { node, ink: () => children.map((child) => child.ink()) };
  }

  function buildMath(item) {
    const latex = item.latex || item.text || "";
    const equation = latex.includes("\\begin{") ? buildMatrixEquation(item, latex) : null;
    if (equation) return equation;
    const node = make("div", "wb-item wb-math");
    if (item.label) node.append(make("span", "wb-label", item.label));
    node.append(renderLatex(make("span"), latex, true));
    return { node };
  }

  function buildOp(item) {
    return { node: inlineContent("wb-item wb-op", item) };
  }

  function buildBox(item) {
    const node = make("div", "wb-item wb-box");
    const content = item.latex ? renderLatex(make("span"), item.latex, true) : renderMixed(make("span"), item.text || "");
    node.append(content);
    const itemSeed = seed++;
    return {
      node,
      ink() {
        const svg = overlay(node);
        const rc = window.rough.svg(svg);
        const { width, height } = rect(node);
        addShape(svg, rc.rectangle(3, 3, width - 6, height - 6, roughOptions({ seed: itemSeed, strokeWidth: 2 })), "var(--wb-mark-1)");
        return svg;
      },
    };
  }

  function buildArrow(item) {
    const node = make("div", "wb-item wb-arrow");
    const label = item.latex ? renderLatex(make("span", "wb-arrow-label"), item.latex, false)
      : renderMixed(make("span", "wb-arrow-label"), item.text || "");
    node.append(label);
    const itemSeed = seed++;
    return {
      node,
      ink() {
        const svg = overlay(node);
        const rc = window.rough.svg(svg);
        const { width, height } = rect(node);
        const y = height - 10;
        const opts = roughOptions({ seed: itemSeed });
        addShape(svg, rc.line(6, y, width - 8, y, opts));
        addShape(svg, rc.line(width - 8, y, width - 20, y - 7, opts));
        addShape(svg, rc.line(width - 8, y, width - 20, y + 7, opts));
        return svg;
      },
    };
  }

  function buildMatrix(item) {
    const node = make("div", "wb-item wb-matrix");
    if (item.label) node.append(renderLabel(item.label));
    const body = make("div", `wb-mat wb-mat-${item.brackets || "square"}`);
    const columns = Math.max(...item.rows.map((row) => row.length));
    const grid = make("div", "wb-mat-grid");
    grid.style.gridTemplateColumns = `repeat(${columns}, auto)`;
    const cells = item.rows.map((row) => {
      const cellsInRow = [];
      for (let c = 0; c < columns; c += 1) {
        const value = row[c] ?? "";
        const cell = make("span", "wb-cell");
        if (looksLikeLatex(value)) renderLatex(cell, value, false);
        else cell.textContent = value;
        grid.append(cell);
        cellsInRow.push(cell);
      }
      return cellsInRow;
    });
    body.append(grid);
    node.append(body);
    const itemSeed = seed++;
    seed += 20;

    return {
      node,
      ink() {
        const svg = overlay(body);
        const rc = window.rough.svg(svg);
        const box = rect(body);
        const { width, height } = box;
        const opts = (n, extra) => roughOptions({ seed: itemSeed + n, ...extra });
        const kind = item.brackets || "square";
        if (kind === "square") {
          for (const [x, dir, n] of [[5, 1, 0], [width - 5, -1, 1]]) {
            addShape(svg, rc.linearPath([[x + 7 * dir, 3], [x, 3], [x, height - 3], [x + 7 * dir, height - 3]], opts(n)));
          }
        } else if (kind === "round") {
          addShape(svg, rc.arc(13, height / 2, 18, height - 4, Math.PI * 0.6, Math.PI * 1.4, false, opts(0)));
          addShape(svg, rc.arc(width - 13, height / 2, 18, height - 4, -Math.PI * 0.4, Math.PI * 0.4, false, opts(1)));
        } else if (kind === "bar") {
          addShape(svg, rc.line(5, 3, 5, height - 3, opts(0)));
          addShape(svg, rc.line(width - 5, 3, width - 5, height - 3, opts(1)));
        }

        const rectOf = (cell) => {
          const r = rect(cell);
          return { left: r.left - box.left, top: r.top - box.top, right: r.right - box.left, bottom: r.bottom - box.top };
        };
        const union = (list) => list.map(rectOf).reduce((a, b) => ({
          left: Math.min(a.left, b.left), top: Math.min(a.top, b.top),
          right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom),
        }));
        (item.highlight || []).forEach((mark, index) => {
          const match = /^(?:r(\d+))?(?:c(\d+))?$/.exec(mark.replace(/\s+/g, ""));
          if (!match || (!match[1] && !match[2])) return;
          const r = match[1] ? Number(match[1]) - 1 : null;
          const c = match[2] ? Number(match[2]) - 1 : null;
          let targets;
          if (r !== null && c !== null) targets = cells[r]?.[c] ? [cells[r][c]] : [];
          else if (r !== null) targets = cells[r] || [];
          else targets = cells.map((row) => row[c]).filter(Boolean);
          if (!targets.length) return;
          const area = union(targets);
          const pad = 5;
          const color = HIGHLIGHT_COLORS[index % HIGHLIGHT_COLORS.length];
          const w = area.right - area.left + pad * 2;
          const h = area.bottom - area.top + pad * 2;
          const shape = targets.length === 1
            ? rc.ellipse(area.left + w / 2 - pad, area.top + h / 2 - pad, w + 8, h + 4, opts(5 + index, { strokeWidth: 1.8 }))
            : rc.rectangle(area.left - pad, area.top - pad, w, h, opts(5 + index, { strokeWidth: 1.8 }));
          addShape(svg, shape, color);
        });
        return svg;
      },
    };
  }

  function renderLabel(label) {
    const node = make("span", "wb-label");
    if (looksLikeLatex(label)) return renderLatex(node, label, false);
    node.textContent = label;
    return node;
  }

  function buildPlot(item) {
    const width = 360;
    const height = 240;
    const node = make("figure", "wb-item wb-plot");
    if (item.label) node.append(make("figcaption", "wb-label", item.label));
    const stage = make("div", "wb-plot-stage");
    stage.style.width = `${width}px`;
    stage.style.aspectRatio = `${width} / ${height}`;
    node.append(stage);
    const legend = make("div", "wb-plot-legend");
    node.append(legend);

    const xmin = item.xmin ?? -5;
    const xmax = item.xmax ?? 5;
    const samples = 240;
    const series = item.expressions.map((source, index) => {
      const entry = make("span", "wb-legend-entry");
      entry.style.color = HIGHLIGHT_COLORS[index % HIGHLIGHT_COLORS.length];
      entry.append(make("i", "wb-swatch"), make("span", "", source));
      legend.append(entry);
      try {
        const fn = compileExpression(source);
        const points = [];
        for (let i = 0; i <= samples; i += 1) {
          const x = xmin + ((xmax - xmin) * i) / samples;
          const y = fn(x);
          points.push([x, Number.isFinite(y) ? y : NaN]);
        }
        return points;
      } catch (error) {
        entry.classList.add("wb-legend-error");
        entry.title = `Could not plot: ${error.message}`;
        return [];
      }
    });

    const ys = series.flat().map((p) => p[1]).filter(Number.isFinite).sort((a, b) => a - b);
    let ymin = ys.length ? ys[Math.floor(ys.length * 0.02)] : -5;
    let ymax = ys.length ? ys[Math.ceil(ys.length * 0.98) - 1] : 5;
    if (ymin > 0) ymin = Math.min(0, ymin);
    if (ymax < 0) ymax = Math.max(0, ymax);
    if (ymax - ymin < 1e-6) { ymin -= 1; ymax += 1; }
    const spanY = ymax - ymin;
    ymin -= spanY * 0.08;
    ymax += spanY * 0.08;

    const pad = 24;
    const sx = (x) => pad + ((x - xmin) / (xmax - xmin)) * (width - pad * 2);
    const sy = (y) => height - pad - ((y - ymin) / (ymax - ymin)) * (height - pad * 2);
    const itemSeed = seed++;
    seed += 10;

    return {
      node,
      ink() {
        const svg = overlay(stage);
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        const rc = window.rough.svg(svg);
        const axis = roughOptions({ seed: itemSeed, strokeWidth: 1.2, roughness: 0.8 });
        const x0 = xmin <= 0 && xmax >= 0 ? sx(0) : pad;
        const y0 = ymin <= 0 && ymax >= 0 ? sy(0) : height - pad;
        addShape(svg, rc.line(pad - 6, y0, width - pad + 8, y0, axis), "var(--wb-faint)");
        addShape(svg, rc.line(x0, height - pad + 6, x0, pad - 8, axis), "var(--wb-faint)");
        const tick = (value) => Number(value.toPrecision(3)).toString();
        const labels = [[sx(xmax) - 4, y0 + 16, tick(xmax), "end"], [sx(xmin) + 2, y0 + 16, tick(xmin), "start"],
          [x0 + 6, sy(ymax - spanY * 0.08) + 4, tick(ymax - spanY * 0.08), "start"],
          [x0 + 6, sy(ymin + spanY * 0.08) + 4, tick(ymin + spanY * 0.08), "start"]];
        for (const [x, y, text, anchor] of labels) {
          const label = document.createElementNS(SVG_NS, "text");
          label.setAttribute("x", x);
          label.setAttribute("y", y);
          label.setAttribute("text-anchor", anchor);
          label.setAttribute("class", "wb-tick");
          label.textContent = text;
          svg.appendChild(label);
        }
        series.forEach((points, index) => {
          let run = [];
          const flush = () => {
            if (run.length > 1) {
              addShape(svg, rc.linearPath(run, roughOptions({ seed: itemSeed + index + 1, roughness: 0.6, strokeWidth: 2 })),
                HIGHLIGHT_COLORS[index % HIGHLIGHT_COLORS.length]);
            }
            run = [];
          };
          let previous = null;
          for (const [x, y] of points) {
            const inside = Number.isFinite(y) && y >= ymin - spanY && y <= ymax + spanY;
            // Break the line at asymptotes and gaps instead of drawing a vertical spike.
            if (!inside || (previous !== null && Math.abs(y - previous) > spanY * 0.9)) {
              flush();
              previous = inside ? y : null;
              if (inside) run.push([sx(x), sy(Math.max(ymin, Math.min(ymax, y)))]);
              continue;
            }
            run.push([sx(x), sy(Math.max(ymin, Math.min(ymax, y)))]);
            previous = y;
          }
          flush();
        });
        return svg;
      },
    };
  }

  // Pipeline timing diagram: instructions down the side, clock cycles across the
  // top, a hand-drawn box per stage, hatched stalls, dashed bubbles and curved
  // forwarding arrows between cells.
  function buildPipeline(item) {
    const node = make("div", "wb-item wb-pipeline");
    if (item.label) node.append(renderLabel(item.label));
    const rows = Array.isArray(item.rows) ? item.rows : [];
    const cycles = Math.max(1, item.cycles || Math.max(...rows.map((row) => row.cells.length)));
    const grid = make("div", "wb-pipe-grid");
    grid.style.gridTemplateColumns = `auto repeat(${cycles}, minmax(2.7em, auto))`;
    grid.append(make("span", "wb-pipe-corner"));
    for (let c = 1; c <= cycles; c += 1) grid.append(make("span", "wb-pipe-cycle", String(c)));
    const cells = rows.map((row) => {
      grid.append(renderMixed(make("span", "wb-pipe-instr"), row.instruction || ""));
      const list = [];
      for (let c = 0; c < cycles; c += 1) {
        const value = row.cells[c] || "";
        const kind = value === "stall" || value === "bubble" ? value : value ? "stage" : "empty";
        const cell = make("span", `wb-pipe-cell wb-pipe-${kind}`, value);
        cell.dataset.kind = kind;
        grid.append(cell);
        list.push(cell);
      }
      return list;
    });
    node.append(grid);
    const itemSeed = seed++;
    seed += 60;

    return {
      node,
      ink() {
        const svg = overlay(grid);
        const rc = window.rough.svg(svg);
        const box = rect(grid);
        const rectOf = (cell) => {
          const r = rect(cell);
          return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
        };
        let n = 0;
        const opts = (extra) => roughOptions({ seed: itemSeed + (n++ % 60), ...extra });
        cells.forEach((list) => list.forEach((cell) => {
          const { x, y, w, h } = rectOf(cell);
          const kind = cell.dataset.kind;
          if (kind === "stage") addShape(svg, rc.rectangle(x + 2, y + 2, w - 4, h - 4, opts({ strokeWidth: 1.4 })));
          else if (kind === "stall") {
            addShape(svg, rc.rectangle(x + 2, y + 2, w - 4, h - 4, opts({
              strokeWidth: 1.5, fill: "currentColor", fillStyle: "hachure", hachureGap: 6, fillWeight: 0.9,
            })), "var(--wb-mark-3)");
          } else if (kind === "bubble") {
            addShape(svg, rc.ellipse(x + w / 2, y + h / 2, w - 2, h - 2, opts({ strokeWidth: 1.4, strokeLineDash: [5, 5] })), "var(--wb-mark-2)");
          }
        }));
        (item.forward || []).forEach((entry) => {
          const match = /^r(\d+)c(\d+)>r(\d+)c(\d+)$/.exec(entry);
          if (!match) return;
          const [r1, c1, r2, c2] = match.slice(1).map((v) => Number(v) - 1);
          const from = cells[r1]?.[c1];
          const to = cells[r2]?.[c2];
          if (!from || !to) return;
          const a = rectOf(from);
          const b = rectOf(to);
          const down = b.y >= a.y;
          const start = [a.x + a.w * 0.7, down ? a.y + a.h - 2 : a.y + 2];
          const end = [b.x + b.w * 0.3, down ? b.y + 3 : b.y + b.h - 3];
          const mid = [(start[0] + end[0]) / 2 + 16, (start[1] + end[1]) / 2];
          const o = opts({ strokeWidth: 2.4 });
          addShape(svg, rc.curve([start, mid, end], o), "var(--wb-mark-1)");
          const angle = Math.atan2(end[1] - mid[1], end[0] - mid[0]);
          for (const turn of [0.5, -0.5]) {
            const tip = [end[0] - 9 * Math.cos(angle + turn), end[1] - 9 * Math.sin(angle + turn)];
            addShape(svg, rc.line(end[0], end[1], tip[0], tip[1], o), "var(--wb-mark-1)");
          }
        });
        return svg;
      },
    };
  }

  const BUILDERS = {
    text: buildText, note: buildText, math: buildMath, op: buildOp, box: buildBox,
    arrow: buildArrow, matrix: buildMatrix, plot: buildPlot, pipeline: buildPipeline,
  };

  // ---------------------------------------------------------------------------
  // Steps
  // ---------------------------------------------------------------------------
  function inkStep(step, animate) {
    if (!window.rough) return;
    step._built.forEach((built, index) => {
      if (!built.ink) return;
      [].concat(built.svg || []).forEach((svg) => svg.remove());
      try {
        built.svg = built.ink();
        if (animate) [].concat(built.svg).forEach((svg) => animateStrokes(svg, index * 140));
      } catch (error) {
        console.warn("whiteboard ink failed", error);
      }
    });
  }

  function updateCount() {
    const steps = el.board.querySelectorAll(".wb-step").length;
    el.empty.hidden = steps > 0;
    el.count.textContent = steps === 1 ? "1 step" : `${steps} steps`;
    el.clearBtn.disabled = steps === 0;
  }

  function clear() {
    el.board.querySelectorAll(".wb-step").forEach((step) => step.remove());
    window.SkybridgeGeminiInk?.clear();
    updateCount();
  }

  // The user can write on this board (geminiink.js). A new step starts below
  // their writing so it never lands on top of it.
  function placeBelowUserInk(step) {
    const inkBottom = window.SkybridgeGeminiInk?.bottom() || 0;
    if (!inkBottom) return;
    const last = [...el.board.querySelectorAll(".wb-step")].pop();
    const naturalTop = last ? last.offsetTop + last.offsetHeight : 0;
    if (inkBottom > naturalTop) step.style.marginTop = `${Math.ceil(inkBottom - naturalTop + 18)}px`;
  }

  function buildStep(packet, className) {
    const step = make("article", className);
    if (packet.title) step.append(make("h4", "wb-title", packet.title));
    const row = make("div", "wb-row");
    step.append(row);
    step._built = [];
    packet.items.forEach((item, index) => {
      const builder = BUILDERS[item.kind] || buildText;
      try {
        const built = builder(item);
        built.node.style.setProperty("--wb-delay", `${index * 140}ms`);
        row.append(built.node);
        step._built.push(built);
      } catch (error) {
        console.warn("whiteboard item failed", item, error);
      }
    });
    return step;
  }

  async function inkWhenReady(step, host, animate = true) {
    await fontsReady;
    const fonts = host.ownerDocument.fonts;
    if (fonts && fonts !== document.fonts) await fonts.load?.("20px Virgil").catch(() => {});
    await fonts?.ready;
    (host.ownerDocument.defaultView || window).requestAnimationFrame(() => {
      inkStep(step, animate);
      let lastWidth = step.clientWidth;
      new ResizeObserver(() => {
        if (step.clientWidth === lastWidth) return;
        lastWidth = step.clientWidth;
        inkStep(step, false);
      }).observe(step);
    });
  }

  // board="mine": the problem goes in the top-left corner of My board, where the
  // user works around it. One problem at a time; Hide puts it away.
  // How the problem card looks (Settings > Appearance). The packet carries it too, so the iPad
  // draws the card the same way.
  let cardStyle = { font: "inter", color: "auto", weight: "medium", size: "l" };

  function applyCardStyle(card, style) {
    const { font = "inter", color = "auto", weight = "medium", size = "l" } = style || {};
    card.dataset.cardWeight = ["regular", "medium", "semibold", "bold"].includes(weight) ? weight : "medium";
    card.dataset.cardSize = ["s", "m", "l", "xl"].includes(size) ? size : "l";
    card.dataset.cardFont = ["hand", "roboto", "inter", "jetbrains"].includes(font) ? font : "inter";
    const custom = /^#[0-9a-f]{6}$/i.test(color || "");
    card.dataset.cardColor = custom ? "custom" : "auto";
    if (custom) {
      card.style.setProperty("--wb-ink", color);
      card.style.setProperty("--wb-faint", color);
    } else {
      card.style.removeProperty("--wb-ink");
      card.style.removeProperty("--wb-faint");
    }
  }

  function setCardStyle(style) {
    cardStyle = { font: style?.font || "inter", color: style?.color || "auto", weight: style?.weight || "medium", size: style?.size || "l" };
    document.querySelectorAll(".my-board-problem").forEach((card) => applyCardStyle(card, cardStyle));
    try { hooks.onCardStyle?.(cardStyle); } catch {}
  }

  function showOnMyBoard(packet) {
    // The PC's My board, or the iPad's own board.
    const stage = document.querySelector(".my-board-stage, [data-problem-stage]");
    if (!stage) return false;
    let card = stage.querySelector(".my-board-problem");
    if (!card) {
      card = make("div", "my-board-problem");
      const hide = make("button", "my-board-problem-hide", "Hide");
      hide.type = "button";
      hide.title = "Hide the problem";
      hide.addEventListener("click", () => { card.hidden = true; });
      card.append(hide);
      stage.append(card);
    }
    applyCardStyle(card, packet.card || cardStyle);
    // The same card again (a resend, a reconnect, a style change) is left alone: rebuilding it
    // redrew every bracket and flickered, most on the iPad.
    const key = JSON.stringify([packet.title || "", packet.items]);
    if (card._key === key && card.querySelector(".wb-step")) {
      return true;
    }
    // Gemini adding to the same problem fills the card in place without redrawing what's there.
    const sameProblem = card._title === (packet.title || "") && !!card.querySelector(".wb-step");
    const step = buildStep(packet, "wb-step wb-problem-step");
    if (!step._built.length) return true;
    card.querySelector(".wb-step")?.remove();
    card.append(step);
    card._key = key;
    card._title = packet.title || "";
    card.hidden = false;
    inkWhenReady(step, card, !sameProblem);
    return true;
  }

  function myBoardProblem() {
    const card = document.querySelector(".my-board-stage .my-board-problem, [data-problem-stage] .my-board-problem");
    if (!card || card.hidden) return null;
    const title = card.querySelector(".wb-title")?.textContent?.trim() || "";
    return { title, text: (card.textContent || "").replace(/\s+/g, " ").trim().slice(0, 800), rect: card.getBoundingClientRect() };
  }

  async function draw(packet) {
    if (!packet || !Array.isArray(packet.items)) return;
    if (packet.board === "mine" && showOnMyBoard(packet)) {
      try { hooks.onDraw?.({ ...packet, card: cardStyle }); } catch {}
      return;
    }
    if (packet.clear) clear();
    const step = buildStep(packet, "wb-step");
    if (!step._built.length) return;

    // A mirrored step (the iPad) reuses the gap the PC left above it, so both line up.
    if (Number.isFinite(packet.gap)) {
      if (packet.gap > 0) step.style.marginTop = `${packet.gap}px`;
    } else {
      placeBelowUserInk(step);
    }
    el.board.append(step);
    try { hooks.onDraw?.({ ...packet, gap: parseFloat(step.style.marginTop) || 0 }); } catch {}
    const steps = el.board.querySelectorAll(".wb-step");
    // Removing the oldest step would slide everything under the user's writing.
    if (steps.length > MAX_STEPS && !window.SkybridgeGeminiInk?.hasInk()) steps[0].remove();
    updateCount();
    window.SkybridgeGeminiInk?.layout();
    el.board.scrollTo({ top: el.board.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
    inkWhenReady(step, el.board);
  }

  function setExpanded(expanded) {
    el.card.classList.toggle("is-expanded", expanded);
    el.expandBtn.textContent = expanded ? "Close" : "Expand";
    el.expandBtn.setAttribute("aria-pressed", String(expanded));
    document.body.classList.toggle("wb-locked", expanded);
  }

  el.clearBtn.addEventListener("click", () => {
    clear();
    try { hooks.onClear?.(); } catch {}
  });
  el.expandBtn?.addEventListener("click", () => setExpanded(!el.card.classList.contains("is-expanded")));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && el.expandBtn && el.card.classList.contains("is-expanded")) setExpanded(false);
  });
  updateCount();

  // Transcript lines: typeset $...$ and \(...\) with KaTeX, leave everything else as text.
  // The $ rules (no space inside the delimiters, no digit after the closing one)
  // keep prices like "$5 and $10" as plain text.
  const TRANSCRIPT_MATH = /\\\((.+?)\\\)|(?<![\\$\w])\$(?=[^\s$])([^$\n]*?[^\s$\\])\$(?![\w$])/g;

  function renderTextWithMath(target, text) {
    const value = String(text ?? "");
    target.textContent = "";
    let last = 0;
    for (const match of value.matchAll(TRANSCRIPT_MATH)) {
      if (match.index > last) target.append(value.slice(last, match.index));
      const latex = match[1] ?? match[2];
      const node = make("span", "transcript-math");
      if (window.katex) {
        try {
          window.katex.render(latex, node, { displayMode: false, throwOnError: false, strict: "ignore", output: "html" });
        } catch {
          node.textContent = match[0];
        }
      } else {
        node.textContent = match[0];
      }
      target.append(node);
      last = match.index + match[0].length;
    }
    if (last < value.length) target.append(value.slice(last));
    return target;
  }

  window.SkybridgeWhiteboard = { setCardStyle, draw, clear, hooks, compileExpression, renderTextWithMath, myBoardProblem };
})();
