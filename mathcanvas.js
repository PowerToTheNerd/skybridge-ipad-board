/*
 * Typeset math on the canvas, so a pinned homework problem keeps its real math.
 *
 * KaTeX (already on the page) does the typesetting: fractions, subscripts, Greek, matrices with tall
 * brackets. This file reads where KaTeX put every glyph, rule and bracket in a hidden copy, and
 * keeps that as a short list of drawing steps. The page draws that list with the same canvas as the
 * ink, at any zoom, so it stays sharp, pans and zooms with the paper, is exported with it, and is
 * never a flattened picture.
 *
 * A "rich" item (a pinned problem) is { title, text, lines, font, size, wrap, ... }: the title, a
 * paragraph that may hold $inline math$, and display equations or matrices, one per line.
 * Inline math is never broken across lines; a display equation wider than `wrap` is scaled down
 * evenly instead of being cut.
 *
 * window.SkybridgeTypeset = { LAYOUT, handFontReady, warm, configure, spec, layout, ready, prepare, load, draw, normalize }
 */
(() => {
  "use strict";

  const BASE = 40; // px used to measure KaTeX; the steps are scaled from here
  const SENTINEL = "rgb(1, 2, 3)"; // the colour KaTeX draws in while measuring: it means "the item's own colour"
  const SVG_NS = "http://www.w3.org/2000/svg";
  const RULE_CLASSES = ["frac-line", "overline-line", "underline-line", "hline", "hdashline", "rule"];

  let families = {};
  let host = null;
  const measurer = document.createElement("canvas").getContext("2d");
  const typeset_cache = new Map();
  const layouts = new Map();
  const tried = new Set(); // font strings a load was attempted for, so a font that never arrives can't loop forever
  const loading = new Map();

  function configure(map) { families = { ...families, ...map }; }

  function ensureHost() {
    if (host && host.isConnected) return host;
    const style = document.createElement("style");
    style.textContent = "#sbMathHost .katex{font-size:1em !important;text-indent:0}#sbMathHost .katex-display{margin:0}";
    document.head.append(style);
    host = document.createElement("div");
    host.id = "sbMathHost";
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = `position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;width:max-content;font-size:${BASE}px;line-height:normal;white-space:nowrap;color:${SENTINEL};z-index:-1`;
    document.body.append(host);
    return host;
  }

  // ---- fonts -----------------------------------------------------------------------------------
  const fontStringOf = (style, weight, size, family) => `${style} ${weight} ${size}px ${family}`;
  function fontMissing(font, sample) {
    if (tried.has(font)) return false;
    try { return !document.fonts.check(font, sample); } catch { return false; }
  }
  function load(fonts) {
    const list = [...new Set(fonts || [])];
    return Promise.all(list.map((font) => {
      if (loading.has(font)) return loading.get(font);
      const promise = (document.fonts?.load ? document.fonts.load(font, "0Aa∑[(−") : Promise.resolve()).catch(() => {}).then(() => { tried.add(font); });
      loading.set(font, promise);
      promise.then(() => loading.delete(font));
      return promise;
    }));
  }

  // ---- reading KaTeX's layout ------------------------------------------------------------------
  const colorAlpha = (css) => {
    if (!css || css === "transparent") return 0;
    const hit = /rgba\(\s*[\d.]+,\s*[\d.]+,\s*[\d.]+,\s*([\d.]+)\s*\)/.exec(css);
    return hit ? Number(hit[1]) : 1;
  };
  const ownColor = (css) => (css === SENTINEL ? null : css);
  const intersect = (a, b) => {
    if (!a) return b;
    const x0 = Math.max(a[0], b[0]);
    const y0 = Math.max(a[1], b[1]);
    const x1 = Math.min(a[0] + a[2], b[0] + b[2]);
    const y1 = Math.min(a[1] + a[3], b[1] + b[3]);
    return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
  };

  // The width of a rule KaTeX draws as a border. Browsers snap borders to whole device pixels, which would make
  // fraction bars thinner or thicker depending on the screen, so the intended size is used.
  function ruleWidth(node, cs, side, used) {
    const inline = node.style?.[`border${side}Width`];
    const fontSize = parseFloat(cs.fontSize) || BASE;
    if (inline && /em$/.test(inline)) return parseFloat(inline) * fontSize;
    if (inline && /px$/.test(inline)) return parseFloat(inline);
    if (RULE_CLASSES.some((name) => node.classList.contains(name))) return 0.04 * fontSize;
    return used;
  }

  function collect(katexNode, origin, baseline, missing) {
    const ops = [];
    const rel = (rect) => [rect.left - origin, rect.top - baseline, rect.width, rect.height];
    let variant = null; // "tb": only in the textbook style (the pieces of a bracket, which the handwritten style draws itself)

    function textOp(textNode, parent, clip) {
      const s = textNode.nodeValue.replace(/[\u200b\u200c\u200d\ufeff]/g, "");
      if (!s.replace(/[ \t\n\r]/g, "")) return;
      const probe = document.createElement("span");
      probe.style.cssText = "display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline";
      parent.insertBefore(probe, textNode);
      const at = probe.getBoundingClientRect();
      parent.removeChild(probe);
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const span = range.getBoundingClientRect();
      const cs = getComputedStyle(parent);
      const font = { style: cs.fontStyle, weight: cs.fontWeight, size: parseFloat(cs.fontSize), family: cs.fontFamily };
      const css = fontStringOf(font.style, font.weight, font.size, font.family);
      if (fontMissing(css, s)) missing.add(css);
      ops.push({ k: "t", s, x: at.left - origin, y: at.bottom - baseline, w: span.width, font, color: ownColor(cs.color), clip, v: variant });
    }

    function boxOps(node, cs, rect, clip) {
      const [x, y, w, h] = rel(rect);
      const isRule = RULE_CLASSES.some((name) => node.classList.contains(name));
      if (colorAlpha(cs.backgroundColor) > 0 && w > 0 && h > 0) ops.push({ k: "r", x, y, w, h, color: ownColor(cs.backgroundColor), clip, v: variant });
      for (const [side, name] of [["Top", "top"], ["Right", "right"], ["Bottom", "bottom"], ["Left", "left"]]) {
        const used = parseFloat(cs[`border${side}Width`]) || 0;
        const style = cs[`border${side}Style`];
        if (!used || style === "none" || style === "hidden" || colorAlpha(cs[`border${side}Color`]) === 0) continue;
        const t = ruleWidth(node, cs, side, used);
        const color = ownColor(cs[`border${side}Color`]);
        if (name === "top") ops.push({ k: "r", x, y: y + used / 2 - t / 2, w, h: t, color, clip, rule: isRule, v: variant });
        if (name === "bottom") ops.push({ k: "r", x, y: y + h - used / 2 - t / 2, w, h: t, color, clip, rule: isRule, v: variant });
        if (name === "left") ops.push({ k: "r", x: x + used / 2 - t / 2, y, w: t, h, color, clip, v: variant });
        if (name === "right") ops.push({ k: "r", x: x + w - used / 2 - t / 2, y, w: t, h, color, clip, v: variant });
      }
    }

    function svgOps(svg, cs, rect, clip) {
      const vbText = (svg.getAttribute("viewBox") || "").trim();
      const vb = vbText ? vbText.split(/[\s,]+/).map(Number) : [0, 0, rect.width, rect.height];
      if (vb.length < 4 || !(vb[2] > 0) || !(vb[3] > 0)) return;
      const par = (svg.getAttribute("preserveAspectRatio") || "xMidYMid meet").trim().split(/\s+/);
      let sx = rect.width / vb[2];
      let sy = rect.height / vb[3];
      if (par[0] !== "none") {
        const s = par[1] === "slice" ? Math.max(sx, sy) : Math.min(sx, sy);
        sx = s;
        sy = s;
      }
      const ax = par[0].includes("xMin") ? 0 : par[0].includes("xMax") ? 1 : 0.5;
      const ay = par[0].includes("YMin") ? 0 : par[0].includes("YMax") ? 1 : 0.5;
      const tx = rect.left - origin + (rect.width - vb[2] * sx) * (par[0] === "none" ? 0 : ax) - vb[0] * sx;
      const ty = rect.top - baseline + (rect.height - vb[3] * sy) * (par[0] === "none" ? 0 : ay) - vb[1] * sy;
      const inner = intersect(clip, rel(rect));
      const color = ownColor(cs.color);
      for (const child of svg.children) {
        if (child.localName === "path") {
          const d = child.getAttribute("d");
          if (d) ops.push({ k: "p", d, m: [sx, 0, 0, sy, tx, ty], color, clip: inner, box: rel(rect), v: variant });
        } else if (child.localName === "line") {
          const num = (name, size) => {
            const raw = child.getAttribute(name) || "0";
            return raw.endsWith("%") ? (parseFloat(raw) / 100) * size : parseFloat(raw);
          };
          const ccs = getComputedStyle(child);
          ops.push({
            k: "l",
            x1: tx + num("x1", vb[2]) * sx, y1: ty + num("y1", vb[3]) * sy, x2: tx + num("x2", vb[2]) * sx, y2: ty + num("y2", vb[3]) * sy,
            lw: parseFloat(ccs.strokeWidth) || 1, color: ownColor(ccs.stroke === "none" ? cs.color : ccs.stroke), clip: inner, v: variant,
          });
        }
      }
    }

    function walk(node, clip) {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) { textOp(child, node, clip); continue; }
        if (child.nodeType !== 1) continue;
        const cs = getComputedStyle(child);
        if (cs.display === "none" || child.classList?.contains("katex-mathml")) continue;
        const rect = child.getBoundingClientRect();
        if (child.namespaceURI === SVG_NS) {
          if (child.localName === "svg") svgOps(child, cs, rect, clip);
          continue;
        }
        boxOps(child, cs, rect, clip);
        const hides = cs.overflowX !== "visible" || cs.overflowY !== "visible";
        if (child.classList.contains("delimsizing") && variant === null) {
          // A bracket: keep KaTeX's own pieces for the textbook style, and describe it once for the handwritten one.
          const first = ops.length;
          variant = "tb";
          walk(child, hides ? intersect(clip, rel(rect)) : clip);
          variant = null;
          const delim = describeDelimiter(child, ops.slice(first), cs);
          if (delim) ops.push(delim);
          continue;
        }
        walk(child, hides ? intersect(clip, rel(rect)) : clip);
      }
    }

    // What kind of bracket this is, which side it stands on, and the box its ink fills.
    function describeDelimiter(node, made, cs) {
      const parent = node.parentElement;
      const side = parent?.classList.contains("mclose") ? "R" : "L";
      let kind = "bar";
      let box = null;
      const grow = (x0, y0, x1, y1) => { box = box ? [Math.min(box[0], x0), Math.min(box[1], y0), Math.max(box[2], x1), Math.max(box[3], y1)] : [x0, y0, x1, y1]; };
      for (const op of made) {
        if (op.k === "t") {
          const ch = op.s.trim();
          if (/[\[\]⎡⎢⎣⎤⎥⎦]/.test(ch)) kind = "square";
          else if (/[()⎛⎜⎝⎞⎟⎠]/.test(ch)) kind = "round";
          measurer.font = fontStringOf(op.font.style, op.font.weight, op.font.size, op.font.family);
          const m = measurer.measureText(ch);
          grow(op.x, op.y - m.actualBoundingBoxAscent, op.x + m.width, op.y + m.actualBoundingBoxDescent);
        } else if (op.k === "p") {
          kind = /[cC]/.test(op.d.replace(/[MmLlHhVvZz]/g, "")) ? "round" : /[Hh]/.test(op.d) ? "square" : "bar";
          grow(op.box[0], op.box[1], op.box[0] + op.box[2], op.box[1] + op.box[3]);
        }
      }
      if (!box || box[3] - box[1] < 1) return null;
      return { k: "d", kind, side, x: box[0], y: box[1], w: box[2] - box[0], h: box[3] - box[1], em: parseFloat(cs.fontSize) || BASE, v: "hd" };
    }
    walk(katexNode, null);
    return ops;
  }

  // One formula as steps around its baseline (at BASE px), or { ok: false } when it can't be typeset yet.
  function typeset(latex, display) {
    const key = `${display ? "D" : "I"}\u0000${latex}`;
    if (typeset_cache.has(key)) return typeset_cache.get(key);
    if (!window.katex) return { ok: false, failed: true };
    const holder = document.createElement("span");
    holder.style.cssText = "display:inline-block";
    try {
      window.katex.render(display ? `\\displaystyle ${latex}` : latex, holder, { displayMode: false, throwOnError: true, strict: "ignore", output: "html", maxExpand: 500 });
    } catch {
      return { ok: false, failed: true };
    }
    const h = ensureHost();
    h.replaceChildren(holder);
    const html = holder.querySelector(".katex-html");
    const struts = [...holder.querySelectorAll(".strut")];
    if (!html || !struts.length) return { ok: false, failed: true };
    const first = struts[0];
    const firstRect = first.getBoundingClientRect();
    const baseline = firstRect.bottom + (parseFloat(getComputedStyle(first).verticalAlign) || 0);
    let top = Infinity;
    let bottom = -Infinity;
    for (const strut of struts) {
      const r = strut.getBoundingClientRect();
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
    }
    const bases = [...holder.querySelectorAll(".base")];
    const left = Math.min(...bases.map((b) => b.getBoundingClientRect().left));
    const right = Math.max(...bases.map((b) => b.getBoundingClientRect().right));
    const missing = new Set();
    const ops = collect(html, left, baseline, missing);
    h.replaceChildren();
    const result = { ok: !missing.size, missing: [...missing], asc: baseline - top, desc: bottom - baseline, w: right - left, ops };
    if (result.ok) typeset_cache.set(key, result);
    return result;
  }

  // ---- placing steps into a layout --------------------------------------------------------------
  const moveClip = (clip, f, dx, dy) => (clip ? [clip[0] * f + dx, clip[1] * f + dy, clip[2] * f, clip[3] * f] : undefined);
  function place(out, ops, f, dx, dy, role) {
    for (const op of ops) {
      const clip = moveClip(op.clip, f, dx, dy);
      const common = { role, color: op.color || undefined, clip, v: op.v || undefined };
      if (op.k === "t") out.push({ ...common, k: "t", s: op.s, x: op.x * f + dx, y: op.y * f + dy, w: op.w * f, font: { ...op.font, size: op.font.size * f } });
      else if (op.k === "r") out.push({ ...common, k: "r", x: op.x * f + dx, y: op.y * f + dy, w: op.w * f, h: op.h * f, rule: op.rule || undefined });
      else if (op.k === "p") out.push({ ...common, k: "p", d: op.d, m: [op.m[0] * f, 0, 0, op.m[3] * f, op.m[4] * f + dx, op.m[5] * f + dy] });
      else if (op.k === "l") out.push({ ...common, k: "l", x1: op.x1 * f + dx, y1: op.y1 * f + dy, x2: op.x2 * f + dx, y2: op.y2 * f + dy, lw: op.lw * f });
      else if (op.k === "d") out.push({ ...common, k: "d", kind: op.kind, side: op.side, x: op.x * f + dx, y: op.y * f + dy, w: op.w * f, h: op.h * f, em: op.em * f });
    }
  }

  // ---- reading the wording: $inline math$, \( \) and stray commands like \times ------------------
  const DOLLAR = /\\\((.+?)\\\)|\$([^$]+)\$/g;
  const BARE = /(\\[A-Za-z]+(?:\{[^{}]*\})*(?:\s*[\^_]\s*(?:\{[^{}]*\}|\w))*)/g;
  function pieces(text) {
    const out = [];
    const bare = (part) => {
      let last = 0;
      for (const hit of part.matchAll(BARE)) {
        if (hit.index > last) out.push({ t: "text", s: part.slice(last, hit.index) });
        out.push({ t: "math", s: hit[1] });
        last = hit.index + hit[0].length;
      }
      if (last < part.length) out.push({ t: "text", s: part.slice(last) });
    };
    let last = 0;
    for (const hit of String(text || "").matchAll(DOLLAR)) {
      if (hit.index > last) bare(text.slice(last, hit.index));
      out.push({ t: "math", s: hit[1] ?? hit[2] });
      last = hit.index + hit[0].length;
    }
    if (last < String(text || "").length) bare(String(text).slice(last));
    return out;
  }

  // A matrix written MATLAB style, [a b; c d] or [I_r 0; 0 0], becomes a real matrix.
  function normalize(src) {
    let text = String(src || "").trim();
    const wrapped = /^(?:\$\$([\s\S]*)\$\$|\$([\s\S]*)\$|\\\[([\s\S]*)\\\]|\\\(([\s\S]*)\\\))$/.exec(text);
    if (wrapped) text = (wrapped[1] ?? wrapped[2] ?? wrapped[3] ?? wrapped[4]).trim();
    return text.replace(/(^|[^\\])\[([^\[\]{}&]*;[^\[\]{}&]*)\]/g, (all, before, inner) => {
      const rows = inner.split(";").map((row) => row.trim()).filter(Boolean).map((row) => (row.includes(",") ? row.split(",") : row.split(/\s+/)).map((cell) => cell.trim()).filter(Boolean));
      if (!rows.length || rows.some((row) => !row.length)) return all;
      return `${before}\\begin{bmatrix} ${rows.map((row) => row.join(" & ")).join(" \\\\ ")} \\end{bmatrix}`;
    });
  }

  // ---- the problem as one layout -----------------------------------------------------------------
  function hashOf(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  function spec(input) {
    const made = {
      v: 1,
      title: String(input.title || ""),
      text: String(input.text || ""),
      lines: (input.lines || []).map(String),
      font: input.font || "inter",
      size: Number(input.size) || 22,
      wrap: Number(input.wrap) || 620,
      titleColor: input.titleColor || null,
      ink: input.ink || "ink",
    };
    made.sig = hashOf(JSON.stringify([made.title, made.text, made.lines, made.font, made.size, made.wrap]));
    return made;
  }

  function layout(item) {
    const family = families[item.font] || families.inter || "sans-serif";
    const Present = window.SkybridgePresent;
    const key = `${item.sig}|${family}|p${Present ? Present.VERSION : 0}`;
    if (layouts.has(key)) return layouts.get(key);
    const size = item.size;
    const missing = new Set();
    const out = [];
    let y = 0;
    let width = 0;
    const fontOf = (px) => `${px}px ${family}`;
    const metrics = (px) => {
      measurer.font = fontOf(px);
      const m = measurer.measureText("Hxg");
      return { asc: m.fontBoundingBoxAscent ?? px * 0.8, desc: m.fontBoundingBoxDescent ?? px * 0.25 };
    };
    const widthOf = (s, px) => { measurer.font = fontOf(px); return measurer.measureText(s).width; };
    const checkFont = (px, sample) => { const f = fontOf(px); if (fontMissing(f, sample)) missing.add(f); };
    const textOp = (s, x, baseline, px, role) => out.push({ k: "t", s, x, y: baseline, font: { style: "normal", weight: "400", size: px, family }, role });
    const inlineF = (size * 1.21) / BASE;
    const displayF = (size * (item.font === "hand" ? 0.96 : 1.16) * 1.21) / BASE;

    // Title
    if (item.title) {
      const px = size * 1.25;
      checkFont(px, item.title);
      const m = metrics(px);
      textOp(item.title, 0, y + m.asc, px, "title");
      width = Math.max(width, widthOf(item.title, px));
      y += (m.asc + m.desc) * 1.05 + size * 0.6;
    }

    // A paragraph with inline math; a formula is one unbreakable piece.
    const paragraph = (text) => {
      const textM = metrics(size);
      checkFont(size, text);
      const space = widthOf(" ", size);
      const chunks = [];
      let chunk = [];
      const close = (gap) => { if (chunk.length) chunks.push({ atoms: chunk, gap }); chunk = []; };
      for (const piece of pieces(text)) {
        if (piece.t === "math") {
          const res = typeset(normalize(piece.s), false);
          if (res.failed) { chunk.push({ w: widthOf(piece.s, size), asc: textM.asc, desc: textM.desc, text: piece.s }); continue; }
          (res.missing || []).forEach((f) => missing.add(f));
          chunk.push({ w: res.w * inlineF, asc: res.asc * inlineF, desc: res.desc * inlineF, math: res });
          continue;
        }
        for (const part of piece.s.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) close(true);
          else chunk.push({ w: widthOf(part, size), asc: textM.asc, desc: textM.desc, text: part });
        }
      }
      close(false);
      let line = [];
      let x = 0;
      const flush = () => {
        if (!line.length) return;
        let asc = textM.asc;
        let desc = textM.desc;
        for (const placed of line) { asc = Math.max(asc, placed.atom.asc); desc = Math.max(desc, placed.atom.desc); }
        const lineH = Math.max(size * 1.45, asc + desc + size * 0.2);
        const baseline = y + (lineH - (asc + desc)) / 2 + asc;
        for (const { atom, x: ax } of line) {
          if (atom.math) place(out, atom.math.ops, inlineF, ax, baseline, "math");
          else textOp(atom.text, ax, baseline, size, "text");
        }
        width = Math.max(width, line[line.length - 1].x + line[line.length - 1].atom.w);
        y += lineH;
        line = [];
        x = 0;
      };
      for (const c of chunks) {
        const cw = c.atoms.reduce((sum, a) => sum + a.w, 0);
        if (x > 0 && x + cw > item.wrap) flush();
        let ax = x;
        for (const atom of c.atoms) { line.push({ atom, x: ax }); ax += atom.w; }
        x = ax + (c.gap ? space : 0);
      }
      flush();
    };
    // The problem as the presentation layer reads it: wording, and display equations. Nothing saved is changed; old
    // pinned problems get the same treatment as new ones.
    const blocks = Present
      ? Present.present({ title: item.title, text: item.text, lines: item.lines }).blocks
      : [...(item.text ? [{ k: "p", src: item.text }] : []), ...item.lines.map((src) => ({ k: "d", src }))];

    for (const block of blocks) {
      if (block.k === "p") { paragraph(block.src); y += size * 0.5; continue; }
      const src = normalize(block.src);
      if (!src) continue;
      const res = typeset(src, true);
      if (res.failed) { paragraph(block.src); y += size * 0.5; continue; }
      (res.missing || []).forEach((f) => missing.add(f));
      let f = displayF;
      if (res.w * f > item.wrap) f = Math.max(displayF * 0.35, item.wrap / res.w);
      y += size * 0.25;
      place(out, res.ops, f, 0, y + res.asc * f, "math");
      width = Math.max(width, res.w * f);
      y += (res.asc + res.desc) * f + size * 0.7;
    }
    const height = Math.max(1, y - size * 0.5);
    if (missing.size) return { ok: false, missing: [...missing] };
    const done = { ok: true, w: Math.max(1, width), h: height, ops: out, family };
    layouts.set(key, done);
    if (layouts.size > 40) layouts.delete(layouts.keys().next().value);
    return done;
  }

  // Which way of laying a problem out a measured size belongs to (pinned copies re-measure when it changes).
  const LAYOUT = () => `p${window.SkybridgePresent ? window.SkybridgePresent.VERSION : 0}`;

  // Waits for the fonts a layout needs (the text font and any KaTeX faces it uses), then returns it.
  async function ready(item) {
    let lay = layout(item);
    for (let tries = 0; !lay.ok && tries < 4; tries += 1) {
      await load(lay.missing);
      lay = layout(item);
    }
    if (lay.ok) { item.nat = [lay.w, lay.h]; item.lay = LAYOUT(); }
    return lay;
  }
  async function prepare(strokes) {
    for (const stroke of strokes || []) if (stroke.rich) await ready(stroke.rich);
  }

  // ---- drawing ------------------------------------------------------------------------------------
  const pathCache = new Map();
  function pathOf(d) {
    let path = pathCache.get(d);
    if (!path) { path = new Path2D(d); pathCache.set(d, path); if (pathCache.size > 200) pathCache.delete(pathCache.keys().next().value); }
    return path;
  }

  // ---- the handwritten style ------------------------------------------------------------------------
  // The same layout, drawn the way the whiteboard draws maths: letters and digits in the hand font, brackets and
  // fraction bars as loose pen lines. Symbols the hand font lacks (Greek, big sums, roots) keep KaTeX's own shapes.
  const HAND_TEXT = /^[A-Za-z0-9.,;:()+\-=<>|/!?'*\u2212\u00b7\s]+$/;
  const HAND_FACES = /KaTeX_(Main|Math)\b/;
  function seeded(seed) {
    let s = (Math.imul(Math.round(seed * 100) | 0, 2654435761) >>> 0) || 1;
    return () => { s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0; return ((s >>> 8) / 8388608) - 1; };
  }
  function penLine(ctx, points, width, rand, shake) {
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let pass = 0; pass < 2; pass += 1) {
      ctx.globalAlpha = pass ? 0.55 : 1;
      ctx.beginPath();
      points.forEach(([x, y], i) => {
        const px = x + rand() * shake;
        const py = y + rand() * shake;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function handBracket(ctx, op, weight = 0) {
    if (op.kind === "square" && window.SkybridgeMarks) {
      // The auto-matrix tool's bracket geometry and pen renderer, fitted to KaTeX's slot.
      // Keep the ink inside the slot so neither entries nor neighbouring expressions are crossed.
      const width = Math.max(0.8, op.em * 0.065) * (1 + weight * 0.15);
      const inset = Math.min(width, op.w * 0.2, op.h * 0.1);
      const box = [op.x + inset, op.y + inset, op.x + op.w - inset, op.y + op.h - inset];
      const made = window.SkybridgeMarks.brackets(box, { left: op.side !== "R", right: op.side === "R" }, {
        gap: 0, lift: 0, arm: Math.min(op.em * 0.42, op.w - inset * 2),
      });
      for (const stroke of made.strokes) {
        if (window.SkybridgeInk?.fill(ctx, { ...stroke, width, sim: false, clean: true, done: true })) continue;
        ctx.lineWidth = width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        stroke.points.forEach(([x, y], i) => { if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.stroke();
      }
      return;
    }
    const rand = seeded(op.x * 7 + op.y * 13 + op.h);
    const lw = Math.max(0.8, op.em * 0.06);
    const shake = op.em * 0.012;
    const dir = op.side === "R" ? -1 : 1;
    const spine = op.side === "R" ? op.x + op.w * 0.62 : op.x + op.w * 0.38;
    const top = op.y + op.h * 0.015;
    const bottom = op.y + op.h * 0.985;
    if (op.kind === "square") {
      const arm = Math.min(Math.max(op.em * 0.32, op.h * 0.1), op.em * 0.8);
      penLine(ctx, [[spine + dir * arm, top], [spine, top], [spine, (top + bottom) / 2], [spine, bottom], [spine + dir * arm, bottom]], lw, rand, shake);
    } else if (op.kind === "round") {
      const bow = Math.min(Math.max(op.em * 0.3, op.h * 0.09), op.em * 0.7);
      const base = spine - dir * bow * 0.5;
      const pts = [];
      for (let i = 0; i <= 14; i += 1) {
        const t = i / 14;
        pts.push([base + dir * bow * (2 * t - 1) ** 2, top + (bottom - top) * t]);
      }
      penLine(ctx, pts, lw, rand, shake);
    } else {
      penLine(ctx, [[spine, top], [spine, bottom]], lw, rand, shake);
    }
  }

  // colors: { text, title, math } as CSS colours. weight: 0..3 draws heavier, like typed text. scale: layout px to page px.
  // style: "textbook" (KaTeX's own shapes) or "hand" (the whiteboard look).
  function draw(ctx, lay, { x, y, scale, colors, weight = 0, style = "textbook" }) {
    const hand = style === "hand";
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.textBaseline = "alphabetic";
    for (const op of lay.ops) {
      if (op.v === "tb" && hand) continue;
      if (op.v === "hd" && !hand) continue;
      ctx.save();
      if (op.clip) { ctx.beginPath(); ctx.rect(op.clip[0], op.clip[1], op.clip[2], op.clip[3]); ctx.clip(); }
      const color = op.color || colors[op.role] || colors.text;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      if (op.k === "t") {
        const family = op.font.family;
        if (hand && op.role === "math" && HAND_FACES.test(family) && HAND_TEXT.test(op.s)) {
          const size = op.font.size * 1.08;
          ctx.font = `400 ${size}px ${families.hand || "Virgil, cursive"}`;
          const s = op.s.replace(/\u2212/g, "-");
          const natural = ctx.measureText(s).width;
          const fit = op.w > 0 && natural > op.w * 1.02 ? Math.max(0.72, op.w / natural) : 1;
          const left = op.x + (op.w - natural * fit) / 2;
          ctx.translate(left, op.y);
          ctx.scale(fit, 1);
          ctx.fillText(s, 0, 0);
          if (weight > 0) { ctx.lineWidth = size * 0.03 * weight; ctx.lineJoin = "round"; ctx.strokeText(s, 0, 0); }
        } else {
          ctx.font = fontStringOf(op.font.style, op.font.weight, op.font.size, family);
          ctx.fillText(op.s, op.x, op.y);
          if (weight > 0) { ctx.lineWidth = op.font.size * 0.03 * weight; ctx.lineJoin = "round"; ctx.strokeText(op.s, op.x, op.y); }
        }
      } else if (op.k === "r") {
        if (hand && op.rule && op.w > op.h * 3) {
          const rand = seeded(op.x * 5 + op.y * 11 + op.w);
          penLine(ctx, [[op.x, op.y + op.h / 2], [op.x + op.w * 0.33, op.y + op.h / 2], [op.x + op.w * 0.66, op.y + op.h / 2], [op.x + op.w, op.y + op.h / 2]], Math.max(op.h * 1.15, 0.8), rand, Math.max(op.h * 0.35, 0.3));
        } else {
          ctx.fillRect(op.x, op.y, op.w, op.h);
        }
      } else if (op.k === "p") {
        ctx.transform(op.m[0], 0, 0, op.m[3], op.m[4], op.m[5]);
        ctx.fill(pathOf(op.d));
      } else if (op.k === "l") {
        ctx.lineWidth = op.lw;
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.stroke();
      } else if (op.k === "d") {
        handBracket(ctx, op, weight);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // The hand font the handwritten style uses: false (and a load started) until it is there.
  function handFontReady() {
    const font = `400 20px ${families.hand || "Virgil"}`;
    let ok = true;
    try { ok = document.fonts.check(font); } catch {}
    if (!ok) load([font]);
    return ok;
  }

  // Load the common KaTeX faces up front so the first pin doesn't wait.
  const warm = () => load(["normal 400 40px KaTeX_Main", "italic 400 40px KaTeX_Math", "normal 400 40px KaTeX_Size1", "normal 400 40px KaTeX_Size2", "normal 400 40px KaTeX_Size3", "normal 400 40px KaTeX_Size4", "normal 400 40px KaTeX_AMS", "italic 400 40px KaTeX_Main", "normal 700 40px KaTeX_Main"]);

  window.SkybridgeTypeset = { LAYOUT, handFontReady, warm, configure, spec, layout, ready, prepare, load, draw, normalize, typeset };
})();
