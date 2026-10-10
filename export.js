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
    lumen: document.getElementById("exportLumenBtn"),
    openDrawing: document.getElementById("openDrawingBtn"),
    drawingFile: document.getElementById("drawingFile"),
    note: document.getElementById("exportNote"),
    pick: document.getElementById("lumenPick"),
    suggest: document.getElementById("lumenSuggest"),
    folders: document.getElementById("lumenFolders"),
    pickCancel: document.getElementById("lumenPickCancel"),
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

  function paint(target, width, height, scale, paper, dots, offsetX, offsetY, style = "dots", spacing = DOT_SPACING) {
    target.fillStyle = paper;
    target.fillRect(0, 0, width, height);
    if (!dots || style === "none") return;
    // The pattern sits on the same board grid as on screen.
    target.fillStyle = dots;
    const startX = Math.ceil(offsetX / spacing) * spacing;
    const startY = Math.ceil(offsetY / spacing) * spacing;
    if (style === "dots") {
      const radius = Math.max(1, 1.25 * scale);
      for (let y = startY; (y - offsetY) * scale < height; y += spacing) {
        for (let x = startX; (x - offsetX) * scale < width; x += spacing) {
          target.beginPath();
          target.arc((x - offsetX) * scale, (y - offsetY) * scale, radius, 0, Math.PI * 2);
          target.fill();
        }
      }
      return;
    }
    const thick = Math.max(1, scale);
    if (style === "square") {
      for (let x = startX; (x - offsetX) * scale < width; x += spacing) target.fillRect(Math.round((x - offsetX) * scale), 0, thick, height);
    }
    for (let y = startY; (y - offsetY) * scale < height; y += spacing) target.fillRect(0, Math.round((y - offsetY) * scale), width, thick);
  }

  // The writing on its own layer, so erasers only cut the writing, not the paper.
  function inkLayer(strokes, box, scale, width, height) {
    const layer = makeCanvas(width, height);
    const ctx = layer.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, -box.x0 * scale, -box.y0 * scale);
    // Photos go under the writing, which is on its own layer so an eraser stroke never cuts a photo.
    const photos = strokes.filter((stroke) => stroke.img);
    const ink = strokes.filter((stroke) => !stroke.img);
    const lay = (list) => (window.SkybridgeInk?.layered ? window.SkybridgeInk.layered(list) : list);
    photos.forEach((stroke) => pad.drawStroke(ctx, stroke));
    if (!photos.length) { lay(ink).forEach((stroke) => pad.drawStroke(ctx, stroke)); return layer; }
    const top = makeCanvas(width, height);
    const topCtx = top.getContext("2d");
    topCtx.setTransform(scale, 0, 0, scale, -box.x0 * scale, -box.y0 * scale);
    lay(ink).forEach((stroke) => pad.drawStroke(topCtx, stroke));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(top, 0, 0);
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
    const strokes = (options.strokes || pad.strokes).filter((stroke) => stroke.points.length && !stroke.help); // a pinned help sheet is for reading, not for checking or handing in
    await window.SkybridgeImages?.ensure(strokes); // photos from another page come from storage
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
    paint(ctx, out.width, out.height, scale, pad.cssColor("paper"), pad.settings.grid !== "none" ? pad.cssColor("grid") : "",
      (box ? box.x0 : 0) - (width - inkW) / 2, -cardH - (card && box ? GAP : 0), pad.settings.grid, pad.settings.gridSize);
    if (card) ctx.drawImage(card.image, MARGIN * scale, (MARGIN / 2) * scale, card.width * scale, card.height * scale);
    if (box) {
      const layer = inkLayer(strokes, box, scale, inkW * scale, inkH * scale);
      ctx.drawImage(layer, ((width - inkW) / 2) * scale, (cardH + (card ? GAP : 0)) * scale);
    }
    // Where a pixel of this picture sits on the board (to put a mark beside the writing it came from).
    const inkLeft = (width - inkW) / 2;
    const inkTop = cardH + (card ? GAP : 0);
    const toBoard = box ? (px, py) => [px / scale - inkLeft + box.x0, py / scale - inkTop + box.y0] : null;
    return { canvas: out, width, height, scale, toBoard };
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

  // ---------------------------------------------------------------------------
  // Lumen: a "Skybridge drawing" file (format skybridge-drawing, version 1) holds a
  // picture of the page for Lumen to show and the page itself (strokes, view, photos)
  // so the drawing can come back here unchanged. Lumen replaces, rather than copies,
  // a drawing it already has with the same id.
  // ---------------------------------------------------------------------------
  const DRAWING_FORMAT = "skybridge-drawing";
  const DRAWING_VERSION = 1;
  const books = () => window.SkybridgeNotebooks;

  async function share(file, title) {
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return true;
      } catch (error) {
        if (error?.name === "AbortError") return false;
      }
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  }

  // A sharp picture that still fits comfortably in a Lumen note (about 6 MB at most).
  const MAX_PREVIEW = 6e6;
  function previewOf(canvas) {
    let source = canvas;
    let data = canvas.toDataURL("image/png");
    while (data.length > MAX_PREVIEW && source.width > 800) {
      const smaller = makeCanvas(source.width * 0.75, source.height * 0.75);
      const ctx = smaller.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, 0, 0, smaller.width, smaller.height);
      source = smaller;
      data = source.toDataURL("image/png");
    }
    if (data.length > MAX_PREVIEW) data = source.toDataURL("image/jpeg", 0.9);
    return { data, width: source.width, height: source.height };
  }

  const fileStem = (title) => title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 60) || "drawing";

  async function drawingData() {
    await pad.flush?.();
    const id = books()?.current();
    const page = id ? await books().load(id) : null;
    const strokes = (page?.strokes || pad.strokes).filter((stroke) => stroke.points?.length);
    const { canvas } = await renderBoard({ strokes });
    const meta = page?.meta || { id: id || `board-${Date.now().toString(36)}`, name: "Skybridge board" };
    const pics = books() ? [...(await books().getPics(strokes.filter((stroke) => stroke.img).map((stroke) => stroke.img))).values()] : [];
    const title = meta.named ? meta.name : meta.title || meta.name || "Skybridge board";
    const drawing = {
      format: DRAWING_FORMAT,
      version: DRAWING_VERSION,
      id: meta.id,
      title,
      app: "skybridge",
      exportedAt: Date.now(),
      preview: previewOf(canvas),
      board: {
        meta,
        strokes,
        view: page?.view || { x: 0, y: 0, zoom: 1 },
        paper: { color: pad.cssColor("paper"), grid: pad.settings.grid, gridSize: pad.settings.gridSize },
      },
      pictures: pics,
    };
    const name = `${fileStem(title)}.skybridge.json`;
    return { name, drawing, canvas };
  }

  async function drawingFile() {
    const { name, drawing } = await drawingData();
    return new File([JSON.stringify(drawing)], name, { type: "application/json" });
  }

  // With the PC connected, its Skybridge server writes the drawing into Lumen's inbox folder
  // and Lumen files it. Otherwise the share sheet saves it, for example to a Google Drive
  // folder that Lumen checks on the PC.
  const waiting = new Map();
  function viaPc(name, drawing, size) {
    const relay = pad.relay;
    // The PC link carries up to 16 MB in one message; bigger drawings go through the share sheet.
    if (!relay?.ready() || size > 15e6) return null;
    const id = Math.random().toString(36).slice(2, 10);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        resolve({ ok: false, error: "Your PC didn't answer." });
      }, 30000);
      waiting.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      relay.send({ t: "lumen", id, name, drawing });
    });
  }

  function onRelay(message) {
    const done = waiting.get(message.id);
    if (!done) return;
    waiting.delete(message.id);
    done(message);
  }

  // Lumen's folders, as Lumen last listed them in its inbox. Kept here, so the picker also
  // works when the PC is off (the drawing then goes to the matching Google Drive folder).
  const FOLDERS_KEY = "skybridge.lumenFolders";
  const cachedFolders = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(FOLDERS_KEY) || "[]");
      return Array.isArray(saved) ? saved.filter((path) => typeof path === "string") : [];
    } catch {
      return [];
    }
  };
  async function lumenFolders() {
    const relay = pad.relay;
    if (relay?.ready()) {
      const id = Math.random().toString(36).slice(2, 10);
      const answer = await new Promise((resolve) => {
        const timer = setTimeout(() => { waiting.delete(id); resolve(null); }, 4000);
        waiting.set(id, (message) => { clearTimeout(timer); resolve(message); });
        relay.send({ t: "lumen-folders", id });
      });
      if (answer?.ok && Array.isArray(answer.folders)) {
        const folders = answer.folders.filter((path) => typeof path === "string").slice(0, 500);
        try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders)); } catch {}
        return folders;
      }
    }
    return cachedFolders();
  }

  // A small picture for the folder suggestion, as the page namer uses.
  function smallPicture(canvas, side = 768) {
    const scale = Math.min(1, side / Math.max(canvas.width, canvas.height));
    const out = makeCanvas(canvas.width * scale, canvas.height * scale);
    out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height);
    return out.toDataURL("image/png").split(",")[1];
  }

  // Lists Lumen's folders with Gemini's pick first once it answers. Resolves with the
  // chosen path ("" for no folder, Lumen's Skybridge folder) and Gemini's name and tags
  // for the page if they came in time, or with null when cancelled.
  function chooseFolder(folders, drawing, canvas) {
    const AI = window.SkybridgeAI;
    let suggested = "";
    let labels = null;
    const draw = () => {
      const order = suggested ? [suggested, ...folders.filter((path) => path !== suggested)] : folders;
      el.folders.replaceChildren(
        ...[...order, ""].map((path) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `tool wide${path && path === suggested ? " suggested" : ""}`;
          button.dataset.folder = path;
          button.setAttribute("role", "listitem");
          button.textContent = path ? path.split("/").join(" › ") : "No folder (Skybridge)";
          if (path && path === suggested) {
            const tag = document.createElement("small");
            tag.textContent = "Suggested";
            button.append(tag);
          }
          return button;
        }),
      );
    };
    draw();
    el.sheet.classList.add("picking");
    el.pick.hidden = false;
    el.suggest.textContent = AI?.hasKey() ? "Asking Gemini where it fits…" : "Choose where it goes in Lumen.";
    let open = true;
    if (AI?.hasKey()) {
      AI.suggestFolder(smallPicture(canvas), { title: drawing.title, tags: drawing.board?.meta?.tags || [] }, folders)
        .then((answer) => {
          if (!open) return;
          suggested = answer.folder;
          labels = answer;
          el.suggest.textContent = suggested
            ? `Suggested: ${suggested.split("/").join(" › ")}${answer.why ? `. ${answer.why}` : ""}`
            : "No folder stood out. Choose one, or send it without a folder.";
          draw();
        })
        .catch((error) => {
          if (open) el.suggest.textContent = `No suggestion (${AI.explain?.(error) || "Gemini didn't answer"}). Choose a folder.`;
        });
    }
    return new Promise((resolve) => {
      const finish = (value) => {
        open = false;
        el.folders.removeEventListener("click", onPick);
        el.pickCancel.removeEventListener("click", onCancel);
        el.sheet.classList.remove("picking");
        el.pick.hidden = true;
        resolve(value === null ? null : { folder: value, labels });
      };
      const onPick = (event) => {
        const button = event.target.closest("button[data-folder]");
        if (button) finish(button.dataset.folder);
      };
      const onCancel = () => finish(null);
      el.folders.addEventListener("click", onPick);
      el.pickCancel.addEventListener("click", onCancel);
    });
  }

  async function sendToLumen() {
    const data = await drawingData();
    const { drawing, canvas } = data;
    let { name } = data;
    const folders = await lumenFolders();
    if (folders.length) {
      const chosen = await chooseFolder(folders, drawing, canvas);
      if (chosen === null) return "";
      if (chosen.folder) drawing.folder = chosen.folder;
      const meta = drawing.board?.meta || {};
      // A page you named, or one the page namer already read, keeps its name.
      if (chosen.labels?.title && !meta.named && !meta.title) {
        drawing.title = chosen.labels.title;
        name = `${fileStem(drawing.title)}.skybridge.json`;
      }
      if (!meta.tags?.length && chosen.labels?.tags?.length) drawing.tags = chosen.labels.tags;
    }
    const tags = drawing.board?.meta?.tags;
    if (Array.isArray(tags) && tags.length) drawing.tags = tags.slice(0, 12);
    const text = JSON.stringify(drawing);
    const file = new File([text], name, { type: "application/json" });
    const where = drawing.folder ? `Lumen Inbox › ${drawing.folder.split("/").join(" › ")}` : "Lumen Inbox";
    const sent = viaPc(name, drawing, text.length);
    if (sent) {
      const result = await sent;
      if (result.ok) return result.message || "Sent to Lumen on your PC";
      pad.toast(`${result.error || "Couldn't reach Lumen on your PC."} Save it to ${where} in Google Drive instead?`, {
        label: "Save",
        run: () => void share(file, "Send to Lumen"),
      });
      return "";
    }
    // Shown while the share sheet is open. The tap on a folder above lets the sheet open.
    pad.toast(`To reach Lumen with your PC off, save it in Google Drive › ${where}`);
    return (await share(file, "Send to Lumen")) ? "Saved for Lumen" : "";
  }

  // A drawing that went to Lumen comes back as the same notebook page, replacing the
  // copy here if there is one, then opens.
  async function openDrawing(file) {
    if (!file) return "";
    let drawing;
    try {
      drawing = JSON.parse(await file.text());
    } catch {
      throw new Error("That file isn't a drawing. In Lumen, use Save for Skybridge Board on the drawing.");
    }
    if (drawing?.format !== DRAWING_FORMAT || drawing.version !== DRAWING_VERSION) throw new Error("That file isn't a Skybridge drawing.");
    const board = drawing.board;
    if (!board || !Array.isArray(board.strokes) || !board.meta?.id) throw new Error("This drawing is a picture only. Add it with Photo instead.");
    if (!books()) throw new Error("Notebooks aren't available here.");
    await pad.flush?.();
    await books().restore({
      meta: { ...board.meta, updated: Date.now(), unsynced: true },
      strokes: board.strokes,
      view: board.view || { x: 0, y: 0, zoom: 1 },
      pics: Array.isArray(drawing.pictures) ? drawing.pictures : [],
    });
    books().setCurrent(board.meta.id);
    location.reload();
    return "";
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


  // ---------------------------------------------------------------------------
  // A homework folder: every page in problem order, as one combined PDF or as photos.
  // ---------------------------------------------------------------------------
  async function folderPages(folderId) {
    const Notebooks = window.SkybridgeNotebooks;
    const pages = await Notebooks.pagesOf(folderId);
    const out = [];
    for (const meta of pages) {
      const found = await Notebooks.load(meta.id);
      if (!found) continue;
      let strokes = found.strokes.filter((stroke) => stroke.points?.length);
      const problem = found.meta.problem;
      // A problem that was never pinned isn't on the paper yet: write it above the work for the hand-in.
      if (problem && !problem.pinned && !strokes.some((stroke) => stroke.pin)) {
        const box = extent(strokes);
        const made = await pad.pinnedStrokes(problem, 0, 0);
        const top = extent(made);
        if (top) {
          const dx = (box ? box.x0 : 0) - top.x0;
          const dy = (box ? box.y0 : 0) - top.y1 - GAP;
          const moved = made.map((stroke) => ({ ...stroke, points: stroke.points.map(([x, y]) => [x + dx, y + dy]) }));
          strokes = [...moved, ...strokes];
        }
      }
      if (!strokes.length) continue;
      const { canvas } = await renderBoard({ strokes, withCard: false });
      out.push({ meta, canvas });
    }
    return out;
  }

  async function exportFolder(folderId, kind) {
    const Notebooks = window.SkybridgeNotebooks;
    const folder = (await Notebooks.listFolders()).find((item) => item.id === folderId);
    if (!folder) throw new Error("That folder is gone.");
    const total = (await Notebooks.pagesOf(folderId)).length;
    // Open the window first: browsers only allow it straight after the tap.
    const win = kind === "pdf" ? window.open("", "skybridge-export") : null;
    if (kind === "pdf" && !win) throw new Error("Allow pop-ups for this page, then try again.");
    win?.document.write("<!doctype html><title>Exporting…</title><body style='font:16px sans-serif;padding:24px'>Putting the pages together…</body>");
    try {
      const pages = await folderPages(folderId);
      if (!pages.length) throw new Error("No page in this folder has anything on it yet.");
      const skipped = total - pages.length;
      const note = skipped ? ` (${skipped} empty ${skipped === 1 ? "page" : "pages"} left out)` : "";
      if (kind === "pdf") {
        const title = folder.name.replace(/[<>&]/g, "");
        win.document.open();
        win.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{margin:0;padding:16px;font:16px -apple-system,sans-serif;background:#fff;color:#111}
img{display:block;width:100%;height:auto;margin:0 0 12px;border:1px solid #ccc}
button{font:inherit;padding:10px 16px;margin:0 0 12px;border-radius:10px;border:1px solid #888;background:#f3f3f3}
@page{margin:10mm}
@media print{button{display:none}body{padding:0}img{border:0;margin:0;width:auto;max-width:100%;max-height:270mm;object-fit:contain;break-after:page;break-inside:avoid}img:last-of-type{break-after:auto}}
</style></head><body><button onclick="print()">Save as PDF</button>${pages.map(({ meta, canvas }) => `<img src="${canvas.toDataURL("image/png")}" alt="${meta.name.replace(/["<>&]/g, "")}">`).join("")}</body></html>`);
        win.document.close();
        win.focus();
        return `Tap Save as PDF in the new window${note}`;
      }
      const files = [];
      for (const { meta, canvas } of pages) {
        files.push(new File([await toBlob(canvas)], `${folder.name} - ${meta.name.replace(folder.name, "").trim() || meta.name}.png`.replace(/[\\/:*?"<>|]+/g, "-"), { type: "image/png" }));
      }
      if (navigator.canShare?.({ files })) {
        try {
          await navigator.share({ files, title: folder.name });
          return `Saved ${files.length} photos${note}`;
        } catch (error) {
          if (error?.name === "AbortError") return "";
        }
      }
      for (const file of files) {
        const url = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return `Saved ${files.length} photos${note}`;
    } catch (error) {
      win?.close();
      throw error;
    }
  }

  async function run(button, task) {
    const label = button.textContent;
    el.png.disabled = el.pdf.disabled = el.lumen.disabled = el.openDrawing.disabled = true;
    button.textContent = "Working…";
    try {
      const message = await task();
      if (message) pad.toast(message);
      if (message) setSheet(false);
    } catch (error) {
      pad.toast(error?.message || "Couldn't export");
    } finally {
      button.textContent = label;
      el.png.disabled = el.pdf.disabled = el.lumen.disabled = el.openDrawing.disabled = false;
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
  el.lumen.addEventListener("click", () => run(el.lumen, sendToLumen));
  el.openDrawing.addEventListener("click", () => el.drawingFile.click());
  el.drawingFile.addEventListener("change", () => {
    const file = el.drawingFile.files?.[0];
    el.drawingFile.value = "";
    run(el.openDrawing, () => openDrawing(file));
  });
  pad.stage.addEventListener("pointerdown", () => setSheet(false), true);
  window.SkybridgeExport = { renderBoard, geminiPicture, savePng, savePdf, exportFolder, folderPages, drawingFile, sendToLumen, openDrawing, onRelay };
})();
