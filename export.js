/* Export: the whole board as one image, whatever its size or zoom. Like Excalidraw's
 * export, it renders the full extent of everything written (not just what's on
 * screen), on the current paper, with Gemini's problem card on top. The PNG goes
 * to the iPad's share sheet (Save Image, Files, Messages...); the PDF is a print
 * page with the board and Gemini's steps, saved from the print dialog.
 */
(() => {
  "use strict";

  const pad = window.SkybridgePad;
  if (!pad) return;

  const MAX_PIXELS = 16e6; // iPad Safari refuses bigger canvases
  const MAX_SIDE = 8192;
  const MAX_SCALE = 2; // sharper than the screen is wasted
  const MARGIN = 40; // board units around the writing
  const GAP = 24; // between the problem card and the writing
  const DOT_SPACING = 24;

  const el = {
    sheet: document.getElementById("exportSheet"),
    open: document.getElementById("exportBtn"),
    png: document.getElementById("exportPngBtn"),
    pdf: document.getElementById("exportPdfBtn"),
    note: document.getElementById("exportNote"),
  };

  function makeCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
  }

  // The scale that keeps a width x height picture inside the canvas limits.
  function fitScale(width, height) {
    return Math.min(MAX_SCALE, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_PIXELS / (width * height)));
  }

  function extent(strokes) {
    let box = null;
    for (const stroke of strokes) {
      if (stroke.eraser) continue;
      const half = stroke.width / 2 + 1;
      for (const [x, y] of stroke.points) {
        if (!box) box = { x0: x - half, y0: y - half, x1: x + half, y1: y + half };
        else {
          box.x0 = Math.min(box.x0, x - half);
          box.y0 = Math.min(box.y0, y - half);
          box.x1 = Math.max(box.x1, x + half);
          box.y1 = Math.max(box.y1, y + half);
        }
      }
    }
    return box;
  }

  function paint(target, width, height, scale, paper, dots, offsetX, offsetY) {
    target.fillStyle = paper;
    target.fillRect(0, 0, width, height);
    if (!dots) return;
    // Dots sit on the same board grid as on screen.
    target.fillStyle = dots;
    const radius = Math.max(1, 1.25 * scale);
    const startX = Math.ceil(offsetX / DOT_SPACING) * DOT_SPACING;
    const startY = Math.ceil(offsetY / DOT_SPACING) * DOT_SPACING;
    for (let y = startY; (y - offsetY) * scale < height; y += DOT_SPACING) {
      for (let x = startX; (x - offsetX) * scale < width; x += DOT_SPACING) {
        target.beginPath();
        target.arc((x - offsetX) * scale, (y - offsetY) * scale, radius, 0, Math.PI * 2);
        target.fill();
      }
    }
  }

  // The writing on its own layer, so erasers only cut the writing, not the paper.
  function inkLayer(strokes, box, scale, width, height) {
    const layer = makeCanvas(width, height);
    const ctx = layer.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, -box.x0 * scale, -box.y0 * scale);
    (window.SkybridgeInk?.layered ? window.SkybridgeInk.layered(strokes) : strokes).forEach((stroke) => pad.drawStroke(ctx, stroke));
    return layer;
  }

  // ---------------------------------------------------------------------------
  // DOM to picture, for Gemini's problem card and steps (text, KaTeX, drawn shapes).
  // The element is copied with its resolved styles into an SVG foreignObject, with
  // the fonts it uses embedded, since an SVG picture can't load anything else.
  // ---------------------------------------------------------------------------
  let fontCss = null;

  async function toDataUrl(url) {
    const blob = await (await fetch(url)).blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function fontsFrom(cssUrl) {
    const css = await (await fetch(cssUrl)).text();
    const rules = css.match(/@font-face\s*\{[^}]*\}/g) || [];
    const out = [];
    for (const rule of rules) {
      const woff2 = rule.match(/url\(\s*["']?([^"')]+\.woff2)["']?\s*\)/);
      if (!woff2) continue;
      try {
        const data = await toDataUrl(new URL(woff2[1], new URL(cssUrl, location.href)).href);
        out.push(rule.replace(/src:[^;}]*/, `src:url(${data}) format("woff2")`));
      } catch {}
    }
    return out.join("\n");
  }

  async function embeddedFonts() {
    if (fontCss === null) {
      const parts = await Promise.all(["./vendor/katex/katex.min.css", "./whiteboard.css"].map((url) => fontsFrom(url).catch(() => "")));
      fontCss = parts.join("\n");
    }
    return fontCss;
  }

  function inlineStyles(original, clone) {
    const computed = getComputedStyle(original);
    let text = "";
    for (const name of computed) {
      if (!name.startsWith("--")) text += `${name}:${computed.getPropertyValue(name)};`;
    }
    // Shown in full and finished, whatever the page is doing with it right now.
    clone.setAttribute("style", `${text}visibility:visible;animation:none;transition:none;`);
    const sources = original.children;
    for (let i = 0; i < sources.length; i += 1) inlineStyles(sources[i], clone.children[i]);
  }

  // A copy of a live element with its resolved styles, ready to draw into a picture.
  function styledCopy(node, drop) {
    const clone = node.cloneNode(true);
    inlineStyles(node, clone);
    clone.querySelectorAll(drop || ".none").forEach((child) => child.remove());
    // Percent limits would resolve against the picture's own box, not the page.
    Object.assign(clone.style, { maxWidth: "none", minWidth: "0", transform: "none", overflow: "visible" });
    return clone;
  }

  async function rasterize(node, drop) {
    const rect = node.getBoundingClientRect();
    const clone = styledCopy(node, drop);
    Object.assign(clone.style, { margin: "0", position: "static", width: `${Math.ceil(rect.width)}px`, height: `${Math.ceil(rect.height)}px` });
    return pictureOf(clone, Math.ceil(rect.width), Math.ceil(rect.height));
  }

  async function pictureOf(clone, width, height) {
    if (!width || !height) throw new Error("empty");
    const body = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
      + `<foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">`
      + `<style>${await embeddedFonts()}</style>${body}</div></foreignObject></svg>`;
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();
    return { image, width, height };
  }

  function problemNode() {
    const card = pad.stage.querySelector(".my-board-problem");
    return card && !card.hidden ? card : null;
  }

  async function problemPicture() {
    const card = problemNode();
    if (!card) return null;
    try {
      return await rasterize(card, ".my-board-problem-hide");
    } catch {
      // Without the picture, say what the problem was.
      const title = card.querySelector(".wb-title")?.textContent?.trim() || "Problem";
      const text = card.querySelector(".wb-row")?.textContent?.trim().slice(0, 300) || "";
      const canvas = makeCanvas(560, 90);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = pad.cssColor("ink");
      ctx.font = "20px sans-serif";
      ctx.fillText(title, 12, 30, 536);
      ctx.font = "15px sans-serif";
      ctx.fillText(text, 12, 62, 536);
      return { image: canvas, width: 560, height: 90 };
    }
  }

  // ---------------------------------------------------------------------------
  // The whole board as one canvas
  // ---------------------------------------------------------------------------
  // The whole board as a picture. { strokes } draws another notebook's ink instead of the open one, and
  // { withCard: false } leaves Gemini's problem card off (a page being read in the background).
  async function renderBoard(options = {}) {
    const strokes = (options.strokes || pad.strokes).filter((stroke) => stroke.points.length);
    const box = extent(strokes);
    const card = options.withCard === false ? null : await problemPicture();
    if (!box && !card) throw new Error("There is nothing on the board yet.");
    const inkW = box ? box.x1 - box.x0 + MARGIN * 2 : 0;
    const inkH = box ? box.y1 - box.y0 + MARGIN * 2 : 0;
    if (box) {
      box.x0 -= MARGIN;
      box.y0 -= MARGIN;
    }
    const cardW = card ? card.width + MARGIN * 2 : 0;
    const cardH = card ? card.height + MARGIN : 0;
    const width = Math.max(inkW, cardW, 320);
    const height = cardH + (card && box ? GAP : 0) + inkH;
    const scale = fitScale(width, height);
    const out = makeCanvas(width * scale, height * scale);
    const ctx = out.getContext("2d");
    // Dots follow the writing's own grid; the card band shares the paper.
    paint(ctx, out.width, out.height, scale, pad.cssColor("paper"), pad.settings.grid ? pad.cssColor("grid") : "",
      (box ? box.x0 : 0) - (width - inkW) / 2, -cardH - (card && box ? GAP : 0));
    if (card) ctx.drawImage(card.image, MARGIN * scale, (MARGIN / 2) * scale, card.width * scale, card.height * scale);
    if (box) {
      const layer = inkLayer(strokes, box, scale, inkW * scale, inkH * scale);
      ctx.drawImage(layer, ((width - inkW) / 2) * scale, (cardH + (card ? GAP : 0)) * scale);
    }
    return { canvas: out, width, height, scale };
  }

  const frames = (count) => new Promise((resolve) => {
    const tick = (left) => (left ? requestAnimationFrame(() => tick(left - 1)) : setTimeout(resolve, 80));
    tick(count);
  });

  // Gemini's steps, drawn one under the other as on its board, so the whole length shows however
  // far the board scrolls. When its pane is hidden it is shown for a moment so the steps can be measured.
  async function geminiPicture() {
    const board = pad.geminiBoard;
    if (!board.querySelector(".wb-step")) return null;
    const root = document.documentElement;
    const layout = root.dataset.layout;
    // Steps fade and draw themselves in when their pane appears; the picture needs them finished.
    const freeze = document.createElement("style");
    freeze.textContent = ".gemini, .gemini * { animation: none !important; transition: none !important; }";
    document.head.append(freeze);
    if (layout === "mine") {
      root.dataset.layout = "both";
      pad.fitGemini();
      await frames(3);
    }
    try {
      const steps = [...board.querySelectorAll(".wb-step")];
      const edge = pad.geminiSize().pad;
      const width = Math.ceil(board.clientWidth);
      const height = Math.ceil(Math.max(...steps.map((step) => step.offsetTop + step.offsetHeight)) + edge[2]);
      const column = document.createElement("div");
      column.style.cssText = `position:relative;width:${width}px;height:${height}px;background:${pad.cssColor("paper")};`;
      for (const step of steps) {
        const copy = styledCopy(step);
        Object.assign(copy.style, { position: "absolute", margin: "0", left: `${Math.max(step.offsetLeft, edge[3])}px`, top: `${step.offsetTop}px`, width: `${step.offsetWidth}px` });
        column.append(copy);
      }
      return await pictureOf(column, width, height);
    } catch {
      return null;
    } finally {
      if (layout === "mine") root.dataset.layout = layout;
      freeze.remove();
    }
  }

  // ---------------------------------------------------------------------------
  // Saving
  // ---------------------------------------------------------------------------
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

  function toBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The image was too big to save."))), "image/png"));
  }

  async function savePng() {
    const { canvas } = await renderBoard();
    const blob = await toBlob(canvas);
    const file = new File([blob], `skybridge-board-${stamp()}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Skybridge board" });
        return "Saved";
      } catch (error) {
        if (error?.name === "AbortError") return "";
      }
    }
    // No share sheet: download it, or open it to long-press and save.
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return "Image saved";
  }

  async function savePdf() {
    // Open the window first: browsers only allow it straight after the tap.
    const win = window.open("", "skybridge-export");
    if (!win) throw new Error("Allow pop-ups for this page, then try again.");
    win.document.write("<!doctype html><title>Exporting…</title><body style='font:16px sans-serif;padding:24px'>Exporting…</body>");
    try {
      const { canvas } = await renderBoard();
      const gemini = await geminiPicture();
      const parts = [`<img src="${canvas.toDataURL("image/png")}" alt="My board">`];
      if (gemini) {
        const shot = makeCanvas(gemini.width * 2, gemini.height * 2);
        const ctx = shot.getContext("2d");
        ctx.drawImage(gemini.image, 0, 0, shot.width, shot.height);
        parts.push(`<h2>Gemini's steps</h2><img src="${shot.toDataURL("image/png")}" alt="Gemini's steps">`);
      }
      win.document.open();
      win.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Skybridge board</title><style>
body{margin:0;padding:16px;font:16px -apple-system,sans-serif;background:#fff;color:#111}
img{display:block;width:100%;height:auto;margin:0 0 12px;border:1px solid #ccc}
h2{font-size:15px;margin:16px 0 8px}
button{font:inherit;padding:10px 16px;margin:0 0 12px;border-radius:10px;border:1px solid #888;background:#f3f3f3}
@page{margin:10mm}@media print{button{display:none}img{border:0;break-inside:avoid}body{padding:0}}
</style></head><body><button onclick="print()">Save as PDF</button>${parts.join("")}</body></html>`);
      win.document.close();
      win.focus();
      return "";
    } catch (error) {
      win.close();
      throw error;
    }
  }

  async function run(button, task) {
    const label = button.textContent;
    el.png.disabled = el.pdf.disabled = true;
    button.textContent = "Working…";
    try {
      const message = await task();
      if (message) pad.toast(message);
      if (message) setSheet(false);
    } catch (error) {
      pad.toast(error?.message || "Couldn't export");
    } finally {
      button.textContent = label;
      el.png.disabled = el.pdf.disabled = false;
    }
  }

  function setSheet(open) {
    el.sheet.hidden = !open;
    el.open.setAttribute("aria-expanded", String(open));
    el.open.setAttribute("aria-pressed", String(open));
    if (open) {
      document.getElementById("settings").hidden = true;
      document.getElementById("colorSheet").hidden = true;
      const box = extent(pad.strokes);
      const size = box ? `${Math.round(box.x1 - box.x0)} × ${Math.round(box.y1 - box.y0)}` : "";
      el.note.textContent = size
        ? `Everything you've written (${size} board units), not just what's on screen.`
        : "Nothing written yet. Gemini's problem, if any, is still exported.";
    }
  }

  el.open.addEventListener("click", () => setSheet(el.sheet.hidden));
  el.png.addEventListener("click", () => run(el.png, savePng));
  el.pdf.addEventListener("click", () => run(el.pdf, savePdf));
  pad.stage.addEventListener("pointerdown", () => setSheet(false), true);
  window.SkybridgeExport = { renderBoard, geminiPicture, savePng, savePdf };
})();
