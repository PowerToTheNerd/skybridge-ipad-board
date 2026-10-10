/* Skybridge iPad board: draw with Apple Pencil, and every stroke streams to
 * My board on the PC through the relay in backend/ipad_board.py.
 * Points are in board coordinates: CSS pixels at 100% zoom, independent of where
 * the board has been moved or pinch-zoomed to. The PC shows the same part of the
 * board as the iPad.
 *
 * Gemini's board can be shown too, alone or side by side with this one. The PC
 * relays the steps Gemini draws and the PC's own whiteboard.js renders them here.
 */
(() => {
  "use strict";

  const CODE_KEY = "skybridge.padCode";
  const SETTINGS_KEY = "skybridge.padSettings";
  const HOST_KEY = "skybridge.padHost";
  const PAPERS = {
    night: "Night green",
    black: "Charcoal",
    slate: "Slate blue",
    chalk: "Chalkboard",
    white: "Soft white",
    cream: "Cream",
    custom: "Your paper",
  };
  // App colour: four looks and one of your own. Every bar, panel and menu follows it; the ink and
  // the paper keep their own colours.
  const THEMES = { black: "Black", white: "White", green: "Green", purple: "Purple", custom: "Your colour" };
  const THEME_HUES = { black: 210, white: 215, green: 156, purple: 265 };
  const DEFAULTS = { width: 2.6, pressure: 100, smooth: 80, tidy: true, eraser: 26, sv: 2, pen: "ink", recent: [], palette: [], rail: true, paper: "night", theme: "green", accent: "#7c5cd6", paperColor: "#2d3b57", fxs: {}, card: {}, page: "pen", finger: "move", grid: "dots", gridSize: 24, grain: true, layout: "mine" };
  const LAYOUTS = ["mine", "both", "gemini"];

  const el = {
    stage: document.getElementById("stage"),
    canvas: document.getElementById("canvas"),
    status: document.getElementById("status"),
    statusText: document.getElementById("statusText"),
    undo: document.getElementById("undoBtn"),
    redo: document.getElementById("redoBtn"),
    lassoBox: document.getElementById("lassoBox"),
    lassoBar: document.getElementById("lassoBar"),
    lassoColor: document.getElementById("lassoColor"),
    lassoDelete: document.getElementById("lassoDelete"),
    lassoBrackets: document.getElementById("lassoBrackets"),
    lassoTextTools: document.getElementById("lassoTextTools"),
    lassoSizeDown: document.getElementById("lassoSizeDown"),
    lassoSizeUp: document.getElementById("lassoSizeUp"),
    lassoBold: document.getElementById("lassoBold"),
    bgReads: document.getElementById("bgReads"),
    updateApp: document.getElementById("updateApp"),
    lassoDuplicate: document.getElementById("lassoDuplicate"),
    lassoText: document.getElementById("lassoText"),
    textSheet: document.getElementById("textSheet"),
    textOut: document.getElementById("textOut"),
    textCopy: document.getElementById("textCopy"),
    textPlace: document.getElementById("textPlace"),
    lassoEdit: document.getElementById("lassoEdit"),
    textClose: document.getElementById("textClose"),
    lassoDone: document.getElementById("lassoDone"),
    lassoEnds: [...document.querySelectorAll(".lasso-end")],
    tools: [...document.querySelectorAll("[data-tool]")],
    clear: document.getElementById("clearBtn"),
    settingsBtn: document.getElementById("settingsBtn"),
    settings: document.getElementById("settings"),
    widthInput: document.getElementById("widthInput"),
    widthOut: document.getElementById("widthOut"),
    pressureInput: document.getElementById("pressureInput"),
    pressureOut: document.getElementById("pressureOut"),
    smoothInput: document.getElementById("smoothInput"),
    smoothOut: document.getElementById("smoothOut"),
    tidy: document.getElementById("tidyBtn"),
    preview: document.getElementById("preview"),
    papers: document.getElementById("papers"),
    themes: document.getElementById("themes"),
    labBtn: document.getElementById("labBtn"),
    labList: document.getElementById("labList"),
    cardFont: document.getElementById("cardFont"),
    cardSize: document.getElementById("cardSize"),
    cardTitle: document.getElementById("cardTitle"),
    cardText: document.getElementById("cardText"),
    cardAnchor: document.getElementById("cardAnchor"),
    pinWeight: document.getElementById("pinWeight"),
    pinInk: document.getElementById("pinInk"),
    pinPreview: document.getElementById("pinPreview"),
    pinRestyle: document.getElementById("pinRestyle"),
    paperPicker: document.getElementById("paperPicker"),
    paperSV: document.getElementById("paperSV"),
    paperSVKnob: document.getElementById("paperSVKnob"),
    paperHue: document.getElementById("paperHue"),
    paperHueKnob: document.getElementById("paperHueKnob"),
    paperChip: document.getElementById("paperChip"),
    hoverGlow: document.getElementById("hoverGlow"),
    wetCanvas: document.getElementById("wetCanvas"),
    themePicker: document.getElementById("themePicker"),
    themeSV: document.getElementById("themeSV"),
    themeSVKnob: document.getElementById("themeSVKnob"),
    themeHue: document.getElementById("themeHue"),
    themeHueKnob: document.getElementById("themeHueKnob"),
    themeChip: document.getElementById("themeChip"),
    pages: document.getElementById("settingsPages"),
    tabs: document.querySelectorAll("#settingsTabs [data-page]"),
    fingerModes: [...document.querySelectorAll("[data-finger]")],
    recenter: document.getElementById("recenterBtn"),
    gridStyles: [...document.querySelectorAll("#gridStyles [data-grid]")],
    gridSizeInput: document.getElementById("gridSizeInput"),
    gridSizeOut: document.getElementById("gridSizeOut"),
    gridSizeRow: document.getElementById("gridSizeRow"),
    grain: document.getElementById("grainBtn"),
    send: document.getElementById("sendBtn"),
    check: document.getElementById("checkBtn"),
    verdict: document.getElementById("verdict"),
    verdictTitle: document.getElementById("verdictTitle"),
    verdictText: document.getElementById("verdictText"),
    verdictClose: document.getElementById("verdictClose"),
    verdictCancel: document.getElementById("verdictCancel"),
    localFast: document.getElementById("localFast"),
    liveControls: document.getElementById("liveControls"),
    mute: document.getElementById("muteBtn"),
    done: document.getElementById("doneBtn"),
    notebookBtn: document.getElementById("notebookBtn"),
    notebookName: document.getElementById("notebookName"),
    notebookSheet: document.getElementById("notebookSheet"),
    nbPages: document.getElementById("nbPages"),
    nbTabs: document.querySelectorAll("#nbTabs [data-page]"),
    usageList: document.getElementById("usageList"),
    usageNote: document.getElementById("usageNote"),
    liveOut: document.getElementById("liveOut"),
    engineSeg: document.getElementById("engineSeg"),
    engineHint: document.getElementById("engineHint"),
    engineTable: document.getElementById("engineTable"),
    liveOn: document.getElementById("liveOn"),
    liveModel: document.getElementById("liveModel"),
    liveCheck: document.getElementById("liveCheck"),
    liveCheckRead: document.getElementById("liveCheckRead"),
    liveThinking: document.getElementById("liveThinking"),
    liveThinkingRow: document.getElementById("liveThinkingRow"),
    liveTest: document.getElementById("liveTest"),
    liveResult: document.getElementById("liveResult"),
    localOut: document.getElementById("localOut"),
    localUrl: document.getElementById("localUrl"),
    localKey: document.getElementById("localKey"),
    localModel: document.getElementById("localModel"),
    localVision: document.getElementById("localVision"),
    localVia: document.getElementById("localVia"),
    localRoute: document.getElementById("localRoute"),
    localTest: document.getElementById("localTest"),
    localResult: document.getElementById("localResult"),
    localRemove: document.getElementById("localRemove"),
    localPair: document.getElementById("localPair"),
    syncFold: document.getElementById("syncFold"),
    notebookList: document.getElementById("notebookList"),
    notebookNew: document.getElementById("notebookNew"),
    syncOut: document.getElementById("syncOut"),
    syncNote: document.getElementById("syncNote"),
    notebookSearch: document.getElementById("notebookSearch"),
    geminiKey: document.getElementById("geminiKey"),
    geminiKeyRemove: document.getElementById("geminiKeyRemove"),
    smartOut: document.getElementById("smartOut"),
    smartNote: document.getElementById("smartNote"),
    smartNow: document.getElementById("smartNow"),
    practiceTopic: document.getElementById("practiceTopic"),
    practiceWhere: document.getElementById("practiceWhere"),
    practiceGo: document.getElementById("practiceGo"),
    practiceOut: document.getElementById("practiceOut"),
    syncHost: document.getElementById("syncHost"),
    syncCode: document.getElementById("syncCode"),
    syncCodeRow: document.getElementById("syncCodeRow"),
    syncRetry: document.getElementById("syncRetry"),
    installNote: document.getElementById("installNote"),
    offlineHide: document.getElementById("offlineHide"),
    gateClose: document.getElementById("gateClose"),
    offline: document.getElementById("offline"),
    offlineHost: document.getElementById("offlineHost"),
    retry: document.getElementById("retryBtn"),
    toast: document.getElementById("toast"),
    gate: document.getElementById("gate"),
    gateTitle: document.getElementById("gateTitle"),
    gateText: document.getElementById("gateText"),
    pens: [...document.querySelectorAll("[data-pen]")],
    colorBtn: document.getElementById("colorBtn"),
    colorDot: document.getElementById("colorDot"),
    colorSheet: document.getElementById("colorSheet"),
    colorGrid: document.getElementById("colorGrid"),
    hsvSV: document.getElementById("hsvSV"),
    hsvSVKnob: document.getElementById("hsvSVKnob"),
    hsvHue: document.getElementById("hsvHue"),
    hsvHueKnob: document.getElementById("hsvHueKnob"),
    hsvChip: document.getElementById("hsvChip"),
    hsvHex: document.getElementById("hsvHex"),
    hsvRecent: document.getElementById("hsvRecent"),
    palette: document.getElementById("palette"),
    paletteNote: document.getElementById("paletteNote"),
    eraserInput: document.getElementById("eraserInput"),
    eraserOut: document.getElementById("eraserOut"),
    rail: document.getElementById("rail"),
    railToggle: document.getElementById("railToggle"),
    zoomPill: document.getElementById("zoomPill"),
    newPageBtn: document.getElementById("newPageBtn"),
    layouts: [...document.querySelectorAll(".layouts [data-layout]")],
    geminiBoard: document.getElementById("whiteboardBoard"),
    geminiPane: document.getElementById("whiteboardCard"),
    geminiBadge: document.getElementById("geminiBadge"),
  };
  const ctx = el.canvas.getContext("2d");

  // ---------------------------------------------------------------------------
  // Pairing code: from the QR link, then remembered for Home Screen launches.
  // ---------------------------------------------------------------------------
  function storage(action, key, value) {
    try {
      if (action === "get") return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch {}
    return null;
  }
  const params = new URLSearchParams(location.search);
  let code = params.get("code") || storage("get", CODE_KEY) || "";
  if (params.get("code")) storage("set", CODE_KEY, code);
  // Where the PC relay is. Normally the address this page came from; it can be changed if the PC's address does.
  let host = storage("get", HOST_KEY) || "";
  // Hosted as a plain static site (no PC relay at this address): the board works on its own, and is
  // paired by typing the PC's address and code. The static build marks the page with this tag.
  const hosted = Boolean(document.querySelector('meta[name="skybridge-hosted"]'));

  // Pen and paper settings, kept on this iPad.
  const settings = { ...DEFAULTS };
  try { Object.assign(settings, JSON.parse(storage("get", SETTINGS_KEY) || "{}")); } catch {}
  if (!(settings.paper in PAPERS)) settings.paper = DEFAULTS.paper;
  const PAGES = ["pen", "paper", "card", "lab"];
  if (!PAGES.includes(settings.page)) settings.page = "pen";
  if (!/^#[0-9a-f]{6}$/i.test(settings.paperColor)) settings.paperColor = DEFAULTS.paperColor;
  // Experimental effects, all off until switched on. (The first one used to be a single "fx" switch.)
  if (settings.fx === true && settings.fxs?.light === undefined) settings.fxs = { ...(settings.fxs || {}), light: true };
  settings.fxs = settings.fxs && typeof settings.fxs === "object" ? settings.fxs : {};
  // How a problem card looks and where it sits (Pen & paper > Card).
  const CARD_DEFAULTS = { font: "inter", size: "l", title: "auto", text: "auto", anchor: "tl" };
  const PIN_DEFAULTS = { v: 4, weight: 1, ink: "ink" }; // font, size and colours come from the Card settings
  settings.pin = settings.pin && settings.pin.v === PIN_DEFAULTS.v ? { ...PIN_DEFAULTS, ...settings.pin } : { ...PIN_DEFAULTS }; // older looks are replaced once
  settings.card = { ...CARD_DEFAULTS, ...(settings.card && typeof settings.card === "object" ? settings.card : {}) };
  if (!(settings.theme in THEMES)) settings.theme = DEFAULTS.theme; // the older Auto and fixed colours come back as green
  if (!/^#[0-9a-f]{6}$/i.test(settings.accent)) settings.accent = DEFAULTS.accent;
  // The pattern used to be on or off; now it is blank, dots, a square grid or lined.
  const GRIDS = ["none", "dots", "square", "lined"];
  if (settings.grid === true) settings.grid = "dots";
  else if (settings.grid === false) settings.grid = "none";
  if (!GRIDS.includes(settings.grid)) settings.grid = DEFAULTS.grid;
  settings.gridSize = Math.min(48, Math.max(12, Number(settings.gridSize) || DEFAULTS.gridSize));
  if (!LAYOUTS.includes(settings.layout)) settings.layout = DEFAULTS.layout;
  // Smoothing and tidy got stronger defaults; settings saved before that start over on them.
  if (settings.sv !== DEFAULTS.sv) Object.assign(settings, { smooth: DEFAULTS.smooth, tidy: DEFAULTS.tidy, sv: DEFAULTS.sv });
  if (!Array.isArray(settings.recent)) settings.recent = [];
  // The palette at the bottom left holds the colours kept on purpose (it replaces the earlier "Saved" row).
  const PALETTE_START = ["ink", "#e5484d", "#f5a524", "#3fb950", "#3b82f6", "#a371f7"];
  const PALETTE_MIN = 2;
  const PALETTE_MAX = 12;
  if (!Array.isArray(settings.palette)) settings.palette = [];
  if (!settings.palette.length) {
    const kept = Array.isArray(settings.saved) ? settings.saved.filter((hex) => /^#[0-9a-f]{6}$/i.test(hex)) : [];
    settings.palette = [...kept, ...PALETTE_START.filter((c) => !kept.includes(c))].slice(0, Math.max(6, kept.length)).slice(0, PALETTE_MAX);
  }
  delete settings.saved;
  function saveSettings() {
    storage("set", SETTINGS_KEY, JSON.stringify(settings));
  }

  // Which part of the board is on screen: its top-left corner in board coordinates,
  // and the zoom. One finger moves it; two fingers also pinch to zoom.
  const view = { x: 0, y: 0, zoom: 1 };
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 4;

  // ---------------------------------------------------------------------------
  // Strokes and rendering. Finished strokes live on a cached layer so a long
  // page of working stays smooth; only strokes in progress are redrawn.
  // ---------------------------------------------------------------------------
  const strokes = []; // the open notebook's My board page, oldest first
  let nb = null; // the open notebook's details (see Notebooks below)
  const live = new Set(); // ids of strokes still being drawn (here or on another iPad)
  const geminiInk = []; // the user's writing on Gemini's board, in the PC board's coordinates
  let lastBoard = "mine"; // which board was written on last, for Undo, Clear and Send
  // Undo and redo steps per board (see "Undo and redo" below).
  const hist = { mine: { undo: [], redo: [] }, gemini: { undo: [], redo: [] } };
  const lasso = { path: null, pointer: null, selected: [] };
  let guides = []; // alignment lines shown while dragging: { x|y, from, to } in board coordinates
  let checking = false; // Check my work is running on the PC
  const base = document.createElement("canvas");
  const baseCtx = base.getContext("2d");
  let ratio = 1;
  let frame = 0;

  // While the Pencil is down, the browser's guess at the next few points is drawn as a short tail,
  // replaced by the real points as they arrive. It is only drawn: never stored or sent.
  const withTail = (stroke) => (stroke.tail?.length ? { ...stroke, points: [...stroke.points, ...stroke.tail], done: false } : stroke);
  const PREDICTED_POINTS = 2;
  function predictedTail(event, convert, stroke) {
    if (stroke.eraser || stroke.hl || event.pointerType !== "pen") return null;
    const guess = event.getPredictedEvents?.(); // not in every browser: no guess, no tail
    return guess?.length ? guess.slice(0, PREDICTED_POINTS).map(convert) : null;
  }

  const layered = (list) => (window.SkybridgeInk?.layered ? window.SkybridgeInk.layered(list) : list);

  function cssColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim() || "#e3ece6";
  }

  // Fixed palette colours are nudged only as far as needed to read on this paper; the
  // paper-following pens (ink and the three marks) already do.
  function strokeColor(name) {
    const Ink = window.SkybridgeInk;
    return Ink?.isHex(name) ? Ink.colorOn(name, cssColor("paper")) : cssColor(name);
  }

  // Typed text on the page (a "Place on page" from To text): a stroke with a `text`, whose two points
  // are the corners of its box. The font size comes from the box height, so a corner resize scales it.
  const TEXT_FAMILIES = {
    hand: '"Virgil", "Segoe Print", "Comic Sans MS", cursive',
    roboto: '"Skybridge Roboto", Roboto, "Segoe UI", sans-serif',
    inter: '"Skybridge Inter", Inter, "Segoe UI", sans-serif',
    jetbrains: '"Skybridge JetBrains Mono", "JetBrains Mono", Consolas, monospace',
  };
  const TEXT_LINE = 1.3;
  const measurer = document.createElement("canvas").getContext("2d");
  function textBox(text, size, font) {
    const lines = String(text).split("\n");
    measurer.font = `${size}px ${TEXT_FAMILIES[font] || TEXT_FAMILIES.hand}`;
    const width = Math.max(size, ...lines.map((line) => measurer.measureText(line).width));
    return { width, height: lines.length * size * TEXT_LINE };
  }
  function drawText(target, stroke) {
    const [[x0, y0], [x1, y1]] = stroke.points;
    const lines = String(stroke.text).split("\n");
    const size = Math.abs(y1 - y0) / lines.length / TEXT_LINE;
    if (!(size > 0.5)) return;
    const family = TEXT_FAMILIES[stroke.font] || TEXT_FAMILIES.hand;
    target.save();
    target.font = `${size}px ${family}`;
    target.fillStyle = strokeColor(stroke.color);
    target.textBaseline = "alphabetic";
    const thick = Number.isInteger(stroke.weight) && stroke.weight > 0 ? size * 0.03 * stroke.weight : 0; // heavier writing: an outline in the same colour
    if (thick) { target.strokeStyle = target.fillStyle; target.lineWidth = thick; target.lineJoin = "round"; }
    const widest = Math.max(1, ...lines.map((line) => target.measureText(line).width));
    target.translate(Math.min(x0, x1), Math.min(y0, y1));
    target.scale(Math.max(0.2, Math.min(4, Math.abs(x1 - x0) / widest)), 1);
    lines.forEach((line, i) => {
      target.fillText(line, 0, (i * TEXT_LINE + 1) * size);
      if (thick) target.strokeText(line, 0, (i * TEXT_LINE + 1) * size);
    });
    target.restore();
  }

  function drawStroke(target, stroke) {
    const points = stroke.points;
    if (!points.length) return;
    if (stroke.text && points.length >= 2) { drawText(target, stroke); return; }
    target.save();
    target.globalCompositeOperation = stroke.eraser ? "destination-out" : "source-over";
    target.strokeStyle = stroke.eraser ? "#000" : strokeColor(stroke.color);
    target.fillStyle = target.strokeStyle;
    target.lineCap = "round";
    target.lineJoin = "round";
    target.lineWidth = stroke.width;
    // Pen strokes use Excalidraw's freehand look with Pencil pressure (inkstroke.js).
    if (!stroke.eraser && window.SkybridgeInk?.fill(target, stroke)) {
      target.restore();
      return;
    }
    if (points.length === 1) {
      target.beginPath();
      target.arc(points[0][0], points[0][1], stroke.width / 2, 0, Math.PI * 2);
      target.fill();
      target.restore();
      return;
    }
    target.beginPath();
    target.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length - 1; i += 1) {
      const [x, y] = points[i];
      const [nx, ny] = points[i + 1];
      target.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }
    const last = points[points.length - 1];
    target.lineTo(last[0], last[1]);
    target.stroke();
    target.restore();
  }

  function toScreen(target) {
    const scale = ratio * view.zoom;
    target.setTransform(scale, 0, 0, scale, -view.x * scale, -view.y * scale);
  }

  function rebuildBase() {
    baseCtx.setTransform(1, 0, 0, 1, 0, 0);
    baseCtx.clearRect(0, 0, base.width, base.height);
    toScreen(baseCtx);
    // Highlighters sit under the ink, whenever they were drawn.
    layered(strokes).forEach((stroke) => { if (!live.has(stroke.id)) drawStroke(baseCtx, stroke); });
  }

  function paint() {
    frame = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
    ctx.drawImage(base, 0, 0);
    toScreen(ctx);
    strokes.forEach((stroke) => { if (live.has(stroke.id)) drawStroke(ctx, withTail(stroke)); });
    if (lasso.path && lasso.path.length > 1) {
      ctx.save();
      ctx.setLineDash([6 / view.zoom, 5 / view.zoom]);
      ctx.lineWidth = 1.8 / view.zoom;
      ctx.lineJoin = "round";
      ctx.strokeStyle = cssColor("accent");
      ctx.beginPath();
      lasso.path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.restore();
    }
    if (guides.length) {
      ctx.save();
      ctx.lineWidth = 1.4 / view.zoom;
      ctx.setLineDash([5 / view.zoom, 4 / view.zoom]);
      ctx.strokeStyle = "#ff4fa3";
      ctx.beginPath();
      for (const g of guides) {
        if (g.x !== undefined) { ctx.moveTo(g.x, g.from); ctx.lineTo(g.x, g.to); }
        else { ctx.moveTo(g.from, g.y); ctx.lineTo(g.to, g.y); }
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  function schedulePaint() {
    if (!frame) frame = requestAnimationFrame(paint);
  }

  function finish(id) {
    if (!live.delete(id)) return;
    const stroke = strokes.find((item) => item.id === id);
    if (stroke) stroke.done = true;
    // Strokes finish in order almost always; when one overtakes another, rebuild to keep layering right.
    if (stroke && !stroke.hl && strokes[strokes.length - 1] === stroke && live.size === 0) {
      toScreen(baseCtx);
      drawStroke(baseCtx, stroke);
    } else {
      rebuildBase();
    }
    schedulePaint();
    updateButtons();
  }

  function resize() {
    ratio = window.devicePixelRatio || 1;
    const { width, height } = el.stage.getBoundingClientRect();
    for (const target of [el.canvas, base]) {
      target.width = Math.round(width * ratio);
      target.height = Math.round(height * ratio);
    }
    rebuildBase();
    paint();
    sendView();
  }

  function hasInk() {
    return strokes.some((stroke) => !stroke.eraser);
  }

  // Undo, Clear and Send act on the board in view; with both in view, on the one written on last.
  function activeBoard() {
    return settings.layout === "both" ? lastBoard : settings.layout;
  }

  function updateButtons() {
    const gemini = activeBoard() === "gemini";
    const list = gemini ? geminiInk : strokes;
    const steps = hist[gemini ? "gemini" : "mine"];
    el.undo.disabled = list.length === 0 && steps.undo.length === 0;
    el.redo.disabled = steps.redo.length === 0;
    el.clear.disabled = list.length === 0;
    el.send.disabled = !(gemini ? hasGeminiInk() : hasInk()) || !connected;
    el.check.disabled = checking || !hasInk();
    el.geminiBoard.classList.toggle("has-user-ink", hasGeminiInk());
  }

  // ---------------------------------------------------------------------------
  // Connection to the PC relay
  // ---------------------------------------------------------------------------
  let socket = null;
  let connected = false;
  let pcOpen = false;
  let retry = 0;
  const outbox = []; // events drawn while offline, replayed after reconnecting

  function setStatus(state, text) {
    el.status.dataset.state = state;
    el.statusText.textContent = text;
    el.status.title = text;
  }

  function showGate(title, text) {
    el.gateTitle.textContent = title;
    el.gateText.textContent = text;
    el.gate.hidden = false;
  }

  // Changes to My board belong to the open notebook: saved on this iPad, and sent to the PC when it can hear.
  const MINE_EVENTS = new Set(["start", "add", "set", "end", "remove", "put", "clear"]);

  function send(message) {
    const online = Boolean(socket && socket.readyState === WebSocket.OPEN && connected);
    const mine = MINE_EVENTS.has(message.t);
    if (mine) {
      // Written while the PC is out of reach: the whole notebook is sent when it comes back.
      if (!online && nb) nb.unsynced = true;
      contentChanged();
    }
    if (online) socket.send(JSON.stringify(message));
    else if (!mine && !["send", "paper", "check", "control"].includes(message.t)) outbox.push(message);
  }

  function apply(message) {
    if (message.t === "start") {
      const index = strokes.findIndex((item) => item.id === message.stroke.id);
      if (index >= 0) strokes.splice(index, 1);
      strokes.push({ ...message.stroke, done: false });
      live.add(message.stroke.id);
    } else if (message.t === "add") {
      const stroke = strokes.find((item) => item.id === message.id);
      if (stroke) stroke.points.push(...message.p);
    } else if (message.t === "set") {
      const stroke = strokes.find((item) => item.id === message.id);
      if (stroke) Object.assign(stroke, { points: message.p, sim: true, clean: true });
      if (stroke && !live.has(stroke.id)) rebuildBase();
    } else if (message.t === "end") {
      finish(message.id);
      return;
    } else if (message.t === "remove") {
      const index = strokes.findIndex((item) => item.id === message.id);
      if (index < 0) return;
      strokes.splice(index, 1);
      live.delete(message.id);
      rebuildBase();
    } else if (message.t === "put") {
      // Whole strokes put back or changed: an undo, a redo, or a lasso edit on another screen.
      for (const item of message.strokes || []) {
        const { i, ...rest } = item;
        const stroke = { ...rest, done: true };
        const index = strokes.findIndex((other) => other.id === item.id);
        if (index >= 0) strokes[index] = stroke;
        else strokes.splice(Number.isInteger(i) ? Math.min(Math.max(i, 0), strokes.length) : strokes.length, 0, stroke);
        live.delete(item.id);
      }
      rebuildBase();
    } else if (message.t === "clear") {
      strokes.length = 0;
      live.clear();
      if (current) live.add(current.id);
      rebuildBase();
    }
    if (lasso.selected.length) pruneSelection();
    if (message.fromPc && nb) nb.seen = (nb.seen || 0) + 1; // the PC changed it; remember we saw that
    contentChanged();
    schedulePaint();
    updateButtons();
  }

  // ---------------------------------------------------------------------------
  // Gemini's board
  // ---------------------------------------------------------------------------
  const whiteboard = window.SkybridgeWhiteboard;

  // What this board shows, kept the way the PC keeps it, so a resend of the same board is
  // recognised and left alone instead of being cleared and drawn once more (that was the flicker).
  let shownSteps = [];
  let shownProblem = null;
  const shownKey = () => JSON.stringify([...shownSteps, ...(shownProblem ? [shownProblem] : [])]);

  function trackDraw(packet) {
    if (packet?.board === "mine") shownProblem = packet;
    else shownSteps = packet?.clear ? [packet] : [...shownSteps, packet].slice(-40);
  }

  function showGeminiSteps(packets) {
    if (!whiteboard) return;
    const list = packets || [];
    const wanted = JSON.stringify(list);
    if (wanted === shownKey() && document.querySelector(".wb-step, .my-board-problem")) return;
    shownSteps = [];
    shownProblem = null;
    list.forEach(trackDraw);
    whiteboard.clear();
    // The PC resends its problem card with its steps, so one left from before
    // (an earlier session, or a PC that reloaded) goes.
    el.stage.querySelector(".my-board-problem")?.remove();
    for (const packet of list) whiteboard.draw(packet);
  }

  function onGemini(message) {
    if (!whiteboard) return;
    if (message.t === "wb-sync") {
      showGeminiSteps(message.packets);
    } else if (message.t === "wb-clear") {
      shownSteps = [];
      whiteboard.clear();
    } else if (message.t === "wb-size") {
      setGeminiSize(message);
    } else if (message.t === "wb-draw") {
      trackDraw(message.packet);
      whiteboard.draw(message.packet);
      if (message.packet?.board === "mine") {
        // The problem shows in the corner of this board.
        if (settings.layout === "gemini") toast("Gemini put a problem on your board");
      } else if (settings.layout === "mine") {
        el.geminiBadge.hidden = false;
        toast("Gemini drew on its board");
      }
    }
  }

  function renderLayout() {
    document.documentElement.dataset.layout = settings.layout;
    fitGeminiBoard();
    updateButtons();
    el.layouts.forEach((button) => button.setAttribute("aria-checked", String(button.dataset.layout === settings.layout)));
    if (settings.layout !== "mine") {
      el.geminiBadge.hidden = true;
      // Steps that arrived while it was hidden: jump to the latest one.
      requestAnimationFrame(() => { el.geminiBoard.scrollTop = el.geminiBoard.scrollHeight; });
    }
  }

  el.layouts.forEach((button) => {
    button.addEventListener("click", () => {
      settings.layout = button.dataset.layout;
      saveSettings();
      renderLayout();
    });
  });

  // ---------------------------------------------------------------------------
  // Writing on Gemini's board. The PC lays the board out and sends its width and
  // padding (wb-size); this iPad shows it at that width, scaled to fit, so the
  // writing sits next to the same step on both screens. Gemini keeps its steps
  // until a new problem, and starts each next step below the writing (whiteboard.js).
  // ---------------------------------------------------------------------------
  const MAX_INK_PIXELS = 16e6; // iPad Safari refuses bigger canvases
  const ROOM_BELOW = 0.6; // share of the board's height kept free below everything
  const geminiCanvas = document.createElement("canvas");
  geminiCanvas.className = "wb-gemini-ink";
  geminiCanvas.setAttribute("aria-label", "Your writing on Gemini's board");
  el.geminiBoard.prepend(geminiCanvas);
  const geminiCtx = geminiCanvas.getContext("2d");
  let geminiSize = null; // { w, pad: [top, right, bottom, left] } from the PC
  let geminiScale = 1;
  let inkBox = { width: 0, height: 0, ratio: 0 };
  let geminiCurrent = null;
  let geminiPointer = null;
  let geminiPending = [];
  let geminiFlushFrame = 0;
  let geminiFrame = 0;

  function stepsBottom() {
    const last = [...el.geminiBoard.querySelectorAll(".wb-step")].pop();
    return last ? last.offsetTop + last.offsetHeight : 0;
  }

  function geminiInkBottom() {
    let low = 0;
    geminiInk.forEach((stroke) => {
      if (stroke.eraser) return;
      stroke.points.forEach(([, y]) => { low = Math.max(low, y + stroke.width); });
    });
    return low;
  }

  function hasGeminiInk() {
    return geminiInk.some((stroke) => !stroke.eraser);
  }

  function setGeminiSize(message) {
    const w = Number(message.w);
    const pad = Array.isArray(message.pad) ? message.pad.map(Number) : [];
    if (!(w >= 100) || pad.length !== 4 || pad.some((side) => !Number.isFinite(side))) return;
    geminiSize = { w, pad };
    fitGeminiBoard();
  }

  function fitGeminiBoard() {
    const board = el.geminiBoard;
    const pane = el.geminiPane;
    if (!geminiSize || !pane.clientWidth) {
      layoutGeminiInk();
      return;
    }
    const head = pane.querySelector(".gemini-head");
    const available = pane.clientWidth;
    const height = pane.clientHeight - (head?.offsetHeight || 0);
    geminiScale = Math.round(Math.min(1.5, Math.max(0.3, available / geminiSize.w)) * 1000) / 1000;
    Object.assign(board.style, {
      flex: "none",
      boxSizing: "border-box",
      width: `${geminiSize.w}px`,
      height: `${height / geminiScale}px`,
      padding: geminiSize.pad.map((side) => `${side}px`).join(" "),
      marginLeft: `${Math.max(0, (available - geminiSize.w * geminiScale) / 2)}px`,
      transform: geminiScale === 1 ? "" : `scale(${geminiScale})`,
      transformOrigin: "0 0",
    });
    board.dataset.scale = String(geminiScale);
    layoutGeminiInk();
  }

  // Size the writing layer to the board's content, with room below to keep writing.
  function layoutGeminiInk() {
    const board = el.geminiBoard;
    const width = board.clientWidth;
    if (!width) return;
    const height = Math.ceil(Math.max(board.clientHeight, Math.max(stepsBottom(), geminiInkBottom()) + board.clientHeight * ROOM_BELOW));
    const sharp = (window.devicePixelRatio || 1) * geminiScale;
    const ratio = Math.round(Math.min(sharp, Math.sqrt(MAX_INK_PIXELS / (width * height))) * 100) / 100;
    if (width === inkBox.width && height === inkBox.height && ratio === inkBox.ratio) return;
    inkBox = { width, height, ratio };
    geminiCanvas.width = Math.round(width * ratio);
    geminiCanvas.height = Math.round(height * ratio);
    geminiCanvas.style.width = `${width}px`;
    geminiCanvas.style.height = `${height}px`;
    paintGeminiInk();
  }

  function paintGeminiInk() {
    geminiFrame = 0;
    geminiCtx.setTransform(1, 0, 0, 1, 0, 0);
    geminiCtx.clearRect(0, 0, geminiCanvas.width, geminiCanvas.height);
    geminiCtx.setTransform(inkBox.ratio, 0, 0, inkBox.ratio, 0, 0);
    layered(geminiInk).forEach((stroke) => drawStroke(geminiCtx, stroke === geminiCurrent ? withTail(stroke) : stroke));
  }

  function scheduleGeminiPaint() {
    if (!geminiFrame) geminiFrame = requestAnimationFrame(paintGeminiInk);
  }

  // whiteboard.js asks where the writing ends before placing a step, and clears
  // it when Gemini starts a new problem.
  window.SkybridgeGeminiInk = {
    bottom: geminiInkBottom,
    hasInk: hasGeminiInk,
    layout: layoutGeminiInk,
    clear() {
      geminiInk.length = 0;
      if (geminiCurrent) geminiInk.push(geminiCurrent);
      layoutGeminiInk();
      scheduleGeminiPaint();
      updateButtons();
    },
  };

  function applyGeminiInk(message) {
    const find = (id) => geminiInk.findIndex((item) => item.id === id);
    if (message.t === "gi-start") {
      const index = find(message.stroke.id);
      if (index >= 0) geminiInk.splice(index, 1);
      geminiInk.push({ ...message.stroke, points: message.stroke.points.map((p) => [...p]) });
    } else if (message.t === "gi-add") {
      geminiInk[find(message.id)]?.points.push(...message.p);
    } else if (message.t === "gi-set") {
      const stroke = geminiInk[find(message.id)];
      if (stroke) Object.assign(stroke, { points: message.p, sim: true, clean: true });
    } else if (message.t === "gi-remove") {
      const index = find(message.id);
      if (index >= 0) geminiInk.splice(index, 1);
    } else if (message.t === "gi-clear" || message.t === "gi-sync") {
      geminiInk.length = 0;
      for (const stroke of message.strokes || []) geminiInk.push(stroke);
      if (geminiCurrent && find(geminiCurrent.id) < 0) geminiInk.push(geminiCurrent);
    }
    layoutGeminiInk();
    scheduleGeminiPaint();
    updateButtons();
  }

  function geminiPoint(event) {
    const rect = geminiCanvas.getBoundingClientRect();
    return withPressure([
      Math.round(((event.clientX - rect.left) / geminiScale) * 10) / 10,
      Math.round(((event.clientY - rect.top) / geminiScale) * 10) / 10,
    ], event);
  }

  function flushGemini() {
    geminiFlushFrame = 0;
    if (!geminiCurrent || !geminiPending.length) return;
    send({ t: "gi-add", id: geminiCurrent.id, p: geminiPending });
    geminiPending = [];
  }

  // A finger scrolls Gemini's board (or writes, if set in Pen & paper); a quick
  // two-finger tap swaps the pen and the eraser, as on My board.
  const geminiTouches = new Map(); // id -> [x, y]
  let geminiTap = null;

  geminiCanvas.addEventListener("pointerdown", (event) => {
    setSettingsOpen(false);
    if (event.pointerType === "pen") lastPenAt = performance.now();
    if (event.pointerType === "touch") {
      if (geminiCurrent?.pen || isPalm(event)) return;
      if (settings.finger === "move" || geminiTouches.size) {
        try { geminiCanvas.setPointerCapture(event.pointerId); } catch {}
        geminiTouches.set(event.pointerId, [event.clientX, event.clientY]);
        if (geminiTouches.size === 1) geminiTap = { at: event.timeStamp, count: 0, moved: false };
        if (geminiTap) geminiTap.count += 1;
        return;
      }
    }
    if (event.pointerType === "pen") geminiTouches.clear();
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (geminiCurrent) return;
    event.preventDefault();
    try { geminiCanvas.setPointerCapture(event.pointerId); } catch {}
    geminiPointer = event.pointerId;
    const eraser = tool === "eraser";
    const marker = tool === "marker";
    const sim = marker || event.pointerType !== "pen";
    geminiCurrent = {
      id: `i${newId()}`,
      color: eraser ? "ink" : pen,
      eraser,
      hl: marker,
      width: eraser ? settings.eraser : marker ? markerWidth() : settings.width,
      sim,
      points: [geminiPoint(event)],
    };
    geminiInk.push(geminiCurrent);
    lastBoard = "gemini";
    send({ t: "gi-start", stroke: { ...geminiCurrent, points: [geminiCurrent.points[0]] } });
    scheduleGeminiPaint();
    updateButtons();
  });

  const holdGemini = window.SkybridgeInk?.hold(() => {
    if (!geminiCurrent || geminiCurrent.eraser || geminiCurrent.clean) return;
    const shaped = window.SkybridgeInk.snap(geminiCurrent.points);
    if (!shaped) return;
    if (geminiFlushFrame) cancelAnimationFrame(geminiFlushFrame);
    geminiFlushFrame = 0;
    geminiPending = [];
    Object.assign(geminiCurrent, { points: shaped, sim: true, clean: true });
    send({ t: "gi-set", id: geminiCurrent.id, p: shaped });
    scheduleGeminiPaint();
  });

  geminiCanvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "pen") lastPenAt = performance.now();
    const last = geminiTouches.get(event.pointerId);
    if (last) {
      const dx = event.clientX - last[0];
      const dy = event.clientY - last[1];
      geminiTouches.set(event.pointerId, [event.clientX, event.clientY]);
      if (geminiTap && Math.hypot(dx, dy) > 1) geminiTap.moved = geminiTap.moved || Math.hypot(dx, dy) > TAP_SLOP / 2;
      // Several fingers move the board once, by their average.
      el.geminiBoard.scrollTop -= dy / geminiScale / geminiTouches.size;
      el.geminiBoard.scrollLeft -= dx / geminiScale / geminiTouches.size;
      return;
    }
    if (!geminiCurrent || event.pointerId !== geminiPointer || geminiCurrent.clean) return;
    const samples = event.getCoalescedEvents?.() || [event];
    for (const sample of samples.length ? samples : [event]) {
      const point = geminiPoint(sample);
      geminiCurrent.points.push(point);
      geminiPending.push(point);
    }
    geminiCurrent.tail = predictedTail(event, geminiPoint, geminiCurrent);
    holdGemini?.move(geminiCurrent.points[geminiCurrent.points.length - 1]);
    if (!geminiFlushFrame) geminiFlushFrame = requestAnimationFrame(flushGemini);
    scheduleGeminiPaint();
  });

  function endGeminiStroke(event) {
    if (geminiTouches.delete(event.pointerId)) {
      const count = geminiTap?.count || 0;
      const quick = geminiTap && !geminiTap.moved && event.timeStamp - geminiTap.at < TAP_MS + (count === 3 ? 100 : 0);
      if (!geminiTouches.size) {
        geminiTap = null;
        if (quick) fingerTap(count);
      }
      return;
    }
    if (event.pointerType === "pen") lastPenAt = performance.now();
    if (!geminiCurrent || event.pointerId !== geminiPointer) return;
    holdGemini?.stop();
    if (geminiFlushFrame) cancelAnimationFrame(geminiFlushFrame);
    flushGemini();
    send({ t: "gi-end", id: geminiCurrent.id });
    const stroke = geminiCurrent;
    stroke.tail = null;
    geminiCurrent = null;
    geminiPointer = null;
    if (!scribbleErase("gemini", stroke)) record("gemini", [], [itemOf(geminiInk, stroke)]);
    layoutGeminiInk();
    updateButtons();
  }
  geminiCanvas.addEventListener("pointerup", endGeminiStroke);
  geminiCanvas.addEventListener("pointercancel", endGeminiStroke);
  // No loupe, text selection or page scroll while writing on the board.
  geminiCanvas.addEventListener("touchstart", (event) => event.preventDefault(), { passive: false });
  new ResizeObserver(() => fitGeminiBoard()).observe(el.geminiPane);

  function onSync(message) {
    if (message.gemini) showGeminiSteps(message.gemini);
    if (message.geminiSize) setGeminiSize(message.geminiSize);
    // After the steps: drawing them clears the writing.
    applyGeminiInk({ t: "gi-sync", strokes: message.geminiInk || [] });
    // The notebook on this iPad is the master copy. Say which way it goes with the PC's.
    const plan = syncPlan(message);
    if (plan.adopt) {
      strokes.length = 0;
      live.clear();
      for (const stroke of message.strokes || []) strokes.push({ ...stroke, done: true });
    } else if (plan.union) {
      const have = new Set(strokes.map((stroke) => stroke.id));
      for (const stroke of message.strokes || []) if (!have.has(stroke.id)) strokes.push({ ...stroke, done: true });
    }
    pruneSelection();
    connected = true;
    if (nb) {
      nb.seen = Number(message.notebook?.pcEdits) || 0;
      if (plan.push) pushNotebook();
      else if (plan.adopt) { nb.unsynced = false; saveNow(); }
      renderNotebookUi();
    }
    renderSession(message.session);
    // When the PC's board was taken, pick up where it was left. A notebook keeps its own view.
    if (plan.adopt && Number(message.board?.w) > 0) {
      const { width } = el.stage.getBoundingClientRect();
      const zoom = width ? width / Number(message.board.w) : 1;
      moveView(Number(message.board.x) || 0, Number(message.board.y) || 0, zoom);
    }
    sendView();
    sendPaper();
    // Replay what was drawn while offline so it reaches the PC too.
    const pending = outbox.splice(0);
    for (const item of pending) {
      if (item.t === "start") apply({ t: "start", stroke: strokeFromStart(item) });
      else if (item.t.startsWith("gi-")) applyGeminiInk(item);
      else apply(item);
      socket.send(JSON.stringify(item));
    }
    if (current && !strokes.includes(current)) {
      const index = strokes.findIndex((item) => item.id === current.id);
      if (index >= 0) strokes[index] = current;
      live.add(current.id);
    }
    rebuildBase();
    schedulePaint();
    updateButtons();
  }

  // What to do with the PC's copy of the board when this iPad (re)connects.
  //  adopt: the PC changed it and nothing here did, or this is the first run with ink from before notebooks
  //  union: both changed it; keep every stroke from both, then send the result
  //  push:  this notebook replaces the PC's copy (a different notebook, a restarted PC, or edits made offline)
  function syncPlan(message) {
    const relay = message.notebook || {};
    const theirs = message.strokes || [];
    if (!nb) return { adopt: true };
    const empty = !strokes.some((stroke) => !stroke.eraser);
    if (relay.id !== nb.id) {
      return !relay.id && theirs.length && empty ? { adopt: true } : { push: true };
    }
    if ((Number(relay.pcEdits) || 0) > (nb.seen || 0)) return nb.unsynced ? { union: true, push: true } : { adopt: true };
    return nb.unsynced ? { push: true } : {};
  }

  function pushNotebook() {
    if (!nb || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ t: "load", id: nb.id, name: nb.name, strokes: strokes.filter((stroke) => stroke.points?.length).map(copyStroke) }));
    nb.unsynced = false;
    nb.seen = 0;
    queueSave();
  }

  function strokeFromStart(item) {
    return { id: item.id, color: item.color, eraser: item.eraser, width: item.width, sim: item.sim, points: item.p.map((p) => [...p]) };
  }

  function renderStatus() {
    if (!connected) return;
    if (pcOpen) setStatus("live", "Live on your PC");
    else setStatus("waiting", "Open Skybridge on your PC");
    renderNotebookUi();
  }

  // The connection heals itself: a heartbeat catches a socket that died silently
  // (the iPad slept, Wi-Fi changed, the PC restarted Skybridge), and any drop
  // reconnects with a short backoff. Tapping the status retries at once.
  const PING_EVERY = 10000;
  const PONG_TIMEOUT = 25000;
  const OPEN_TIMEOUT = 6000;
  let lastPong = 0;
  let offlineHidden = false;
  let retryTimer = 0;
  let heartbeat = 0;

  function scheduleRetry(delay) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, delay);
  }

  function drop(ws) {
    if (ws !== socket) return;
    socket = null;
    connected = false;
    clearInterval(heartbeat);
    try { ws.close(); } catch {}
    updateButtons();
    retry += 1;
    setStatus("down", retry >= 3 ? "Offline" : "Reconnecting");
    el.offline.hidden = retry < 3 || offlineHidden;
    renderNotebookUi();
    // Without the PC there is nothing to hurry for: try less often after a while.
    scheduleRetry(Math.min(retry >= 6 ? 30000 : 8000, 500 * 2 ** Math.min(retry, 4)));
  }

  function connect() {
    clearTimeout(retryTimer);
    if (!code || (hosted && !host)) {
      // Not paired yet: the notebooks still work on their own.
      setStatus(hosted ? "idle" : "down", hosted ? "On this iPad" : "Not paired");
      renderNotebookUi();
      return;
    }
    if (socket) {
      const old = socket;
      socket = null;
      clearInterval(heartbeat);
      try { old.close(); } catch {}
    }
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${host || location.host}/ws/pad?code=${encodeURIComponent(code)}`);
    socket = ws;
    if (retry < 3) setStatus("down", retry ? "Reconnecting" : "Connecting");
    const openTimer = setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) drop(ws); }, OPEN_TIMEOUT);

    ws.addEventListener("open", () => {
      clearTimeout(openTimer);
      lastPong = performance.now();
      clearInterval(heartbeat);
      heartbeat = setInterval(() => {
        if (ws !== socket) return;
        if (performance.now() - lastPong > PONG_TIMEOUT) drop(ws);
        else if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "ping" }));
      }, PING_EVERY);
    });

    ws.addEventListener("message", (event) => {
      if (ws !== socket) return;
      lastPong = performance.now();
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.t === "pong") {
        return;
      } else if (message.t === "sync") {
        retry = 0;
        offlineHidden = false;
        el.offline.hidden = true;
        el.gate.hidden = true;
        onSync(message);
        renderStatus();
      } else if (message.t === "status") {
        pcOpen = Boolean(message.pc);
        renderStatus();
        updateButtons();
      } else if (message.t.startsWith("wb-")) {
        onGemini(message);
      } else if (message.t.startsWith("gi-")) {
        applyGeminiInk(message);
      } else if (message.t === "session") {
        renderSession(message);
      } else if (message.t === "checked") {
        showVerdict(message);
      } else if (message.t === "llm-result") {
        window.SkybridgeLocal?.onRelay(message);
      } else if (message.t === "read-result") {
        window.SkybridgeSmart?.onRelay(message);
      } else if (message.t === "sent") {
        toast(message.ok ? "Sent to Gemini" : (message.reason || "Not sent"));
      } else {
        apply(message);
      }
    });

    ws.addEventListener("close", (event) => {
      clearTimeout(openTimer);
      if (ws !== socket) return;
      if (event.code === 4403 || event.code === 1008) {
        socket = null;
        connected = false;
        clearInterval(heartbeat);
        updateButtons();
        showGate("This pairing code no longer works", "Scan the code under My board on your PC again. Your notebooks are safe on this iPad.");
        renderNotebookUi();
        return;
      }
      drop(ws);
    });
  }

  function retryNow() {
    retry = Math.min(retry, 1);
    connect();
  }

  el.status.addEventListener("click", () => { if (!connected) retryNow(); });
  el.retry.addEventListener("click", retryNow);
  el.offlineHost.textContent = host || location.host;
  el.offlineHide.addEventListener("click", () => { offlineHidden = true; el.offline.hidden = true; });
  el.gateClose.addEventListener("click", () => { el.gate.hidden = true; });
  window.addEventListener("online", retryNow);

  // Safari pauses sockets in the background. On return, reconnect if the socket is
  // gone, or check it still answers.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      retryNow();
      return;
    }
    const ws = socket;
    const asked = performance.now();
    ws.send(JSON.stringify({ t: "ping" }));
    setTimeout(() => { if (ws === socket && lastPong < asked) drop(ws); }, 4000);
  });

  // ---------------------------------------------------------------------------
  // Moving the board
  // ---------------------------------------------------------------------------
  let viewFrame = 0;
  let viewSent = 0;

  function moveView(x, y, zoom = view.zoom) {
    view.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 1000) / 1000));
    view.x = Math.round(x * 10) / 10;
    view.y = Math.round(y * 10) / 10;
    // The dot grid moves and scales with the board so it feels like paper sliding.
    gridPosition();
    el.stage.style.backgroundSize = `${settings.gridSize * view.zoom}px ${settings.gridSize * view.zoom}px`;
    renderZoomPill();
    queueSave(1500);
    if (!viewFrame) {
      viewFrame = requestAnimationFrame(() => {
        viewFrame = 0;
        rebuildBase();
        paint();
        positionLasso();
        sendView();
      });
    }
  }

  // Shows the zoom once the board is no longer at its start; a tap goes back.
  function renderZoomPill() {
    const away = Math.abs(view.zoom - 1) > 0.01 || Math.abs(view.x) > 1 || Math.abs(view.y) > 1;
    el.zoomPill.hidden = !away;
    el.zoomPill.textContent = `${Math.round(view.zoom * 100)}% · reset`;
  }
  el.zoomPill.addEventListener("click", () => moveView(0, 0, 1));
  el.newPageBtn.addEventListener("click", async () => { await newNotebook(); renderNotebookList(); });

  function sendView() {
    const { width, height } = el.stage.getBoundingClientRect();
    if (!width || !height || !connected) return;
    const now = performance.now();
    if (now - viewSent < 50) {
      // Keep the PC in step without flooding it; the last position always goes out.
      clearTimeout(sendView.timer);
      sendView.timer = setTimeout(sendView, 60);
      return;
    }
    viewSent = now;
    // The PC gets the visible area in board units, so it zooms along with the iPad.
    send({ t: "view", x: view.x, y: view.y, w: width / view.zoom, h: height / view.zoom, z: view.zoom });
  }

  // ---------------------------------------------------------------------------
  // Input. Apple Pencil always draws. A finger moves the board (or draws, if
  // set in Pen & paper). A resting palm is ignored while the Pencil writes.
  // ---------------------------------------------------------------------------
  let pen = "ink"; // pen colour (restored below once the palette exists)
  let tool = "pen"; // pen, marker (highlighter), eraser, lasso or matrix (brackets; stays until another tool is picked)
  let slot = -1; // the palette slot being edited: the one whose colour is the pen's
  let beforeEraser = "pen";
  let current = null;
  let pointerId = null;
  let pending = [];
  let flushFrame = 0;
  const touches = new Map(); // finger pointers moving the board: id -> [x, y]
  const PALM_WIDTH = 50; // contact wider than this (CSS px) is a palm, not a fingertip
  const PALM_GUARD = 600; // ms after the Pencil last touched or hovered when a finger is taken for a palm
  let lastPenAt = -1e9;
  const isPalm = (event) => Math.max(event.width || 0, event.height || 0) >= PALM_WIDTH || performance.now() - lastPenAt < PALM_GUARD;

  function pointFrom(event) {
    const rect = el.canvas.getBoundingClientRect();
    const point = [
      Math.round(((event.clientX - rect.left) / view.zoom + view.x) * 10) / 10,
      Math.round(((event.clientY - rect.top) / view.zoom + view.y) * 10) / 10,
    ];
    return withPressure(point, event);
  }

  // Apple Pencil pressure drives the line thickness, scaled by the Pressure slider
  // (0% gives an even line). Fingers and mice get simulated pressure.
  function withPressure(point, event) {
    if (event.pointerType === "pen" && tool !== "marker") {
      const raw = event.pressure || 0.5;
      const scaled = 0.5 + (raw - 0.5) * (settings.pressure / 100);
      point.push(Math.round(Math.min(1, Math.max(0.02, scaled)) * 1000) / 1000);
    }
    return point;
  }

  function centroid() {
    let x = 0;
    let y = 0;
    touches.forEach(([tx, ty]) => { x += tx; y += ty; });
    return [x / touches.size, y / touches.size];
  }

  // Safari doesn't give web pages the Pencil's squeeze or double-tap, so finger taps do the quick
  // things: two fingers swap the pen and the eraser, two fingers twice redo, three fingers undo.
  const TAP_MS = 300;
  const DOUBLE_TAP_MS = 360;
  let twoTapTimer = 0;
  function fingerTap(count) {
    if (count === 3) {
      undoAction();
    } else if (count === 2) {
      if (twoTapTimer) {
        clearTimeout(twoTapTimer);
        twoTapTimer = 0;
        redoAction();
      } else {
        twoTapTimer = setTimeout(() => { twoTapTimer = 0; toggleEraser(); }, DOUBLE_TAP_MS);
      }
    }
  }
  const TAP_SLOP = 12;
  let tap = null; // { at, starts: Map(id -> [x, y]), moved }

  function startPan(event) {
    if (isPalm(event)) return;
    try { el.canvas.setPointerCapture(event.pointerId); } catch {}
    touches.set(event.pointerId, [event.clientX, event.clientY]);
    if (touches.size === 1) tap = { at: event.timeStamp, starts: new Map(), moved: false };
    if (tap && touches.size > 3) tap.moved = true;
    tap?.starts.set(event.pointerId, [event.clientX, event.clientY]);
  }

  function spread() {
    const [a, b] = [...touches.values()];
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }

  // One finger drags the board. Two fingers drag and pinch: the board point under
  // the fingers stays under them while the zoom changes.
  function movePan(event) {
    if (!touches.has(event.pointerId)) return false;
    const pinching = touches.size >= 2;
    const before = centroid();
    const spreadBefore = pinching ? spread() : 0;
    touches.set(event.pointerId, [event.clientX, event.clientY]);
    const start = tap?.starts.get(event.pointerId);
    if (start && Math.hypot(event.clientX - start[0], event.clientY - start[1]) > TAP_SLOP) tap.moved = true;
    const after = centroid();
    const rect = el.stage.getBoundingClientRect();
    let zoom = view.zoom;
    if (pinching && spreadBefore > 10) zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * (spread() / spreadBefore)));
    const anchorX = (before[0] - rect.left) / view.zoom + view.x;
    const anchorY = (before[1] - rect.top) / view.zoom + view.y;
    moveView(anchorX - (after[0] - rect.left) / zoom, anchorY - (after[1] - rect.top) / zoom, zoom);
    return true;
  }

  function endPan(event) {
    const wasPinch = touches.size >= 2 && touches.has(event.pointerId);
    touches.delete(event.pointerId);
    const fingers = tap ? tap.starts.size : 0;
    const twoFingerTap = (fingers === 2 || fingers === 3) && !tap.moved && event.timeStamp - tap.at < TAP_MS + (fingers === 3 ? 100 : 0);
    if (twoFingerTap && !touches.size) {
      tap = null;
      fingerTap(fingers);
      return;
    }
    if (!touches.size) tap = null;
    if (wasPinch && !twoFingerTap) toast(`${Math.round(view.zoom * 100)}%`);
  }

  function newId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function flush() {
    flushFrame = 0;
    if (!current || !pending.length) return;
    send({ t: "add", id: current.id, p: pending });
    pending = [];
  }

  el.canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "pen") {
      lastPenAt = performance.now();
      tap = null;
      clearTimeout(twoTapTimer);
      twoTapTimer = 0;
    }
    if (event.pointerType === "touch") {
      // Fingers never draw while the Pencil is writing, or just was: that's a palm.
      if (current?.pen || lasso.path || isPalm(event)) return;
      if (settings.finger === "move" || touches.size) {
        startPan(event);
        return;
      }
    }
    if (event.pointerType === "pen") touches.clear(); // the Pencil wins over a resting hand
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (current || lasso.path) return;
    event.preventDefault();
    try { el.canvas.setPointerCapture(event.pointerId); } catch {}
    if (tool === "lasso" || tool === "matrix") {
      clearSelection();
      lasso.pointer = event.pointerId;
      lasso.path = [pointFrom(event).slice(0, 2)];
      return;
    }
    pointerId = event.pointerId;
    const eraser = tool === "eraser";
    const marker = tool === "marker";
    const { width, height } = el.stage.getBoundingClientRect();
    const sim = marker || event.pointerType !== "pen";
    const width0 = eraser ? settings.eraser : marker ? markerWidth() : settings.width;
    current = { id: newId(), color: eraser ? "ink" : pen, eraser, hl: marker, width: width0, sim, pen: event.pointerType === "pen", done: false, points: [pointFrom(event)] };
    strokes.push(current);
    live.add(current.id);
    lastBoard = "mine";
    send({ t: "start", id: current.id, color: current.color, eraser, hl: marker, width: current.width, sim, w: width, h: height, p: [current.points[0]] });
    schedulePaint();
    updateButtons();
  });

  // Hold the pen still at the end of a stroke to straighten it into a line or bracket.
  const holdStill = window.SkybridgeInk?.hold(() => {
    if (!current || current.eraser || current.clean) return;
    const shaped = window.SkybridgeInk.snap(current.points);
    if (!shaped) return;
    if (flushFrame) cancelAnimationFrame(flushFrame);
    flushFrame = 0;
    pending = [];
    Object.assign(current, { points: shaped, sim: true, clean: true });
    send({ t: "set", id: current.id, p: shaped });
    schedulePaint();
  });

  el.canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "pen") lastPenAt = performance.now();
    if (movePan(event)) return;
    if (lasso.path && event.pointerId === lasso.pointer) {
      const samples = event.getCoalescedEvents?.() || [event];
      for (const sample of samples.length ? samples : [event]) lasso.path.push(pointFrom(sample).slice(0, 2));
      schedulePaint();
      return;
    }
    if (!current || event.pointerId !== pointerId || current.clean) return;
    const samples = event.getCoalescedEvents?.() || [event];
    for (const sample of samples.length ? samples : [event]) {
      const point = pointFrom(sample);
      current.points.push(point);
      pending.push(point);
    }
    current.tail = predictedTail(event, pointFrom, current);
    holdStill?.move(current.points[current.points.length - 1]);
    if (!flushFrame) flushFrame = requestAnimationFrame(flush);
    schedulePaint();
  });

  function endStroke(event) {
    endPan(event);
    if (event.pointerType === "pen") lastPenAt = performance.now();
    if (lasso.path && event.pointerId === lasso.pointer) {
      finishLasso();
      return;
    }
    if (!current || event.pointerId !== pointerId) return;
    holdStill?.stop();
    if (flushFrame) cancelAnimationFrame(flushFrame);
    flush();
    const id = current.id;
    const stroke = current;
    stroke.tail = null;
    send({ t: "end", id });
    current = null;
    pointerId = null;
    // Optional tidy: soften the hand's wobble in the finished stroke, and tell the PC the new points.
    if (settings.tidy && !stroke.eraser && !stroke.hl && !stroke.clean && window.SkybridgeInk?.tidy) {
      const tidied = window.SkybridgeInk.tidy(stroke.points);
      if (tidied !== stroke.points) {
        stroke.points = tidied;
        send({ t: "put", strokes: [{ ...copyStroke(stroke), i: strokes.indexOf(stroke) }] });
      }
    }
    finish(id);
    wetShimmer(stroke);
    // A quick zigzag over ink erases what it crosses; anything else is a step to undo.
    if (!scribbleErase("mine", stroke)) record("mine", [], [itemOf(strokes, stroke)]);
  }
  el.canvas.addEventListener("pointerup", endStroke);
  el.canvas.addEventListener("pointercancel", endStroke);

  // Stop Safari's long-press loupe and double-tap zoom on the board.
  // The Hide button on Gemini's problem still takes taps.
  el.stage.addEventListener("touchstart", (event) => {
    if (!event.target.closest?.("button")) event.preventDefault();
  }, { passive: false });

  // The colour a pen picks up from the sheet; a pen swatch or the highlighter button changes the tool too.
  function setPen(name, remember = true, fromSheet = false) {
    pen = name;
    if (!fromSheet) slot = settings.palette.indexOf(name);
    if (tool === "eraser") tool = beforeEraser;
    renderTools();
    if (remember) { settings.pen = name; saveSettings(); }
  }

  function setTool(name) {
    if (name === "marker" && pen === "ink") pen = "mark-2"; // white highlighter would show nothing
    if (name === "eraser" && tool !== "eraser") beforeEraser = tool;
    tool = name;
    if (name !== "lasso" && name !== "matrix") clearSelection();
    el.canvas.parentElement.dataset.tool = name;
    renderTools();
  }

  function renderTools() {
    el.pens.forEach((button) => {
      const on = button.dataset.pen === "eraser" ? tool === "eraser" : tool === "pen" && button.dataset.pen === pen;
      button.setAttribute("aria-pressed", String(on));
    });
    el.tools.forEach((button) => button.setAttribute("aria-pressed", String(tool === button.dataset.tool)));
    el.colorBtn.setAttribute("aria-pressed", String((tool === "pen" || tool === "marker") && pen !== "ink"));
    paintColors();
  }

  // The colour button shows the pen's colour once one is picked from the sheet, else a hint of many.
  const RAINBOW = "conic-gradient(#d03a30, #e8710a, #e6c229, #2f9e44, #2b6fd6, #8a4fd0, #d03a30)";
  const QUICK_PENS = [["mark-1", "Mint"], ["mark-2", "Yellow"], ["mark-3", "Rose"]];

  function paintColors() {
    el.colorDot.style.background = pen === "ink" ? RAINBOW : strokeColor(pen);
    el.colorGrid.querySelectorAll("[data-color]").forEach((swatch) => {
      swatch.style.background = strokeColor(swatch.dataset.color);
      swatch.setAttribute("aria-checked", String(swatch.dataset.color === pen));
    });
  }

  const PEN_CHOICES = [...QUICK_PENS, ...(window.SkybridgeInk?.PALETTE || []).map(({ color, label }) => [color, label])];
  for (const [name, label] of PEN_CHOICES) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "color-swatch";
    swatch.dataset.color = name;
    swatch.setAttribute("role", "radio");
    swatch.setAttribute("aria-label", label);
    swatch.title = label;
    swatch.addEventListener("click", () => {
      chooseColor(name);
      if (lasso.selected.length) recolorSelection(name);
      el.colorSheet.hidden = true;
      el.colorBtn.setAttribute("aria-expanded", "false");
    });
    el.colorGrid.append(swatch);
  }
  // Any colour: an in-page picker. The browser's own colour popover bounced back to the
  // wheel and froze the page on iPad, so the board draws its own square and hue bar.
  const hsv = { h: 215, s: 0.8, v: 0.84 };
  function hsvToHex({ h, s, v }) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return "#" + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
  }
  function hexToHsv(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255);
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    let h = 0;
    if (d) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s: max ? d / max : 0, v: max };
  }
  function paintPicker() {
    const hex = hsvToHex(hsv);
    el.hsvSV.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`;
    el.hsvSVKnob.style.left = `${hsv.s * 100}%`;
    el.hsvSVKnob.style.top = `${(1 - hsv.v) * 100}%`;
    el.hsvHueKnob.style.left = `${(hsv.h / 360) * 100}%`;
    el.hsvChip.style.background = hex;
    el.hsvHex.textContent = hex;
    return hex;
  }
  function renderRecent() {
    el.hsvRecent.replaceChildren(...settings.recent.map((hex) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "color-swatch recent";
      dot.style.background = hex;
      dot.setAttribute("aria-label", `Recent colour ${hex}`);
      dot.addEventListener("click", () => {
        Object.assign(hsv, hexToHsv(hex));
        paintPicker();
        chooseColor(hex);
        if (lasso.selected.length) recolorSelection(hex);
      });
      return dot;
    }));
  }
  // The palette: colours kept at the bottom left. Tap one to write with it. With one picked, whatever
  // you choose in the colour sheet (a swatch, a recent colour or the wheel) takes its place, so
  // tap the white, open the wheel, pick a colour, and the white slot is that colour now.
  // Hold a slot to remove it; + adds a slot with the colour you have.
  function renderPalette() {
    const dots = settings.palette.map((value, index) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "palette-slot";
      dot.style.background = strokeColor(value);
      dot.dataset.value = value;
      dot.setAttribute("aria-label", `Palette colour ${index + 1}`);
      dot.setAttribute("aria-pressed", String(index === slot));
      let timer = 0;
      let held = false;
      const cancel = () => clearTimeout(timer);
      dot.addEventListener("pointerdown", () => {
        held = false;
        timer = setTimeout(() => {
          held = true;
          if (settings.palette.length <= PALETTE_MIN) { toast("Keep at least two colours"); return; }
          const before = [...settings.palette];
          settings.palette.splice(index, 1);
          slot = settings.palette.indexOf(pen);
          saveSettings();
          renderPalette();
          toast("Removed from the palette", { label: "Undo", run: () => { settings.palette = before; slot = before.indexOf(pen); saveSettings(); renderPalette(); } });
        }, 600);
      });
      for (const type of ["pointerup", "pointerleave", "pointercancel"]) dot.addEventListener(type, cancel);
      dot.addEventListener("contextmenu", (event) => event.preventDefault());
      dot.addEventListener("click", () => {
        if (held) return;
        const again = index === slot && tool !== "eraser";
        if (tool === "eraser") setTool(beforeEraser);
        if (/^#[0-9a-f]{6}$/i.test(value)) Object.assign(hsv, hexToHsv(value));
        paintPicker();
        setPen(value);
        slot = index;
        if (lasso.selected.length) recolorSelection(value);
        renderPalette();
        // A second tap on the colour already in hand opens the colour sheet to change it.
        if (again && el.colorSheet.hidden) el.colorBtn.click();
      });
      return dot;
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "palette-slot palette-add";
    add.setAttribute("aria-label", "Add a palette colour");
    add.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11"/></svg>';
    add.hidden = settings.palette.length >= PALETTE_MAX;
    add.addEventListener("click", () => {
      settings.palette = [...settings.palette, pen].slice(0, PALETTE_MAX);
      slot = settings.palette.length - 1;
      saveSettings();
      renderPalette();
      if (el.colorSheet.hidden) el.colorBtn.click();
    });
    el.palette.replaceChildren(...dots, add);
    if (el.paletteNote) el.paletteNote.textContent = slot >= 0 ? "The highlighted palette colour changes to whatever you pick here." : "Tap a palette colour first to swap it for another.";
  }
  // A colour chosen in the colour sheet: used for the pen, and kept in the palette slot being edited.
  function chooseColor(value, remember = true) {
    setPen(value, remember, true);
    if (slot >= 0 && settings.palette[slot] !== value) {
      settings.palette[slot] = value;
      if (remember) saveSettings();
    }
    renderPalette();
  }
  function dragOn(node, onMove, onEnd) {
    let id = null;
    node.addEventListener("pointerdown", (event) => {
      id = event.pointerId;
      node.setPointerCapture(id);
      onMove(event);
      event.preventDefault();
    });
    node.addEventListener("pointermove", (event) => { if (event.pointerId === id) onMove(event); });
    const stop = (event) => {
      if (event.pointerId !== id) return;
      id = null;
      onEnd();
    };
    node.addEventListener("pointerup", stop);
    node.addEventListener("pointercancel", stop);
  }
  // While dragging only the pen changes; the selection is recoloured and the colour
  // remembered once, when the finger lifts.
  const pickerMove = () => chooseColor(paintPicker(), false);
  const pickerDone = () => {
    const hex = paintPicker();
    chooseColor(hex);
    settings.recent = [hex, ...settings.recent.filter((c) => c !== hex)].slice(0, 8);
    saveSettings();
    renderRecent();
    renderPalette();
    if (lasso.selected.length) recolorSelection(hex);
  };
  const frac = (event, node) => {
    const r = node.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (event.clientY - r.top) / r.height))];
  };
  dragOn(el.hsvSV, (event) => {
    const [x, y] = frac(event, el.hsvSV);
    hsv.s = x;
    hsv.v = 1 - y;
    pickerMove();
  }, pickerDone);
  dragOn(el.hsvHue, (event) => {
    hsv.h = frac(event, el.hsvHue)[0] * 359.9;
    pickerMove();
  }, pickerDone);
  if (/^#[0-9a-f]{6}$/i.test(pen === "ink" ? "" : pen)) Object.assign(hsv, hexToHsv(pen));
  if (settings.pen && settings.pen !== "ink") {
    pen = settings.pen;
    if (/^#[0-9a-f]{6}$/i.test(pen)) Object.assign(hsv, hexToHsv(pen));
  }
  slot = settings.palette.indexOf(pen);
  paintPicker();
  renderRecent();
  renderPalette();
  renderTools();
  el.colorBtn.addEventListener("click", () => {
    const open = el.colorSheet.hidden;
    if (open) {
      setSettingsOpen(false);
      document.getElementById("exportSheet").hidden = true;
    }
    el.colorSheet.hidden = !open;
    el.colorBtn.setAttribute("aria-expanded", String(open));
    paintColors();
  });

  function toggleEraser() {
    setTool(tool === "eraser" ? beforeEraser : "eraser");
    toast(tool === "eraser" ? "Eraser" : { pen: "Pen", marker: "Highlighter", lasso: "Lasso", matrix: "Matrix brackets" }[tool]);
  }

  el.pens.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.pen === "eraser") {
        setTool(tool === "eraser" ? beforeEraser : "eraser");
      } else {
        setTool("pen");
        setPen(button.dataset.pen);
      }
    });
  });
  el.tools.forEach((button) => {
    button.addEventListener("click", () => setTool(tool === button.dataset.tool ? "pen" : button.dataset.tool));
  });
  const markerWidth = () => Math.max(14, Math.round(settings.width * 6));

  // ---------------------------------------------------------------------------
  // Pen & paper panel
  // ---------------------------------------------------------------------------
  const previewCtx = el.preview.getContext("2d");

  // A sample stroke that presses harder in the middle, so both sliders show their effect.
  function renderPreview() {
    const scale = window.devicePixelRatio || 1;
    const { width, height } = el.preview.getBoundingClientRect();
    if (!width) return;
    el.preview.width = Math.round(width * scale);
    el.preview.height = Math.round(height * scale);
    previewCtx.setTransform(scale, 0, 0, scale, 0, 0);
    // A shaky hand-drawn wave, so the Smoothing slider has something to even out.
    const points = [];
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    for (let i = 0; i <= 60; i += 1) {
      const t = i / 60;
      const raw = 0.15 + 0.7 * Math.sin(Math.PI * t);
      const pressure = Math.min(1, Math.max(0.02, 0.5 + (raw - 0.5) * (settings.pressure / 100)));
      points.push([16 + t * (width - 32) + noise() * 2, height / 2 + Math.sin(t * Math.PI * 2) * (height / 4) + noise() * 4, pressure]);
    }
    previewCtx.fillStyle = cssColor("ink");
    window.SkybridgeInk?.fill(previewCtx, { points, width: settings.width, sim: false });
  }

  // The paper and its dots are set with resolved colours rather than left to CSS
  // variables inside a gradient, which iPad Safari doesn't always repaint.
  function hsl(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
  }
  const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

  // Sets every chrome colour (bar, rail, panels, menus, borders, accent) from the theme. White is a
  // real light theme; the others are dark. Custom takes the hue and richness of the colour you picked.
  function applyTheme() {
    const light = settings.theme === "white";
    let h = THEME_HUES[settings.theme] ?? 156;
    let k = settings.theme === "black" ? 0.1 : settings.theme === "white" ? 0.7 : 1;
    if (settings.theme === "custom") {
      const [hh, ss] = hexToHsl(settings.accent);
      h = hh;
      k = Math.min(1, Math.max(0.15, ss / 55));
    }
    const root = document.documentElement.style;
    const set = (name, rgb) => root.setProperty(`--${name}`, hex(rgb));
    const setRgb = (name, rgb) => root.setProperty(`--${name}`, rgb.join(", "));
    const c = (s, l) => hsl(h, Math.min(100, s * k), l);
    root.colorScheme = light ? "light" : "dark";
    if (light) {
      set("bg", c(14, 95)); set("surface", c(12, 99)); set("surface-raised", c(16, 93));
      set("edge", c(14, 82)); set("edge-hi", c(16, 66));
      set("text", c(24, 12)); set("text-2", c(18, 26)); set("muted", c(10, 40));
      set("accent", c(70, 38)); set("accent-hi", c(75, 46)); set("accent-lo", c(70, 32)); set("on-accent", [255, 255, 255]);
      setRgb("acc-rgb", c(70, 38)); setRgb("line-rgb", c(30, 30)); setRgb("glow-rgb", c(70, 50));
      setRgb("bar-rgb", c(14, 96)); setRgb("panel-rgb", c(12, 98)); setRgb("text-rgb", c(24, 12)); setRgb("wash-rgb", [0, 0, 0]);
      set("bad", [178, 58, 48]); set("ok", [30, 120, 80]);
    } else {
      const accent = settings.theme === "custom" ? ensureLight(settings.accent) : c(38, 76);
      set("bg", c(40, 2)); set("surface", c(30, 7)); set("surface-raised", c(26, 11));
      set("edge", c(28, 17)); set("edge-hi", c(24, 32));
      set("text", c(16, 91)); set("text-2", c(14, 77)); set("muted", c(10, 62));
      set("accent", accent); set("accent-hi", lighten(accent, 0.25)); set("accent-lo", lighten(accent, -0.12)); set("on-accent", c(45, 8));
      setRgb("acc-rgb", accent); setRgb("line-rgb", c(30, 76)); setRgb("glow-rgb", accent);
      setRgb("bar-rgb", c(35, 3)); setRgb("panel-rgb", c(30, 6)); setRgb("text-rgb", c(16, 91)); setRgb("wash-rgb", [255, 255, 255]);
      set("bad", [227, 143, 143]); set("ok", [140, 231, 187]);
    }
    // Lasso lines sit on the paper, so they use the accent nudged to read on this paper.
    const accentHex = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#a9d9c2";
    root.setProperty("--pen-accent", window.SkybridgeInk?.colorOn ? window.SkybridgeInk.colorOn(accentHex, cssColor("paper")) : accentHex);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", hex(light ? c(14, 95) : c(40, 2)));
  }
  function hexToHsl(value) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [((h * 60) + 360) % 360, d ? (d / (1 - Math.abs(2 * l - 1))) * 100 : 0, l * 100];
  }
  // A picked colour used as the accent on a dark app: kept bright enough to read.
  function ensureLight(value) {
    const [h, s, l] = hexToHsl(value);
    return hsl(h, Math.max(20, s), Math.max(62, l));
  }
  function lighten(rgb, amount) {
    const [h, s, l] = hexToHsl(hex(rgb));
    return hsl(h, s, Math.min(95, Math.max(10, l + amount * 100)));
  }

  // Optional slow light drift on the chrome (never the paper). It stops while a pen is down.
  for (const type of ["pointerup", "pointercancel"]) {
    el.canvas.addEventListener(type, () => { delete document.documentElement.dataset.writing; });
  }
  el.canvas.addEventListener("pointerdown", () => { document.documentElement.dataset.writing = "on"; }, true);

  // ---- the problem card: font, size, colours and where it sits ----------------------------------------
  const CARD_FONTS = [["hand", "Hand"], ["roboto", "Roboto"], ["inter", "Inter"], ["jetbrains", "Mono"]];
  const CARD_SIZES = [["s", "S"], ["m", "M"], ["l", "L"], ["xl", "XL"]];
  const CARD_COLORS = [["auto", "Auto"], ["#c0392b", "Red"], ["#d9822b", "Orange"], ["#2f8f4e", "Green"], ["#2f6fd6", "Blue"], ["#7c4fd0", "Purple"]];
  const CARD_ANCHORS = [["tl", "Top left"], ["tc", "Top middle"], ["tr", "Top right"], ["br", "Bottom right"]];

  function segmented(container, items, key, label, target = null) {
    container.setAttribute("aria-label", label);
    for (const [value, text] of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.dataset.value = value;
      button.textContent = text;
      button.addEventListener("click", () => {
        (target || settings.card)[key] = value;
        saveSettings();
        renderSettings();
      });
      container.append(button);
    }
  }
  function swatches(container, key, label) {
    container.setAttribute("aria-label", label);
    for (const [value, text] of CARD_COLORS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "paper card-dot";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-label", text);
      button.title = text;
      button.dataset.value = value;
      button.textContent = value === "auto" ? "A" : "";
      if (value !== "auto") button.style.background = value;
      button.addEventListener("click", () => {
        settings.card[key] = value;
        saveSettings();
        renderSettings();
      });
      container.append(button);
    }
  }
  segmented(el.cardFont, CARD_FONTS, "font", "Card font");
  const PIN_WEIGHTS = [[0, "Normal"], [1, "Medium"], [2, "Bold"], [3, "Heavy"]];
  segmented(el.pinWeight, PIN_WEIGHTS, "weight", "Pinned writing thickness", settings.pin);
  const PIN_INKS = [["ink", "Auto (pencil)"], ["#2f6fd6", "Blue"], ["#2f8f4e", "Green"], ["#c0392b", "Red"], ["#8a94a0", "Grey"]];
  for (const [value, text] of PIN_INKS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "paper card-dot";
    button.setAttribute("role", "radio");
    button.setAttribute("aria-label", text);
    button.title = text;
    button.dataset.value = value;
    if (value === "ink") button.textContent = "A"; else button.style.background = value;
    button.addEventListener("click", () => { settings.pin.ink = value; saveSettings(); renderSettings(); });
    el.pinInk.append(button);
  }
  segmented(el.cardSize, CARD_SIZES, "size", "Card size");
  segmented(el.cardAnchor, CARD_ANCHORS, "anchor", "Where the card sits");
  swatches(el.cardTitle, "title", "Card title colour");
  swatches(el.cardText, "text", "Card text colour");

  // A chosen colour is nudged only as far as needed to read on this paper.
  const cardColor = (value) => (value === "auto" ? null : (window.SkybridgeInk?.colorOn ? window.SkybridgeInk.colorOn(value, cssColor("paper")) : value));

  function applyCardLook(card) {
    const look = settings.card;
    card.dataset.anchor = look.anchor;
    card.dataset.cardFont = look.font;
    card.dataset.cardSize = look.size;
    const text = cardColor(look.text);
    if (text) {
      card.dataset.cardColor = "custom";
      card.style.setProperty("--wb-ink", text);
      card.style.setProperty("--wb-faint", text);
    } else {
      card.dataset.cardColor = "auto";
      card.style.removeProperty("--wb-ink");
      card.style.removeProperty("--wb-faint");
    }
    const title = cardColor(look.title);
    if (title) card.style.setProperty("--card-title", title);
    else card.style.removeProperty("--card-title");
  }

  function renderCardSettings() {
    const look = settings.card;
    for (const [container, key] of [[el.cardFont, "font"], [el.cardSize, "size"], [el.cardAnchor, "anchor"], [el.cardTitle, "title"], [el.cardText, "text"]]) {
      container.querySelectorAll("[data-value]").forEach((button) => button.setAttribute("aria-checked", String(button.dataset.value === look[key])));
    }
    renderPinSettings();
    // The next problem drawn uses the same font and size.
    window.SkybridgeWhiteboard?.setCardStyle?.({ font: look.font, size: look.size, color: "auto", weight: "medium" });
    el.stage.querySelectorAll(".my-board-problem").forEach(applyCardLook);
  }

  // Buttons on the card: Move (tap to go to the next corner, or drag it to one), Next problem, Hide.
  const CARD_ICONS = {
    move: ["Move (drag to a corner, tap to go to the next)", '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'],
    next: ["Next problem", '<path d="M5 5l9 7-9 7zM18 5v14"/>'],
    pin: ["Pin to page", '<path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/>'],
    hide: ["Hide", '<path d="M6 6l12 12M18 6L6 18"/>'],
  };
  function iconifyCard(card) {
    card.querySelectorAll(".card-tools button, :scope > .practice-next").forEach((button) => {
      const kind = button.classList.contains("card-move") ? "move" : button.classList.contains("card-pin") ? "pin" : button.classList.contains("practice-next") ? "next" : "hide";
      const [label, path] = CARD_ICONS[kind];
      button.title = label;
      button.setAttribute("aria-label", label);
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    });
  }
  function decorateCard(card) {
    if (!card) return;
    if (card._tools) {
      // Next problem is added after the card is drawn: gather it in, in the order Move, Next, Hide.
      const tools = card.querySelector(".card-tools");
      const extra = card.querySelectorAll(":scope > .practice-next");
      const hide = tools.querySelector(".my-board-problem-hide:not(.card-move):not(.practice-next)");
      if (extra.length) { extra.forEach((button) => tools.append(button)); if (hide) tools.append(hide); }
      iconifyCard(card);
      applyCardLook(card);
      return;
    }
    card._tools = true;
    const tools = document.createElement("div");
    tools.className = "card-tools";
    const move = document.createElement("button");
    move.type = "button";
    move.className = "my-board-problem-hide card-move";
    move.textContent = "Move";
    move.title = "Drag me to a corner, or tap to go to the next one";
    tools.append(move);
    card.querySelectorAll(".practice-next, .my-board-problem-hide").forEach((button) => { if (button !== move) tools.append(button); });
    card.append(tools);
    let start = null;
    move.addEventListener("pointerdown", (event) => {
      move.setPointerCapture(event.pointerId);
      start = { x: event.clientX, y: event.clientY, moved: false };
      event.preventDefault();
    });
    move.addEventListener("pointermove", (event) => {
      if (!start) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (Math.hypot(dx, dy) > 6) start.moved = true;
      if (start.moved) card.style.translate = `${dx}px ${dy}px`;
    });
    const drop = (event) => {
      if (!start) return;
      const { moved } = start;
      start = null;
      let anchor;
      if (moved) {
        const box = card.getBoundingClientRect();
        const stage = el.stage.getBoundingClientRect();
        const cx = (box.left + box.width / 2 - stage.left) / stage.width;
        const cy = (box.top + box.height / 2 - stage.top) / stage.height;
        anchor = cy > 0.5 ? "br" : cx < 0.33 ? "tl" : cx < 0.66 ? "tc" : "tr";
      } else {
        anchor = CARD_ANCHORS[(CARD_ANCHORS.findIndex(([value]) => value === settings.card.anchor) + 1) % CARD_ANCHORS.length][0];
      }
      card.style.translate = "";
      settings.card.anchor = anchor;
      saveSettings();
      renderSettings();
    };
    move.addEventListener("pointerup", drop);
    move.addEventListener("pointercancel", drop);
    iconifyCard(card);
    applyCardLook(card);
  }
  new MutationObserver(() => el.stage.querySelectorAll(".my-board-problem").forEach(decorateCard)).observe(el.stage, { childList: true });

  // ---- your own paper: a colour picker; ink, marks and grid follow so they stay readable ----------
  const luma = (rgb) => (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  const hexRgb = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  function isDarkPaper() {
    return luma(hexRgb(settings.paper === "custom" ? settings.paperColor : (cssColor("paper") || "#0d1613"))) < 0.5;
  }
  const PAPER_VARS = ["paper", "grid", "ink", "mark-1", "mark-2", "mark-3", "grain-opacity"];
  function applyPaper() {
    const root = document.documentElement.style;
    if (settings.paper === "custom") {
      const dark = luma(hexRgb(settings.paperColor)) < 0.5;
      root.setProperty("--paper", settings.paperColor);
      root.setProperty("--grid", dark ? "rgba(255, 255, 255, 0.2)" : "rgba(60, 55, 45, 0.26)");
      root.setProperty("--ink", dark ? "#e3ece6" : "#2a2d2b");
      root.setProperty("--mark-1", dark ? "#a9d9c2" : "#2b6f55");
      root.setProperty("--mark-2", dark ? "#d8d89a" : "#94690f");
      root.setProperty("--mark-3", dark ? "#e38f8f" : "#b23a30");
      root.setProperty("--grain-opacity", dark ? "0.35" : "0.4");
    } else {
      PAPER_VARS.forEach((name) => root.removeProperty(`--${name}`));
    }
    // The living-paper light is white on dark paper and a soft shadow on light paper.
    root.setProperty("--lp-rgb", isDarkPaper() ? "255, 255, 255" : "40, 34, 20");
  }
  const paperHsv = { h: 220, s: 0.5, v: 0.34 };
  function paintPaperPicker() {
    el.paperSV.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${paperHsv.h} 100% 50%))`;
    el.paperSVKnob.style.left = `${paperHsv.s * 100}%`;
    el.paperSVKnob.style.top = `${(1 - paperHsv.v) * 100}%`;
    el.paperHueKnob.style.left = `${(paperHsv.h / 360) * 100}%`;
    el.paperChip.style.background = settings.paperColor;
  }
  function paperPickerMove() {
    settings.paper = "custom";
    settings.paperColor = hsvToHex(paperHsv);
    renderSettings();
    rebuildBase();
    paint();
  }
  const paperPickerEnd = () => { saveSettings(); sendPaper(); };
  dragOn(el.paperSV, (event) => {
    const [x, y] = frac(event, el.paperSV);
    paperHsv.s = x;
    paperHsv.v = 1 - y;
    paperPickerMove();
  }, paperPickerEnd);
  dragOn(el.paperHue, (event) => {
    paperHsv.h = frac(event, el.paperHue)[0] * 359.9;
    paperPickerMove();
  }, paperPickerEnd);
  Object.assign(paperHsv, hexToHsv(settings.paperColor));

  // ---- experimental effects: all off until switched on, paused while a pen is down ------------------
  const FX = [
    { id: "light", label: "Theme light", hint: "A slow drift of soft light across the toolbar and rail." },
    { id: "living", label: "Living paper", hint: "A faint, slow light drifting across the paper. The paper itself and the ink stay still." },
    { id: "hover", label: "Pencil hover", hint: "A precise dot in your ink colour where the Pencil hovers, or the eraser's outline when you have the eraser. Needs an iPad that senses hover." },
    { id: "wet", label: "Wet ink", hint: "A new stroke shines for a moment, then dries." },
    { id: "parallax", label: "Paper parallax", hint: "The grid slides a touch slower than the ink when you move the board." },
  ];
  for (const effect of FX) {
    const row = document.createElement("div");
    row.className = "setting";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tool wide";
    button.setAttribute("aria-pressed", "false");
    button.textContent = effect.label;
    const hint = document.createElement("span");
    hint.className = "setting-hint";
    hint.textContent = effect.hint;
    row.append(button, hint);
    el.labList.append(row);
    effect.button = button;
    button.addEventListener("click", () => {
      settings.fxs[effect.id] = !settings.fxs[effect.id];
      saveSettings();
      renderSettings();
    });
  }
  const fxOn = (id) => Boolean(settings.fxs[id]);
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  // Pencil hover: a small dot the size of the pen tip in the ink colour (a wider soft one for the
  // highlighter), or the eraser's real outline. One element, moved by transform in an animation frame.
  // Safari reports where the Pencil is, but not how high above the glass, so the dot's opacity is fixed.
  const HOVER_OPACITY = 0.65;
  let hoverFrame = 0;
  let hoverAt = null;
  let hoverLook = "";
  function showHover() {
    hoverFrame = 0;
    const glow = el.hoverGlow;
    if (!hoverAt || tool === "lasso" || tool === "matrix") { glow.style.opacity = "0"; return; }
    const eraser = tool === "eraser";
    const marker = tool === "marker";
    const board = tool === "eraser" ? settings.eraser : marker ? markerWidth() : settings.width;
    const size = Math.max(eraser ? 10 : marker ? 8 : 5, Math.round(board * view.zoom * 10) / 10);
    const look = `${tool}|${size}|${pen}|${settings.paper}|${settings.paperColor}`;
    if (look !== hoverLook) {
      hoverLook = look;
      glow.dataset.kind = eraser ? "eraser" : marker ? "marker" : "dot";
      glow.style.width = glow.style.height = `${size}px`;
      glow.style.background = eraser ? "" : strokeColor(pen);
    }
    glow.style.transform = `translate3d(${hoverAt[0] - size / 2}px, ${hoverAt[1] - size / 2}px, 0)`;
    glow.style.opacity = String(marker ? 0.35 : eraser ? 1 : HOVER_OPACITY);
  }
  el.canvas.addEventListener("pointermove", (event) => {
    if (!fxOn("hover") || event.pointerType !== "pen") return;
    hoverAt = event.buttons === 0 ? [event.clientX, event.clientY] : null;
    if (!hoverFrame) hoverFrame = requestAnimationFrame(showHover);
  }, { passive: true });
  for (const type of ["pointerdown", "pointerleave", "pointercancel"]) {
    el.canvas.addEventListener(type, () => {
      hoverAt = null;
      if (fxOn("hover") && !hoverFrame) hoverFrame = requestAnimationFrame(showHover);
    }, { passive: true });
  }

  // Wet ink: draw the finished stroke on its own layer with a shine, then fade that layer out.
  let wetTimer = 0;
  function wetShimmer(stroke) {
    if (!fxOn("wet") || stroke.eraser || stroke.hl || reducedMotion?.matches) return;
    const layer = el.wetCanvas;
    if (layer.width !== el.canvas.width || layer.height !== el.canvas.height) {
      layer.width = el.canvas.width;
      layer.height = el.canvas.height;
    }
    const wet = layer.getContext("2d");
    wet.setTransform(1, 0, 0, 1, 0, 0);
    wet.clearRect(0, 0, layer.width, layer.height);
    toScreen(wet);
    wet.save();
    wet.shadowColor = isDarkPaper() ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 255, 255, 1)";
    wet.shadowBlur = 14 * ratio;
    drawStroke(wet, stroke);
    wet.restore();
    layer.style.transition = "none";
    layer.style.opacity = "0.9";
    clearTimeout(wetTimer);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      layer.style.transition = "opacity 1100ms ease-out";
      layer.style.opacity = "0";
    }));
    wetTimer = setTimeout(() => wet.clearRect(0, 0, layer.width, layer.height), 1400);
  }

  // The grid slides a touch slower than the ink when parallax is on.
  function gridPosition() {
    const k = fxOn("parallax") ? 0.9 : 1;
    el.stage.style.backgroundPosition = `${-view.x * view.zoom * k}px ${-view.y * view.zoom * k}px`;
  }

  function paintPaper() {
    const line = cssColor("grid");
    const pattern = {
      none: "none",
      dots: `radial-gradient(circle, ${line} 1.25px, transparent 1.7px)`,
      square: `linear-gradient(to right, ${line} 1px, transparent 1px), linear-gradient(to bottom, ${line} 1px, transparent 1px)`,
      lined: `linear-gradient(to bottom, ${line} 1px, transparent 1px)`,
    }[settings.grid];
    for (const target of [el.stage, el.geminiBoard]) {
      target.style.backgroundImage = pattern;
    }
    el.geminiBoard.style.backgroundSize = `${settings.gridSize}px ${settings.gridSize}px`;
    el.stage.style.backgroundSize = `${settings.gridSize * view.zoom}px ${settings.gridSize * view.zoom}px`;
    el.stage.style.backgroundColor = cssColor("paper");
    el.geminiPane.style.backgroundColor = cssColor("paper");
  }

  function sendPaper() {
    // The PC only knows its own papers, so your paper shows there as the nearest dark or light one.
    const pcPaper = settings.paper === "custom" ? (isDarkPaper() ? "black" : "white") : settings.paper;
    send({ t: "paper", paper: pcPaper, grid: settings.grid !== "none", gridStyle: settings.grid, gridSize: settings.gridSize, grain: settings.grain, smooth: settings.smooth });
  }

  function renderSettings() {
    document.documentElement.dataset.paper = settings.paper;
    applyTheme();
    applyPaper();
    for (const effect of FX) {
      document.documentElement.dataset[`fx${effect.id}`] = settings.fxs[effect.id] ? "on" : "off";
      effect.button?.setAttribute("aria-pressed", String(Boolean(settings.fxs[effect.id])));
    }
    gridPosition();
    renderCardSettings();
    el.paperPicker.hidden = settings.paper !== "custom";
    paintPaperPicker();
    document.documentElement.dataset.grid = settings.grid === "none" ? "off" : "on";
    document.documentElement.dataset.grain = settings.grain ? "on" : "off";
    paintPaper();
    el.gridStyles.forEach((button) => button.setAttribute("aria-checked", String(button.dataset.grid === settings.grid)));
    el.gridSizeInput.value = settings.gridSize;
    el.gridSizeOut.textContent = `${settings.gridSize} px`;
    el.gridSizeRow.hidden = settings.grid === "none";
    el.grain.setAttribute("aria-pressed", String(settings.grain));
    el.widthInput.value = settings.width;
    el.widthOut.textContent = Number(settings.width).toFixed(1);
    el.pressureInput.value = settings.pressure;
    el.pressureOut.textContent = `${settings.pressure}%`;
    el.smoothInput.value = settings.smooth;
    el.smoothOut.textContent = `${settings.smooth}%`;
    el.tidy.setAttribute("aria-pressed", String(settings.tidy));
    el.eraserInput.value = settings.eraser;
    el.eraserOut.textContent = `${settings.eraser}`;
    el.rail.dataset.collapsed = String(!settings.rail);
    el.railToggle.setAttribute("aria-expanded", String(settings.rail));
    el.railToggle.title = el.railToggle.ariaLabel = settings.rail ? "Hide the tool rail" : "Show the tool rail";
    window.SkybridgeInk?.setSmoothing(settings.smooth);
    paintColors();
    el.papers.querySelectorAll("[data-paper]").forEach((button) => {
      button.setAttribute("aria-checked", String(button.dataset.paper === settings.paper));
    });
    el.themes.querySelectorAll("[data-theme]").forEach((button) => {
      button.setAttribute("aria-checked", String(button.dataset.theme === settings.theme));
    });
    el.themePicker.hidden = settings.theme !== "custom";
    paintThemePicker();
    el.fingerModes.forEach((button) => button.setAttribute("aria-checked", String(button.dataset.finger === settings.finger)));
    if (!el.settings.hidden) renderPreview();
  }

  Object.entries(PAPERS).forEach(([key, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "paper";
    button.dataset.paper = key;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-label", label);
    button.title = label;
    // Each swatch shows its own paper colour (your own paper shows the colour wheel).
    if (key === "custom") button.style.background = "conic-gradient(#f66, #fd6, #6d8, #6df, #86f, #f6c, #f66)";
    else {
      document.documentElement.dataset.paper = key;
      button.style.background = cssColor("paper");
    }
    button.addEventListener("click", () => {
      settings.paper = key;
      saveSettings();
      renderSettings();
      sendPaper();
      rebuildBase(); // light paper uses dark ink
      paint();
      if (key === "custom") setSettingsOpen(true);
    });
    el.papers.append(button);
  });

  const themeSwatch = (key) => ({
    black: "linear-gradient(135deg, #0b0c0e 50%, #3a3d42 50%)",
    white: "linear-gradient(135deg, #f6f6f4 50%, #c9ccd2 50%)",
    green: "linear-gradient(135deg, #0b1411 50%, #a9d9c2 50%)",
    purple: "linear-gradient(135deg, #130f1c 50%, #b9a2ee 50%)",
    custom: "conic-gradient(#f66, #fd6, #6d8, #6df, #86f, #f6c, #f66)",
  })[key];
  Object.keys(THEMES).forEach((key) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "paper theme-dot";
    button.dataset.theme = key;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-label", THEMES[key]);
    button.title = THEMES[key];
    button.style.background = themeSwatch(key);
    button.addEventListener("click", () => {
      settings.theme = key;
      saveSettings();
      renderSettings();
      paint();
    });
    el.themes.append(button);
  });

  // Your own app colour: a shade square and a hue bar, like the pen's, that set the accent.
  const themeHsv = { h: 265, s: 0.6, v: 0.84 };
  function paintThemePicker() {
    el.themeSV.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${themeHsv.h} 100% 50%))`;
    el.themeSVKnob.style.left = `${themeHsv.s * 100}%`;
    el.themeSVKnob.style.top = `${(1 - themeHsv.v) * 100}%`;
    el.themeHueKnob.style.left = `${(themeHsv.h / 360) * 100}%`;
    el.themeChip.style.background = hsvToHex(themeHsv);
  }
  function themePickerMove() {
    settings.theme = "custom";
    settings.accent = hsvToHex(themeHsv);
    paintThemePicker();
    renderSettings();
  }
  dragOn(el.themeSV, (event) => {
    const [x, y] = frac(event, el.themeSV);
    themeHsv.s = x;
    themeHsv.v = 1 - y;
    themePickerMove();
  }, saveSettings);
  dragOn(el.themeHue, (event) => {
    themeHsv.h = frac(event, el.themeHue)[0] * 359.9;
    themePickerMove();
  }, saveSettings);
  Object.assign(themeHsv, hexToHsv(settings.accent));

  el.grain.addEventListener("click", () => {
    settings.grain = !settings.grain;
    saveSettings();
    renderSettings();
    sendPaper();
  });
  el.gridStyles.forEach((button) => button.addEventListener("click", () => {
    settings.grid = button.dataset.grid;
    saveSettings();
    renderSettings();
    sendPaper();
  }));
  el.gridSizeInput.addEventListener("input", () => {
    settings.gridSize = Number(el.gridSizeInput.value);
    saveSettings();
    renderSettings();
    sendPaper();
  });

  el.widthInput.addEventListener("input", () => {
    settings.width = Number(el.widthInput.value);
    saveSettings();
    renderSettings();
  });
  el.eraserInput.addEventListener("input", () => {
    settings.eraser = Number(el.eraserInput.value);
    saveSettings();
    renderSettings();
  });
  el.railToggle.addEventListener("click", () => {
    settings.rail = !settings.rail;
    saveSettings();
    renderSettings();
  });
  el.smoothInput.addEventListener("input", () => {
    settings.smooth = Number(el.smoothInput.value);
    saveSettings();
    renderSettings();
    sendPaper();
    rebuildBase();
    paint();
    paintGeminiInk();
  });
  el.tidy.addEventListener("click", () => {
    settings.tidy = !settings.tidy;
    saveSettings();
    renderSettings();
  });
  el.pressureInput.addEventListener("input", () => {
    settings.pressure = Number(el.pressureInput.value);
    saveSettings();
    renderSettings();
  });
  el.fingerModes.forEach((button) => {
    button.addEventListener("click", () => {
      settings.finger = button.dataset.finger;
      saveSettings();
      renderSettings();
    });
  });
  el.recenter.addEventListener("click", () => moveView(0, 0, 1));

  // Pen and Paper are two pages side by side: swipe or tap a tab, and the last one is remembered.
  let pageLock = 0;
  function showPage(name, smooth) {
    pageLock = performance.now() + (smooth ? 600 : 100);
    el.pages.scrollTo({ left: PAGES.indexOf(name) * el.pages.clientWidth, behavior: smooth ? "smooth" : "auto" });
    el.tabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.page === name)));
  }
  el.tabs.forEach((tab) => tab.addEventListener("click", () => {
    settings.page = tab.dataset.page;
    saveSettings();
    showPage(settings.page, true);
  }));
  el.pages.addEventListener("scroll", () => {
    if (performance.now() < pageLock) return;
    const name = PAGES[Math.min(PAGES.length - 1, Math.round(el.pages.scrollLeft / el.pages.clientWidth))];
    if (name === settings.page) return;
    settings.page = name;
    saveSettings();
    el.tabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.page === name)));
  }, { passive: true });

  function setSettingsOpen(open) {
    el.notebookSheet.hidden = true;
    el.notebookBtn.setAttribute("aria-expanded", "false");
    if (!open) {
      // Starting to write (or opening another sheet) puts the colour sheet away too.
      el.colorSheet.hidden = true;
      el.colorBtn.setAttribute("aria-expanded", "false");
    }
    el.settings.hidden = !open;
    if (open) showPage(settings.page, false);
    el.settingsBtn.setAttribute("aria-expanded", String(open));
    el.settingsBtn.setAttribute("aria-pressed", String(open));
    if (open) {
      renderPreview();
      document.getElementById("exportSheet").hidden = true;
      el.colorSheet.hidden = true;
    }
  }
  el.labBtn.addEventListener("click", () => {
    const open = el.settings.hidden || settings.page !== "lab";
    settings.page = "lab";
    saveSettings();
    setSettingsOpen(open);
    if (open) showPage("lab", false);
  });
  el.settingsBtn.addEventListener("click", () => setSettingsOpen(el.settings.hidden));
  // Starting to write closes the panel.
  el.canvas.addEventListener("pointerdown", () => setSettingsOpen(false), true);

  // ---------------------------------------------------------------------------
  // Undo and redo. Each change to a board is one step: the strokes it touched as they were
  // before and as they are after (each with its place in the stack). Undo and redo swap them
  // for each other, so Clear, a scribble erase and a lasso edit all come back with Undo.
  // ---------------------------------------------------------------------------
  const HISTORY_MAX = 80;
  const copyStroke = (stroke) => {
    const { done, pen: byPen, ...rest } = stroke;
    return { ...rest, points: stroke.points.map((point) => [...point]) };
  };
  const itemOf = (list, stroke) => ({ s: copyStroke(stroke), i: list.indexOf(stroke) });

  const boards = {
    mine: {
      list: strokes,
      remove(id) { apply({ t: "remove", id }); send({ t: "remove", id }); },
      put(items) {
        const list = items.map(({ s, i }) => ({ ...copyStroke(s), i }));
        apply({ t: "put", strokes: list });
        send({ t: "put", strokes: list });
      },
      clear() { apply({ t: "clear" }); send({ t: "clear" }); },
    },
    gemini: {
      list: geminiInk,
      remove(id) { applyGeminiInk({ t: "gi-remove", id }); send({ t: "gi-remove", id }); },
      put(items) {
        for (const { s } of items) {
          applyGeminiInk({ t: "gi-start", stroke: copyStroke(s) });
          send({ t: "gi-start", stroke: copyStroke(s) });
          send({ t: "gi-end", id: s.id });
        }
      },
      clear() { applyGeminiInk({ t: "gi-clear" }); send({ t: "gi-clear" }); },
    },
  };

  function record(name, before, after) {
    const steps = hist[name];
    steps.undo.push({ before, after });
    if (steps.undo.length > HISTORY_MAX) steps.undo.shift();
    steps.redo.length = 0;
    updateButtons();
  }

  // Turn the strokes in `from` into the strokes in `to`.
  function applyStep(name, from, to) {
    const board = boards[name];
    const keep = new Set(to.map(({ s }) => s.id));
    from.forEach(({ s }) => {
      if (!keep.has(s.id) && board.list.some((other) => other.id === s.id)) board.remove(s.id);
    });
    if (to.length) board.put(to);
    pruneSelection();
    updateButtons();
  }

  function undoAction() {
    const name = activeBoard();
    const steps = hist[name];
    let step = steps.undo.pop();
    if (!step) {
      // Ink that was already on the board when this page opened: take the newest stroke off.
      const board = boards[name];
      const last = [...board.list].reverse().find((stroke) => stroke !== current && stroke !== geminiCurrent && !live.has(stroke.id));
      if (!last) return;
      step = { before: [], after: [itemOf(board.list, last)] };
    }
    applyStep(name, step.after, step.before);
    steps.redo.push(step);
  }

  function redoAction() {
    const name = activeBoard();
    const steps = hist[name];
    const step = steps.redo.pop();
    if (!step) return;
    applyStep(name, step.before, step.after);
    steps.undo.push(step);
    updateButtons();
  }

  el.undo.addEventListener("click", undoAction);
  el.redo.addEventListener("click", redoAction);

  // Clear is one step too, so a slip is one Undo away. On Gemini's board it clears only
  // the writing: Gemini's steps stay until it starts a new problem.
  el.clear.addEventListener("click", () => {
    const name = activeBoard();
    const board = boards[name];
    const items = board.list.filter((stroke) => stroke !== current && stroke !== geminiCurrent).map((stroke) => itemOf(board.list, stroke));
    if (!items.length) return;
    record(name, items, []);
    board.clear();
    clearSelection();
    updateButtons();
    toast("Cleared", { label: "Undo", run: undoAction });
  });

  // A quick zigzag over ink rubs out what it crosses, like iPadOS. Returns true when it did.
  function scribbleErase(name, stroke) {
    const Ink = window.SkybridgeInk;
    if (!Ink || stroke.eraser || stroke.hl || stroke.clean || !Ink.scribble(stroke.points)) return false;
    const board = boards[name];
    const hits = Ink.crossed(stroke.points, board.list, stroke).filter((other) => !live.has(other.id));
    if (!hits.length) return false;
    const before = hits.map((hit) => itemOf(board.list, hit));
    board.remove(stroke.id);
    hits.forEach((hit) => board.remove(hit.id));
    record(name, before, []);
    toast(`Erased ${hits.length} ${hits.length === 1 ? "stroke" : "strokes"}`, { label: "Undo", run: undoAction });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Lasso: circle ink, then drag it, resize it from a corner, recolour or delete it.
  // ---------------------------------------------------------------------------
  const Ink = () => window.SkybridgeInk;

  function selectionBounds() {
    const points = lasso.selected.flatMap((stroke) => stroke.points.map(([x, y]) => [x, y]));
    const reach = Math.max(...lasso.selected.map((stroke) => stroke.width / 2), 2) + 4;
    return Ink().bounds(points, reach);
  }

  function positionLasso() {
    if (!lasso.selected.length) {
      el.lassoBox.hidden = true;
      return;
    }
    const [x0, y0, x1, y1] = selectionBounds();
    const left = (x0 - view.x) * view.zoom;
    const top = (y0 - view.y) * view.zoom;
    Object.assign(el.lassoBox.style, { left: `${left}px`, top: `${top}px`, width: `${(x1 - x0) * view.zoom}px`, height: `${(y1 - y0) * view.zoom}px` });
    el.lassoEdit.hidden = !(lasso.selected.length === 1 && lasso.selected[0].text);
    renderTextTools();
    // One straight line selected: its two ends become handles to pull, instead of the corners.
    const ends = lasso.selected.length === 1 ? lineEnds(lasso.selected[0]) : null;
    el.lassoBox.dataset.line = String(Boolean(ends));
    if (ends) {
      el.lassoEnds.forEach((node) => {
        const point = ends[node.dataset.end === "a" ? 0 : 1];
        node.style.left = `${(point[0] - x0) * view.zoom}px`;
        node.style.top = `${(point[1] - y0) * view.zoom}px`;
      });
    }
    el.lassoBox.hidden = false;
  }

  // A stroke that is one straight line (a held-still line, or a drawn one that came out straight): its two ends.
  function lineEnds(stroke) {
    const pts = stroke.points;
    if (stroke.eraser || stroke.text || pts.length < 2) return null;
    const a = pts[0];
    const b = pts[pts.length - 1];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 16) return null;
    for (const point of pts) {
      const off = Math.abs((b[0] - a[0]) * (a[1] - point[1]) - (a[0] - point[0]) * (b[1] - a[1])) / length;
      if (off > 1.2) return null;
    }
    return [a, b];
  }

  // Edges and centres of everything else on the page, for the pink guides that show when things line up.
  function alignTargets(exclude) {
    const xs = [];
    const ys = [];
    for (const stroke of strokes) {
      if (stroke.eraser || exclude.has(stroke.id) || !stroke.points.length) continue;
      const [x0, y0, x1, y1] = Ink().bounds(stroke.points);
      for (const v of [x0, (x0 + x1) / 2, x1]) xs.push({ v, lo: y0, hi: y1 });
      for (const v of [y0, (y0 + y1) / 2, y1]) ys.push({ v, lo: x0, hi: x1 });
    }
    return { xs, ys };
  }

  // The closest target to any of the values, within the snapping reach (a few screen pixels).
  function nearestTarget(values, targets) {
    const reach = 7 / view.zoom;
    let best = null;
    for (const value of values) {
      for (const target of targets) {
        const gap = Math.abs(target.v - value);
        if (gap <= reach && (!best || gap < best.gap)) best = { gap, delta: target.v - value, target };
      }
    }
    return best;
  }

  function clearSelection() {
    lasso.selected = [];
    lasso.path = null;
    lasso.pointer = null;
    if (el.lassoBox) positionLasso();
  }

  // Strokes can change under the selection (an undo, another screen): follow them by id.
  function pruneSelection() {
    if (!lasso.selected.length) return;
    lasso.selected = lasso.selected.map((stroke) => strokes.find((other) => other.id === stroke.id)).filter(Boolean);
    positionLasso();
  }

  // The topmost ink within a fingertip of a board point (highlighter only if nothing else is there).
  function strokeAt(point) {
    const reach = 16 / view.zoom;
    let found = null;
    for (let i = strokes.length - 1; i >= 0; i -= 1) {
      const stroke = strokes[i];
      if (stroke.eraser || live.has(stroke.id) || stroke.points.length < 2) continue;
      if (stroke.text) {
        const [[ax, ay], [bx, by]] = stroke.points;
        if (point[0] >= Math.min(ax, bx) - reach && point[0] <= Math.max(ax, bx) + reach && point[1] >= Math.min(ay, by) - reach && point[1] <= Math.max(ay, by) + reach) return stroke;
        continue;
      }
      const near = reach + stroke.width / 2;
      for (let k = 1; k < stroke.points.length; k += 1) {
        const [ax, ay] = stroke.points[k - 1];
        const [bx, by] = stroke.points[k];
        const dx = bx - ax;
        const dy = by - ay;
        const t = dx || dy ? Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / (dx * dx + dy * dy))) : 0;
        if (Math.hypot(point[0] - (ax + t * dx), point[1] - (ay + t * dy)) <= near) {
          if (!stroke.hl) return stroke;
          found = found || stroke;
          break;
        }
      }
    }
    return found;
  }

  function finishLasso() {
    const path = lasso.path || [];
    lasso.path = null;
    lasso.pointer = null;
    const box = path.length > 3 ? Ink().bounds(path) : null;
    if (tool === "lasso" && (!box || Math.hypot(box[2] - box[0], box[3] - box[1]) * view.zoom <= 12) && path.length) {
      // A tap picks the stroke under the pen, so a line drawn earlier can be pulled by its ends.
      const hit = strokeAt(path[0]);
      if (hit) lasso.selected = [hit];
    } else if (box && Math.hypot(box[2] - box[0], box[3] - box[1]) * view.zoom > 30) {
      lasso.selected = strokes.filter((stroke) => {
        if (stroke.eraser || live.has(stroke.id) || !stroke.points.length) return false;
        if (stroke.text) {
          const [[ax, ay], [bx, by]] = stroke.points;
          const spots = [[ax, ay], [bx, by], [(ax + bx) / 2, (ay + by) / 2]];
          return spots.filter((spot) => Ink().inside(spot, path)).length >= 2;
        }
        const step = Math.max(1, Math.floor(stroke.points.length / 30));
        let inside = 0;
        let total = 0;
        for (let i = 0; i < stroke.points.length; i += step) {
          total += 1;
          if (Ink().inside(stroke.points[i], path)) inside += 1;
        }
        return inside / total >= 0.5;
      });
      if (!lasso.selected.length) toast("Nothing inside that loop");
    }
    if (tool === "matrix") {
      // One gesture per matrix: the loop picks the numbers and the brackets go on. The tool stays on
      // for the next matrix until another tool is picked.
      if (lasso.selected.length) addBrackets(false);
      clearSelection();
    }
    positionLasso();
    schedulePaint();
  }

  // Put new ink on My board as one undoable step; returns the strokes added.
  function addInk(lines, color, width) {
    const added = [];
    const items = [];
    for (const line of lines) {
      const stroke = { id: newId(), color, eraser: false, hl: false, width, sim: false, clean: true, points: line.points };
      const item = { s: stroke, i: strokes.length };
      boards.mine.put([item]);
      items.push(item);
      added.push(strokes.find((other) => other.id === stroke.id));
    }
    record("mine", [], items);
    lastBoard = "mine";
    return added.filter(Boolean);
  }

  // Square brackets around the selected numbers, skipping a side that already has one.
  function addBrackets(keepSelected) {
    const Marks = window.SkybridgeMarks;
    const picked = lasso.selected;
    if (!Marks || !picked.length) return;
    const spanOf = (stroke) => {
      const xs = stroke.points.map((p) => p[0]);
      const ys = stroke.points.map((p) => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    };
    const all = picked.map(spanOf);
    const union = [Math.min(...all.map((b) => b[0])), Math.min(...all.map((b) => b[1])), Math.max(...all.map((b) => b[2])), Math.max(...all.map((b) => b[3]))];
    const near = { left: false, right: false };
    // Brackets already in the selection (it was circled with them) count as present and aren't wrapped again.
    const core = picked.filter((stroke, i) => {
      const [bx0, by0, bx1, by1] = all[i];
      const uh = union[3] - union[1];
      const uw = union[2] - union[0];
      if (picked.length < 3 || by1 - by0 < uh * 0.9 || bx1 - bx0 > (by1 - by0) * 0.45) return false;
      const cx = (bx0 + bx1) / 2;
      if (cx < union[0] + uw * 0.2) near.left = true;
      else if (cx > union[2] - uw * 0.2) near.right = true;
      else return false;
      return true;
    });
    const rest = picked.filter((stroke) => !core.includes(stroke));
    const body = rest.length ? rest : picked;
    const spans = body.map(spanOf);
    const box = [Math.min(...spans.map((b) => b[0])), Math.min(...spans.map((b) => b[1])), Math.max(...spans.map((b) => b[2])), Math.max(...spans.map((b) => b[3]))];
    const h = Math.max(1, box[3] - box[1]);
    for (const other of strokes) {
      if (picked.includes(other) || other.eraser || other.hl || !other.points.length) continue;
      const ox = other.points.map((p) => p[0]);
      const oy = other.points.map((p) => p[1]);
      const w = Math.max(...ox) - Math.min(...ox);
      const oh = Math.max(...oy) - Math.min(...oy);
      if (oh < h * 0.7 || oh > h * 2.2 || w > oh * 0.45) continue; // tall and thin, like a bracket
      // Beside these numbers, not beside another matrix above or below.
      if (Math.min(Math.max(...oy), box[3]) - Math.max(Math.min(...oy), box[1]) < h * 0.6) continue;
      const cx = (Math.max(...ox) + Math.min(...ox)) / 2;
      const reach = Math.max(60, h * 0.5);
      if (Math.abs(cx - box[0]) < reach) near.left = true;
      if (Math.abs(cx - box[2]) < reach) near.right = true;
    }
    if (near.left && near.right) { toast("Already has brackets"); return; }
    const made = Marks.brackets(box, { left: !near.left, right: !near.right });
    const color = tool === "matrix" || tool === "lasso" ? (picked[0]?.color || pen) : pen;
    const added = addInk(made.strokes, color, picked[0]?.width || settings.width);
    if (keepSelected) {
      lasso.selected = [...picked, ...added];
      positionLasso();
    }
    toast("Brackets added", { label: "Undo", run: undoAction });
  }

  el.lassoBrackets.addEventListener("click", () => addBrackets(true));

  // Selection sidebar, Text section: font, size and bold for the typed text in the selection (a pinned problem is typed text too).
  const textSelected = () => lasso.selected.filter((stroke) => stroke.text);
  function renderTextTools() {
    const picked = textSelected();
    el.lassoTextTools.hidden = !picked.length;
    if (!picked.length) return;
    const fonts = new Set(picked.map((stroke) => stroke.font));
    el.lassoTextTools.querySelectorAll("[data-lfont]").forEach((button) => button.setAttribute("aria-pressed", String(fonts.size === 1 && fonts.has(button.dataset.lfont))));
    el.lassoBold.setAttribute("aria-pressed", String(picked.every((stroke) => (stroke.weight || 0) >= 2)));
  }
  async function styleText(change) {
    const picked = textSelected();
    if (!picked.length) return;
    if (change.font) { try { await document.fonts.load(`20px ${TEXT_FAMILIES[change.font]}`); } catch {} }
    const before = picked.map((stroke) => itemOf(strokes, stroke));
    const after = picked.map((old) => {
      const [[x0, y0], [x1, y1]] = old.points;
      const lines = old.text.split("\n").length;
      let size = Math.abs(y1 - y0) / lines / TEXT_LINE;
      if (change.sizeBy) size = Math.max(10, Math.min(90, Math.round(size + change.sizeBy)));
      const font = change.font || old.font;
      const box = textBox(old.text, size, font);
      const left = Math.min(x0, x1);
      const top = Math.min(y0, y1);
      return { s: { ...copyStroke(old), font, weight: change.weight ?? old.weight ?? 0, points: [[left, top], [left + box.width, top + box.height]] }, i: strokes.indexOf(old) };
    });
    boards.mine.put(after);
    record("mine", before, after);
    lastBoard = "mine";
    const ids = new Set(lasso.selected.map((stroke) => stroke.id));
    lasso.selected = strokes.filter((stroke) => ids.has(stroke.id));
    rebuildBase();
    positionLasso();
    schedulePaint();
  }
  el.lassoTextTools.querySelectorAll("[data-lfont]").forEach((button) => button.addEventListener("click", () => styleText({ font: button.dataset.lfont })));
  el.lassoSizeDown.addEventListener("click", () => styleText({ sizeBy: -2 }));
  el.lassoSizeUp.addEventListener("click", () => styleText({ sizeBy: 2 }));
  el.lassoBold.addEventListener("click", () => styleText({ weight: el.lassoBold.getAttribute("aria-pressed") === "true" ? 0 : 2 }));
  let textTarget = null; // the text item being edited, or null for a new one
  // To text: the selected writing is read (by the PC or by Gemini) and shown to copy.
  el.lassoText.addEventListener("click", async () => {
    const picked = lasso.selected.filter((stroke) => !stroke.text);
    if (!picked.length || !window.SkybridgeSmart) { if (lasso.selected.length) toast("That is already typed text"); return; }
    el.lassoText.disabled = true;
    el.lassoText.textContent = "Reading…";
    try {
      const result = await window.SkybridgeSmart.convert(picked);
      if (!result.ok) { toast(result.error); return; }
      if (!result.text) { toast("Couldn't find any writing to read there."); return; }
      el.textOut.value = result.text;
      textTarget = null;
      el.textPlace.textContent = "Place on page";
      el.textSheet.hidden = false;
      el.textOut.focus();
      el.textOut.setSelectionRange(0, 0);
    } finally {
      el.lassoText.disabled = false;
      el.lassoText.textContent = "To text";
    }
  });
  el.textClose.addEventListener("click", () => { el.textSheet.hidden = true; textTarget = null; });

  // Place on page: the text becomes a movable item under the writing it came from (or in view when edited
  // from the lasso). Edit reopens the sheet for the selected text and Update changes it in place.
  el.lassoEdit.addEventListener("click", () => {
    const item = lasso.selected.length === 1 ? lasso.selected[0] : null;
    if (!item?.text) return;
    textTarget = item.id;
    el.textOut.value = item.text;
    el.textPlace.textContent = "Update text";
    el.textSheet.hidden = false;
    el.textOut.focus();
  });
  el.textPlace.addEventListener("click", () => {
    const text = el.textOut.value.replace(/\s+$/, "");
    if (!text.trim()) { toast("Nothing to place yet"); return; }
    const old = textTarget ? strokes.find((stroke) => stroke.id === textTarget) : null;
    let made;
    if (old) {
      const [[x0, y0], [, y1]] = old.points;
      const size = Math.min(80, Math.max(10, Math.abs(y1 - y0) / old.text.split("\n").length / TEXT_LINE));
      const box = textBox(text, size, old.font);
      made = { ...copyStroke(old), text, points: [[x0, y0], [x0 + box.width, y0 + box.height]] };
      const before = [itemOf(strokes, old)];
      const item = { s: made, i: strokes.indexOf(old) };
      boards.mine.put([item]);
      record("mine", before, [item]);
    } else {
      const size = 26;
      let x = view.x + 60 / view.zoom;
      let y = view.y + 90 / view.zoom;
      if (lasso.selected.length) {
        // Just under the writing it came from.
        const [x0, , , y1] = selectionBounds();
        x = x0;
        y = y1 + 28;
      }
      const font = settings.card.font in TEXT_FAMILIES ? settings.card.font : "hand";
      const box = textBox(text, size, font);
      made = { id: newId(), color: "ink", eraser: false, hl: false, width: 1, sim: false, clean: true, text, font, points: [[x, y], [x + box.width, y + box.height]] };
      const item = { s: made, i: strokes.length };
      boards.mine.put([item]);
      record("mine", [], [item]);
    }
    lastBoard = "mine";
    lasso.selected = strokes.filter((stroke) => stroke.id === made.id);
    textTarget = null;
    el.textSheet.hidden = true;
    rebuildBase();
    positionLasso();
    schedulePaint();
    toast(old ? "Text updated" : "Placed on the page", { label: "Undo", run: undoAction });
  });
  el.textCopy.addEventListener("click", async () => {
    const text = el.textOut.value;
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      // Clipboard blocked: select it so Copy from the keyboard menu works.
      el.textOut.focus();
      el.textOut.select();
      toast("Select all, then Copy");
    }
  });

  // A copy of the selection beside it (or below it when there is no room), picked so it can be dragged.
  el.lassoDuplicate.addEventListener("click", () => {
    const picked = lasso.selected;
    if (!picked.length) return;
    const [x0, y0, x1, y1] = selectionBounds();
    const rect = el.canvas.getBoundingClientRect();
    const right = view.x + rect.width / view.zoom;
    const sideways = x1 + 36 + (x1 - x0) < right - 16;
    const dx = sideways ? x1 - x0 + 36 : 0;
    const dy = sideways ? 0 : y1 - y0 + 36;
    const items = [];
    for (const stroke of picked) {
      const copy = copyStroke(stroke);
      copy.id = newId();
      copy.points = copy.points.map(([x, y, ...rest]) => [Math.round((x + dx) * 10) / 10, Math.round((y + dy) * 10) / 10, ...rest]);
      const item = { s: copy, i: strokes.length };
      boards.mine.put([item]);
      items.push(item);
    }
    record("mine", [], items);
    const ids = new Set(items.map(({ s }) => s.id));
    lasso.selected = strokes.filter((stroke) => ids.has(stroke.id));
    positionLasso();
    toast(`Duplicated ${picked.length} ${picked.length === 1 ? "stroke" : "strokes"}`, { label: "Undo", run: undoAction });
  });

  // Dragging the box moves the selection; a corner scales it around the opposite corner.
  let lassoDrag = null;
  el.lassoBox.addEventListener("pointerdown", (event) => {
    if (event.target.closest("#lassoBar")) return;
    event.preventDefault();
    event.stopPropagation();
    try { el.lassoBox.setPointerCapture(event.pointerId); } catch {}
    lassoDrag = {
      pointer: event.pointerId,
      corner: event.target.dataset?.corner || "",
      end: event.target.dataset?.end || "",
      from: [event.clientX, event.clientY],
      box: selectionBounds(),
      raw: Ink().bounds(lasso.selected.flatMap((stroke) => stroke.points)),
      targets: alignTargets(new Set(lasso.selected.map((stroke) => stroke.id))),
      before: lasso.selected.map((stroke) => itemOf(strokes, stroke)),
      origin: lasso.selected.map((stroke) => stroke.points.map((point) => [...point])),
      moved: false,
    };
  });

  el.lassoBox.addEventListener("pointermove", (event) => {
    if (!lassoDrag || event.pointerId !== lassoDrag.pointer) return;
    const dx = (event.clientX - lassoDrag.from[0]) / view.zoom;
    const dy = (event.clientY - lassoDrag.from[1]) / view.zoom;
    if (!lassoDrag.moved && Math.hypot(dx, dy) * view.zoom < 3) return;
    lassoDrag.moved = true;
    const [x0, y0, x1, y1] = lassoDrag.box;
    let map = ([x, y]) => [x + dx, y + dy];
    guides = [];
    if (lassoDrag.end) {
      pullEnd(dx, dy);
      return;
    }
    if (!lassoDrag.corner) {
      // Moving: edges and centre line up with other ink, and a pink guide shows what lined up.
      const [rx0, ry0, rx1, ry1] = lassoDrag.raw;
      const mx0 = rx0 + dx, mx1 = rx1 + dx, my0 = ry0 + dy, my1 = ry1 + dy;
      const sx = nearestTarget([mx0, (mx0 + mx1) / 2, mx1], lassoDrag.targets.xs);
      const sy = nearestTarget([my0, (my0 + my1) / 2, my1], lassoDrag.targets.ys);
      const ox = sx ? sx.delta : 0;
      const oy = sy ? sy.delta : 0;
      map = ([x, y]) => [x + dx + ox, y + dy + oy];
      if (sx) guides.push({ x: sx.target.v, from: Math.min(sx.target.lo, my0 + oy), to: Math.max(sx.target.hi, my1 + oy) });
      if (sy) guides.push({ y: sy.target.v, from: Math.min(sy.target.lo, mx0 + ox), to: Math.max(sy.target.hi, mx1 + ox) });
    }
    if (lassoDrag.corner) {
      const east = lassoDrag.corner.includes("e");
      const south = lassoDrag.corner.includes("s");
      const anchor = [east ? x0 : x1, south ? y0 : y1];
      const handle = [east ? x1 : x0, south ? y1 : y0];
      const reach = Math.hypot(handle[0] - anchor[0], handle[1] - anchor[1]) || 1;
      const now = Math.hypot(handle[0] + dx - anchor[0], handle[1] + dy - anchor[1]);
      const scale = Math.min(10, Math.max(0.1, now / reach));
      map = ([x, y]) => [anchor[0] + (x - anchor[0]) * scale, anchor[1] + (y - anchor[1]) * scale];
    }
    lasso.selected.forEach((stroke, index) => {
      stroke.points = lassoDrag.origin[index].map((point) => {
        const [x, y] = map(point);
        return point.length > 2 ? [Math.round(x * 10) / 10, Math.round(y * 10) / 10, point[2]] : [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
      });
    });
    rebuildBase();
    schedulePaint();
    positionLasso();
  });

  // Pulling one end of a straight line: it stays straight, snaps level, upright or 45 degrees when
  // close, and lines up with other ink (pink guides).
  function pullEnd(dx, dy) {
    const first = lassoDrag.end === "a";
    const pts = lassoDrag.origin[0];
    const fixed = first ? pts[pts.length - 1] : pts[0];
    const moving = first ? pts[0] : pts[pts.length - 1];
    let x = moving[0] + dx;
    let y = moving[1] + dy;
    const length = Math.hypot(x - fixed[0], y - fixed[1]);
    const angle = Math.atan2(y - fixed[1], x - fixed[0]);
    const step = Math.PI / 4;
    const nearest = Math.round(angle / step) * step;
    let pinX = false;
    let pinY = false;
    if (length > 0 && Math.abs(angle - nearest) < (5 * Math.PI) / 180) {
      x = fixed[0] + Math.cos(nearest) * length;
      y = fixed[1] + Math.sin(nearest) * length;
      pinX = Math.abs(Math.cos(nearest)) < 1e-6;
      pinY = Math.abs(Math.sin(nearest)) < 1e-6;
    }
    if (!pinX) {
      const sx = nearestTarget([x], lassoDrag.targets.xs);
      if (sx) { x += sx.delta; guides.push({ x: sx.target.v, from: Math.min(sx.target.lo, y, fixed[1]), to: Math.max(sx.target.hi, y, fixed[1]) }); }
    }
    if (!pinY) {
      const sy = nearestTarget([y], lassoDrag.targets.ys);
      if (sy) { y += sy.delta; guides.push({ y: sy.target.v, from: Math.min(sy.target.lo, x, fixed[0]), to: Math.max(sy.target.hi, x, fixed[0]) }); }
    }
    const span = Math.hypot(x - fixed[0], y - fixed[1]);
    const count = Math.max(2, Math.ceil(span / 10) + 1);
    const pressure = pts[0].length > 2 ? pts[0][2] : null;
    const line = [];
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1);
      const px = Math.round((fixed[0] + (x - fixed[0]) * t) * 10) / 10;
      const py = Math.round((fixed[1] + (y - fixed[1]) * t) * 10) / 10;
      line.push(pressure === null ? [px, py] : [px, py, pressure]);
    }
    lasso.selected[0].points = first ? line.reverse() : line;
    rebuildBase();
    schedulePaint();
    positionLasso();
  }

  function endLassoDrag(event) {
    if (!lassoDrag || event.pointerId !== lassoDrag.pointer) return;
    const drag = lassoDrag;
    lassoDrag = null;
    guides = [];
    schedulePaint();
    if (!drag.moved) return;
    const after = lasso.selected.map((stroke) => itemOf(strokes, stroke));
    record("mine", drag.before, after);
    send({ t: "put", strokes: after.map(({ s, i }) => ({ ...s, i })) });
  }
  el.lassoBox.addEventListener("pointerup", endLassoDrag);
  el.lassoBox.addEventListener("pointercancel", endLassoDrag);
  el.lassoBox.addEventListener("touchstart", (event) => { if (!event.target.closest("button")) event.preventDefault(); }, { passive: false });

  function recolorSelection(color) {
    if (!lasso.selected.length) return;
    const before = lasso.selected.map((stroke) => itemOf(strokes, stroke));
    lasso.selected.forEach((stroke) => { stroke.color = color; });
    const after = lasso.selected.map((stroke) => itemOf(strokes, stroke));
    record("mine", before, after);
    send({ t: "put", strokes: after.map(({ s, i }) => ({ ...s, i })) });
    rebuildBase();
    schedulePaint();
  }

  el.lassoDelete.addEventListener("click", () => {
    const before = lasso.selected.map((stroke) => itemOf(strokes, stroke));
    if (!before.length) return;
    record("mine", before, []);
    before.forEach(({ s }) => boards.mine.remove(s.id));
    clearSelection();
    toast(`Deleted ${before.length} ${before.length === 1 ? "stroke" : "strokes"}`, { label: "Undo", run: undoAction });
  });
  el.lassoColor.addEventListener("click", () => el.colorBtn.click());
  el.lassoDone.addEventListener("click", clearSelection);

  el.send.addEventListener("click", () => {
    if (!connected) return;
    if (!pcOpen) { toast("Open Skybridge on your PC first"); return; }
    send({ t: "send", board: activeBoard() });
    toast("Sending");
  });

  // ---------------------------------------------------------------------------
  // Check my work and the mic controls. They run on the PC page; the verdict comes back as text.
  // ---------------------------------------------------------------------------
  // After a check, write the result on the board: "Correct!" beside finished work, or a ring around
  // the entry that is wrong. It is ordinary ink (one Undo takes it off), and never says the answer.
  let markIds = [];
  async function markWork({ verdict, box }) {
    const Marks = window.SkybridgeMarks;
    if (!Marks || (verdict !== "correct" && !(verdict === "wrong" && box))) return;
    const work = strokes.filter((stroke) => !stroke.eraser && !stroke.hl && !stroke.pin && !markIds.includes(stroke.id) && stroke.points.length);
    if (verdict === "correct" && !work.length) return;
    let made;
    if (verdict === "correct") {
      const xs = work.flatMap((stroke) => stroke.points.map((point) => point[0]));
      const ys = work.flatMap((stroke) => stroke.points.map((point) => point[1]));
      const ink = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
      const rect = el.canvas.getBoundingClientRect();
      made = Marks.correct(ink, { x1: view.x + rect.width / view.zoom, y1: view.y + rect.height / view.zoom });
    } else {
      made = Marks.circle(box);
    }
    // A new check replaces the marks the last one left.
    const old = strokes.filter((stroke) => markIds.includes(stroke.id)).map((stroke) => itemOf(strokes, stroke));
    for (const { s } of old) boards.mine.remove(s.id);
    markIds = [];
    const added = [];
    for (const line of made.strokes) {
      const stroke = { id: newId(), color: line.color, eraser: false, hl: false, width: line.width, sim: false, clean: true, points: line.points };
      const item = { s: stroke, i: strokes.length };
      boards.mine.put([item]);
      added.push(item);
      markIds.push(stroke.id);
      await new Promise((resolve) => setTimeout(resolve, 110));
    }
    if (made.label) {
      const { text, size, color, x, y } = made.label;
      const box = textBox(text, size, "inter");
      const stroke = { id: newId(), color, eraser: false, hl: false, width: 1, sim: false, clean: true, text, font: "inter", points: [[x, y], [x + box.width, y + box.height]] };
      const item = { s: stroke, i: strokes.length };
      boards.mine.put([item]);
      added.push(item);
      markIds.push(stroke.id);
    }
    record("mine", old, added);
    lastBoard = "mine";
  }

  function showVerdict({ ok, live, text, error, verdict, box }) {
    checking = false;
    el.verdict.hidden = false;
    el.verdict.dataset.state = ok ? "ok" : "error";
    el.verdictTitle.textContent = ok ? (live ? "Gemini is checking" : "Check my work") : "Couldn't check";
    el.verdictText.textContent = ok ? (live ? "Gemini is reading your board. Listen for the answer." : text || "Checked.") : error || "The check failed.";
    updateButtons();
    if (ok && !live) markWork({ verdict, box });
    if (ok && !live && verdict === "correct" && nb?.folder && !nb.done) {
      setPageDone(nb.id, true).then(() => { toast("Marked done in the folder"); renderNotebookList(); });
    }
  }

  async function checkWithoutPc() {
    checking = true;
    el.verdict.hidden = false;
    el.verdict.dataset.state = "ok";
    el.verdictTitle.textContent = "Check my work";
    el.verdictText.textContent = "Reading your page, then checking the numbers…";
    updateButtons();
    // A local model can think for minutes: show that it is working, and let the student stop it.
    const stop = window.SkybridgeLocal?.onProgress((info) => {
      if (!checking || info.phase === "done") { el.verdictCancel.hidden = true; return; }
      const doing = info.phase === "writing" ? "writing the answer" : info.phase === "waiting" ? "waiting for a first reply" : "thinking";
      el.verdictText.textContent = `Local model is ${doing}… ${info.seconds} s${info.fast ? " (Fast mode)" : ""}`;
      el.verdictCancel.hidden = false;
    });
    const result = await window.SkybridgeSmart.check();
    stop?.();
    el.verdictCancel.hidden = true;
    showVerdict(result);
  }

  el.check.addEventListener("click", () => {
    if (checking) return;
    if (!(connected && pcOpen)) {
      // No PC: Gemini reads the page with your own key, and the numbers are checked here, exactly.
      if (window.SkybridgeSmart) checkWithoutPc();
      return;
    }
    // The check reads My board, with Gemini's problem on it; writing on Gemini's board isn't read.
    checking = true;
    el.verdict.hidden = false;
    el.verdict.dataset.state = "ok";
    el.verdictTitle.textContent = "Check my work";
    el.verdictText.textContent = "Checking your work...";
    send({ t: "check" });
    updateButtons();
    // A PC that never answers shouldn't leave the button stuck.
    setTimeout(() => { if (checking) showVerdict({ ok: false, error: "No answer from the PC. Is Skybridge open?" }); }, 90000);
  });
  el.verdictCancel.addEventListener("click", () => window.SkybridgeLocal?.cancel());
  el.verdictClose.addEventListener("click", () => { el.verdict.hidden = true; });

  // Mute and Done speaking show only while a Live session runs on the PC.
  function renderSession(info) {
    const live = Boolean(info?.live);
    el.liveControls.hidden = !live;
    document.documentElement.dataset.live = live ? "on" : "off";
    el.mute.setAttribute("aria-pressed", String(Boolean(info?.muted)));
    el.mute.textContent = info?.muted ? "Unmute" : "Mute";
  }
  el.mute.addEventListener("click", () => send({ t: "control", action: "mute" }));
  el.done.addEventListener("click", () => { send({ t: "control", action: "done" }); });

  let toastTimer = 0;
  // A toast can carry one action, like Undo after a Clear: { label, run }.
  function toast(text, action) {
    el.toast.replaceChildren(text);
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", () => {
        el.toast.hidden = true;
        action.run();
      });
      el.toast.append(button);
    }
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    if (action?.sticky) return; // stays until tapped (a new board is ready)
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, Math.max(action ? 7000 : 2600, String(text).length * 70));
  }


  // ---------------------------------------------------------------------------
  // Notebooks, saved on this iPad (notebooks.js), so the board works without the PC.
  // The PC relay mirrors the open notebook while it is reachable.
  // ---------------------------------------------------------------------------
  const Notebooks = window.SkybridgeNotebooks;
  let saveTimer = 0;
  let saving = Promise.resolve();

  // Ink changed (not just the view): save it, and let the page reader know it will need reading.
  let lastChangeAt = 0;
  function contentChanged() {
    lastChangeAt = Date.now();
    queueSave();
    window.SkybridgeSmart?.touched();
  }

  function queueSave(delay = 500) {
    if (!nb) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, delay);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    if (!nb) return saving;
    const id = nb.id;
    const data = {
      strokes: strokes.filter((stroke) => stroke.points?.length).map(copyStroke),
      view: { x: view.x, y: view.y, zoom: view.zoom },
      meta: { unsynced: nb.unsynced, seen: nb.seen || 0 },
    };
    saving = saving
      .then(() => Notebooks.save(id, data))
      .then((meta) => { if (meta && nb && nb.id === id) { nb.updated = meta.updated; nb.count = meta.count; } })
      .catch(() => {});
    return saving;
  }

  // Put a loaded notebook on the board.
  function showNotebook(found) {
    nb = found.meta;
    Notebooks.setCurrent(nb.id);
    strokes.length = 0;
    live.clear();
    for (const stroke of found.strokes) strokes.push({ ...stroke, done: true });
    hist.mine.undo.length = 0;
    hist.mine.redo.length = 0;
    clearSelection();
    moveView(found.view?.x || 0, found.view?.y || 0, found.view?.zoom || 1);
    rebuildBase();
    schedulePaint();
    updateButtons();
    renderNotebookUi();
    showPracticeCard(nb.problem);
  }

  // A practice problem belongs to its notebook: its card goes when you leave, and comes back when you return.
  // (A card Gemini put there from the PC is not touched.)
  async function showPracticeCard(problem) {
    const card = el.stage.querySelector(".my-board-problem");
    if (card?._practice) card.remove();
    if (!problem || !whiteboard || !window.SkybridgePractice) return;
    if (problem.pinned) return; // it is written on the page itself (Pin to page)
    await whiteboard.draw({ board: "mine", clear: true, title: problem.title, items: window.SkybridgePractice.items(problem) });
    const fresh = el.stage.querySelector(".my-board-problem");
    if (fresh) {
      fresh._practice = true;
      if (!fresh.querySelector(".practice-next")) {
        const next = document.createElement("button");
        next.type = "button";
        next.className = "my-board-problem-hide practice-next";
        next.textContent = "Next problem";
        next.addEventListener("click", problem.source === "homework" ? nextHomework : nextPractice);
        const pin = document.createElement("button");
        pin.type = "button";
        pin.className = "my-board-problem-hide practice-next card-pin";
        pin.textContent = "Pin to page";
        pin.title = "Write the problem on the paper itself, so it moves and zooms with your work";
        pin.addEventListener("click", pinProblem);
        fresh.append(next, pin);
      }
      decorateCard(fresh);
    }
  }

  // ---- Pin to page: the problem becomes text on the paper (a movable text item, not your writing) ----
  const latexPlain = (text) => String(text || "")
    .replace(/\\(?:left|right|,|;|!|quad|qquad)/g, " ").replace(/\\cdot/g, "·").replace(/\\times/g, "×").replace(/\\pm/g, "±")
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, a, b) => (/^[\w.]+$/.test(a) && /^[\w.]+$/.test(b) ? `${a}/${b}` : `(${a})/(${b})`))
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)").replace(/\^\{([^{}]*)\}/g, "^$1").replace(/_\{([^{}]*)\}/g, "_$1")
    .replace(/\\([a-zA-Z]+)/g, "$1").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
  function matrixBlock(body) {
    const rows = body.split(/\\\\/).map((row) => row.split("&").map((cell) => latexPlain(cell))).filter((row) => row.some(Boolean));
    if (!rows.length) return [];
    const columns = Math.max(...rows.map((row) => row.length));
    const widths = Array.from({ length: columns }, (_, c) => Math.max(...rows.map((row) => (row[c] || "").length)));
    const cells = rows.map((row) => widths.map((width, c) => (row[c] || "").padStart(width)).join("  "));
    if (cells.length === 1) return [`[ ${cells[0]} ]`];
    return cells.map((row, i) => `${i === 0 ? "┌" : i === cells.length - 1 ? "└" : "│"} ${row} ${i === 0 ? "┐" : i === cells.length - 1 ? "┘" : "│"}`);
  }
  // One given line ("A = [matrix] B = [matrix]" or an equation) as lines of plain monospace text.
  function givenLines(latex) {
    const blocks = [];
    let last = 0;
    const pattern = /\\begin\{[bpvBV]?matrix\}([\s\S]*?)\\end\{[bpvBV]?matrix\}/g;
    for (let hit = pattern.exec(latex); hit; hit = pattern.exec(latex)) {
      const label = latexPlain(latex.slice(last, hit.index));
      if (label) blocks.push([label]);
      blocks.push(matrixBlock(hit[1]));
      last = pattern.lastIndex;
    }
    const rest = latexPlain(latex.slice(last));
    if (rest) blocks.push([rest]);
    const height = Math.max(1, ...blocks.map((block) => block.length));
    const middle = Math.floor((height - 1) / 2);
    const out = Array.from({ length: height }, () => []);
    for (const block of blocks) {
      const width = Math.max(...block.map((line) => [...line].length));
      const top = block.length === 1 ? middle : 0;
      for (let i = 0; i < height; i += 1) out[i].push((block[i - top] || "").padEnd(width));
    }
    return out.map((parts) => parts.join(" ").replace(/\s+$/, ""));
  }
  const wrapWords = (text, max) => {
    const lines = [];
    let line = "";
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
      if (line && line.length + word.length + 1 > max) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
    return lines;
  };
  function problemAsText(problem) {
    const out = [problem.title, ""];
    out.push(...wrapWords(problem.text, 46));
    for (const line of problem.lines || []) out.push("", ...givenLines(line));
    return out.join("\n").replace(/\n+$/, "");
  }
  // A given line as pieces: text labels and matrices (rows of cells).
  function givenPieces(latex) {
    const pieces = [];
    let last = 0;
    const pattern = /\\begin\{[bpvBV]?matrix\}([\s\S]*?)\\end\{[bpvBV]?matrix\}/g;
    for (let hit = pattern.exec(latex); hit; hit = pattern.exec(latex)) {
      const label = latexPlain(latex.slice(last, hit.index));
      if (label) pieces.push({ label });
      const rows = hit[1].split(/\\\\/).map((row) => row.split("&").map((cell) => latexPlain(cell))).filter((row) => row.some(Boolean));
      if (rows.length) pieces.push({ rows });
      last = pattern.lastIndex;
    }
    const rest = latexPlain(latex.slice(last));
    if (rest) pieces.push({ label: rest });
    return pieces;
  }

  // The problem as strokes: the words as text, every matrix as a grid of entries with brackets drawn to its size.
  // All carry pin (so Check my work never reads them) and pg (so they restyle together).
  // The look of the card above the page: the same font, size and colours, so pinning changes nothing you can see.
  const CARD_PX = { s: 17, m: 19, l: 22, xl: 26 };
  // The colour the card is really showing for a part of it (so "Auto" matches too), as #rrggbb.
  function shownColor(selector) {
    const node = el.stage.querySelector(`.my-board-problem ${selector}`);
    const hit = node && /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(node).color);
    return hit ? `#${[hit[1], hit[2], hit[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}` : null;
  }
  function pinStyle() {
    const card = settings.card;
    return {
      font: card.font in TEXT_FAMILIES ? card.font : "inter",
      size: CARD_PX[card.size] || 22,
      weight: settings.pin.weight,
      color: cardColor(card.text) || shownColor(".wb-text, .wb-note") || "ink",
      titleColor: cardColor(card.title) || shownColor(".wb-title") || "#8a94a0",
      ink: settings.pin.ink,
    };
  }
  function pinStrokes(problem, style, x, y, pg) {
    const Marks = window.SkybridgeMarks;
    const size = style.size;
    const font = style.font in TEXT_FAMILIES ? style.font : "inter";
    const base = { eraser: false, hl: false, width: 1, sim: false, clean: true, pin: true, pg };
    const out = [];
    // The wording: plain text, in the chosen font and colour.
    const words = (text, left, top, color = style.color, scale = 1) => {
      const box = textBox(text, size * scale, font);
      out.push({ ...base, id: newId(), color, weight: style.weight, text, font, points: [[left, top], [left + box.width, top + box.height]] });
      return box;
    };
    // The drawing: pencil in the matrix ink colour (labels like "A =" in the hand font).
    const label = (text, left, top, scale = 1) => {
      const box = textBox(text, size * scale, "hand");
      out.push({ ...base, id: newId(), color: style.ink, weight: 0, text, font: "hand", points: [[left, top], [left + box.width, top + box.height]] });
      return box;
    };
    const titleBox = words(problem.title || "", x, y, style.titleColor, 1.25);
    const body = wrapWords(problem.text, Math.max(24, Math.round(1000 / size))).join("\n");
    let top = y + titleBox.height + size * 0.6;
    top += words(body, x, top).height + size * 0.9;
    const pencil = (strokes, width) => strokes.forEach((line) => out.push({ ...base, id: newId(), color: style.ink, width, points: line.points }));
    const digit = size * 0.8; // height of an entry
    const rowH = size * 1.55;
    const gapX = size * 1.0;
    for (const line of problem.lines || []) {
      const pieces = givenPieces(line);
      const measured = pieces.map((piece) => {
        if (piece.label) { const box = textBox(piece.label, size * 1.15, "hand"); return { piece, width: box.width, height: box.height }; }
        const cells = piece.rows.map((row, r) => row.map((cell, c) => (cell ? Marks?.numeral(cell, 0, 0, digit) || { text: cell, width: textBox(cell, size, "hand").width } : { width: 0 })));
        const columns = Math.max(...cells.map((row) => row.length));
        const widths = Array.from({ length: columns }, (_, c) => Math.max(...cells.map((row) => row[c]?.width || 0)));
        return { piece, cells, widths, width: widths.reduce((a, b) => a + b, 0) + gapX * (columns - 1), height: piece.rows.length * rowH };
      });
      const lineH = Math.max(size * TEXT_LINE, ...measured.map((m) => m.height));
      let left = x; // flush with the wording above
      for (const m of measured) {
        if (m.piece.label) {
          label(m.piece.label, left, top + (lineH - m.height) / 2, 1.15);
          left += m.width + size * 0.3;
          continue;
        }
        // The left bracket stands a little outside the entries: leave room for it, plus a steady gap after the label.
        const bracketGap = Marks ? Marks.brackets([0, 0, 1, (m.piece.rows.length - 1) * rowH + digit], {}).gap : 20;
        left += bracketGap + size * 0.45;
        const originY = top + (lineH - m.height) / 2;
        const rowTop = (r) => originY + r * rowH + (rowH - digit) / 2;
        m.piece.rows.forEach((row, r) => {
          let cx = left;
          row.forEach((cell, c) => {
            const made = m.cells[r][c];
            if (cell) {
              const at = cx + (m.widths[c] - made.width) / 2;
              if (made.text) label(made.text, at, rowTop(r) + digit / 2 - (size * TEXT_LINE) / 2);
              else pencil(Marks.numeral(cell, at, rowTop(r), digit).strokes, 2);
            }
            cx += m.widths[c] + gapX;
          });
        });
        const box = [left, rowTop(0), left + m.width, rowTop(m.piece.rows.length - 1) + digit];
        const marks = Marks ? Marks.brackets(box, {}) : { strokes: [] };
        pencil(marks.strokes, 2.2);
        left += m.width + bracketGap + size * 0.9;
      }
      top += lineH + size * 1.2;
    }
    return out;
  }

  // The problem written as pinned text at (x, y), for pages whose problem was never pinned (folder export).
  async function pinnedStrokes(problem, x, y) {
    const style = pinStyle();
    try { await document.fonts.load(`${style.size}px ${TEXT_FAMILIES[style.font] || TEXT_FAMILIES.hand}`); } catch {}
    return pinStrokes(problem, style, x, y, newId());
  }

  async function pinProblem() {
    const problem = nb?.problem;
    if (!problem || problem.pinned) return;
    const style = pinStyle();
    try { await document.fonts.load(`${style.size}px ${TEXT_FAMILIES[style.font] || TEXT_FAMILIES.hand}`); } catch {}
    const x = view.x + 120 / view.zoom; // clear of the tool rail
    const y = view.y + 84 / view.zoom;
    const made = pinStrokes(problem, style, x, y, newId());
    const items = made.map((s, k) => ({ s, i: strokes.length + k }));
    boards.mine.put(items);
    record("mine", [], items);
    lastBoard = "mine";
    nb.problem = { ...problem, pinned: true };
    saving = saving.then(() => Notebooks.save(nb.id, { meta: { problem: nb.problem }, touch: false })).catch(() => {});
    el.stage.querySelector(".my-board-problem")?._practice && showPracticeCard(nb.problem);
    const ids = new Set(made.map((s) => s.id));
    lasso.selected = strokes.filter((stroke) => ids.has(stroke.id));
    rebuildBase();
    positionLasso();
    schedulePaint();
    toast("Pinned to the page. Lasso it to move it.", { label: "Undo", run: unpinProblem });
  }

  // Write the pinned problem again in the style chosen in Settings, where it sits now.
  function restylePin() {
    const old = strokes.filter((stroke) => stroke.pin);
    const problem = nb?.problem;
    if (!old.length || !problem?.pinned) { toast("No pinned problem on this page"); return; }
    const anchor = (old.find((stroke) => stroke.text) || old[0]).points;
    const x = Math.min(anchor[0][0], anchor[1][0]);
    const y = Math.min(anchor[0][1], anchor[1][1]);
    const before = old.map((stroke) => itemOf(strokes, stroke));
    const made = pinStrokes(problem, pinStyle(), x, y, newId());
    before.forEach(({ s }) => boards.mine.remove(s.id));
    const items = made.map((s, k) => ({ s, i: strokes.length + k }));
    boards.mine.put(items);
    record("mine", before, items);
    lastBoard = "mine";
    const ids = new Set(made.map((s) => s.id));
    lasso.selected = strokes.filter((stroke) => ids.has(stroke.id));
    rebuildBase();
    positionLasso();
    schedulePaint();
    toast("Pinned problem restyled", { label: "Undo", run: undoAction });
  }
  el.pinRestyle.addEventListener("click", restylePin);

  // Settings: the choices, a preview drawn by the same code that pins, and the Restyle button.
  function renderPinSettings() {
    const look = settings.pin;
    for (const container of [el.pinWeight, el.pinInk]) {
      const key = container === el.pinWeight ? "weight" : "ink";
      container.querySelectorAll("[data-value]").forEach((button) => button.setAttribute("aria-checked", String(button.dataset.value === String(look[key]))));
    }
    el.pinRestyle.hidden = !(nb?.problem?.pinned && strokes.some((stroke) => stroke.pin));
    // The preview is drawn again once the chosen font has loaded.
    const shown = pinStyle();
    const fontKey = `${shown.size}px ${TEXT_FAMILIES[shown.font] || TEXT_FAMILIES.hand}`;
    if (renderPinSettings.loaded !== fontKey) {
      renderPinSettings.loaded = fontKey;
      document.fonts.load(fontKey).then(() => { if (renderPinSettings.loaded === fontKey) renderPinSettings(); }, () => {});
    }
    try {
      const canvas = el.pinPreview;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const sample = { title: "1B", text: "Find the inverse of A.", lines: ["A = \\begin{bmatrix} 1 & 2 & 1 \\\\ 5 & 12 & -1 \\end{bmatrix}"] };
      const made = pinStrokes(sample, shown, 0, 0, "preview");
      const xs = made.flatMap((s) => s.points.map((p) => p[0]));
      const ys = made.flatMap((s) => s.points.map((p) => p[1]));
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const scale = Math.min(1, (canvas.width - 32) / (Math.max(...xs) - minX || 1), (canvas.height - 32) / (Math.max(...ys) - minY || 1));
      ctx.save();
      ctx.translate(16 - minX * scale, 16 - minY * scale);
      ctx.scale(scale, scale);
      made.forEach((stroke) => drawStroke(ctx, stroke));
      ctx.restore();
    } catch {}
  }

  function unpinProblem() {
    undoAction();
    if (!nb?.problem?.pinned) return;
    nb.problem = { ...nb.problem, pinned: false };
    saving = saving.then(() => Notebooks.save(nb.id, { meta: { problem: nb.problem }, touch: false })).catch(() => {});
    showPracticeCard(nb.problem);
  }

  // Put a practice problem on this page, or in a new notebook. It comes from the bank on this iPad when
  // there is one waiting (no call at all), and from one call that fills the bank when there isn't.
  let practiceBusy = false;
  async function placePractice(pick, where) {
    const Practice = window.SkybridgePractice;
    if (!Practice || practiceBusy) return;
    practiceBusy = true;
    el.practiceGo.disabled = true;
    el.practiceGo.textContent = "Getting a problem…";
    try {
      const made = await Practice.take(pick);
      if (!made.ok) { toast(made.error, !window.SkybridgeAI.hasKey() ? { label: "Open", run: () => { openSmartTab(); } } : undefined); return; }
      if (where === "new") {
        await newNotebook();
        const label = Practice.TOPICS.find((t) => t.id === made.problem.topic)?.label || made.problem.title;
        await Notebooks.rename(nb.id, label);
        Object.assign(nb, { name: label, named: true });
      }
      nb.problem = made.problem;
      saving = saving.then(() => Notebooks.save(nb.id, { meta: { problem: made.problem }, touch: false })).catch(() => {});
      await showPracticeCard(made.problem);
      el.notebookSheet.hidden = true;
      el.notebookBtn.setAttribute("aria-expanded", "false");
      renderNotebookUi();
      toast(made.fromBank ? `Practice problem ready (${made.left} more saved)` : "Practice problem ready. Write your work below it.");
    } finally {
      practiceBusy = false;
      el.practiceGo.disabled = false;
      el.practiceGo.textContent = "Make a problem";
    }
  }
  const makePractice = () => placePractice(el.practiceTopic.value, el.practiceWhere.value);
  // "Next problem" on the card: another one of the same kind. A page with your work on it stays as it is.
  const nextPractice = () => {
    const worked = strokes.filter((stroke) => !stroke.eraser && !stroke.pin).length >= 3;
    return placePractice(nb?.problem?.pick || nb?.problem?.topic || el.practiceTopic.value, worked ? "new" : "page");
  };
  // ---- homework PDFs: the problems Gemini read out of an imported PDF (see homework.js) ----------------
  const Homework = window.SkybridgeHomework;
  const hw = {
    set: document.getElementById("homeworkSet"),
    problem: document.getElementById("homeworkProblem"),
    where: document.getElementById("homeworkWhere"),
    prev: document.getElementById("homeworkPrev"),
    next: document.getElementById("homeworkNext"),
    preview: document.getElementById("homeworkPreview"),
    info: document.getElementById("homeworkInfo"),
    go: document.getElementById("homeworkGo"),
    folder: document.getElementById("homeworkFolder"),
    pick: document.getElementById("homeworkPick"),
    out: document.getElementById("homeworkOut"),
    file: document.getElementById("homeworkFile"),
    importBtn: document.getElementById("homeworkImport"),
    remove: document.getElementById("homeworkRemove"),
  };
  async function renderHomework(select) {
    if (!Homework) return;
    const sets = await Homework.list();
    hw.pick.hidden = !sets.length;
    hw.out.textContent = sets.length ? `${sets.length} saved` : "";
    hw.set.replaceChildren(...sets.map((set) => Object.assign(document.createElement("option"), { value: set.id, textContent: `${set.name} (${set.problems.length})` })));
    if (select && sets.some((set) => set.id === select)) hw.set.value = select;
    await renderHomeworkProblems();
  }
  let hwSet = null;
  async function renderHomeworkProblems(index) {
    hwSet = hw.set.value ? await Homework.get(hw.set.value) : null;
    hw.problem.replaceChildren(...(hwSet?.problems || []).map((item, i) => Object.assign(document.createElement("option"), { value: String(i), textContent: item.label })));
    if (index != null) hw.problem.value = String(index);
    renderHomeworkStep();
  }
  // The arrows, the one-line preview of the chosen problem, and what read this PDF.
  function renderHomeworkStep() {
    const count = hwSet?.problems.length || 0;
    const at = Math.max(0, hw.problem.selectedIndex);
    hw.prev.disabled = at <= 0;
    hw.next.disabled = at >= count - 1;
    const item = hwSet?.problems[at];
    hw.preview.textContent = item ? [item.text, ...item.lines.slice(0, 1)].filter(Boolean).join(" ").replace(/\\begin\{[a-z]*matrix\}.*?\\end\{[a-z]*matrix\}/g, "[matrix]") : "";
    const Engine = window.SkybridgeEngine;
    const by = hwSet ? { local: "your local model, page by page", gemini: "Gemini" }[hwSet.by] : "";
    hw.info.textContent = hwSet
      ? `${by ? `Read by ${by}. ` : ""}The problems stay on this iPad, so the same PDF is never read again. Answers printed in the PDF are never shown.`
      : `A new PDF is read once (${Engine ? Engine.planText("homework") : "Gemini"}) and split into problems (1A, 1B...). Answers printed in the PDF are never shown.`;
  }
  const whereValue = () => hw.where.querySelector('[aria-checked="true"]')?.dataset.where || "page";
  function setWhere(value) {
    hw.where.querySelectorAll("button").forEach((button) => button.setAttribute("aria-checked", String(button.dataset.where === value)));
  }

  // Put one homework problem on this page, or in a new notebook. No call: it was read when the PDF came in.
  async function placeHomework(setId, index, where) {
    const set = await Homework.get(setId);
    const problem = set && Homework.problemOf(set, index);
    if (!problem || practiceBusy) return;
    practiceBusy = true;
    try {
      if (where === "new") {
        await newNotebook();
        const label = `${set.name} ${problem.title}`.slice(0, 40);
        await Notebooks.rename(nb.id, label);
        Object.assign(nb, { name: label, named: true });
      }
      nb.problem = problem;
      saving = saving.then(() => Notebooks.save(nb.id, { meta: { problem }, touch: false })).catch(() => {});
      await showPracticeCard(problem);
      el.notebookSheet.hidden = true;
      el.notebookBtn.setAttribute("aria-expanded", "false");
      renderNotebookUi();
      toast(`${set.name} ${problem.title}. Write your work below it.`);
    } finally {
      practiceBusy = false;
    }
  }
  // "Next problem" on a homework card: the next one in the same PDF (a page with your work stays as it is).
  const nextHomework = async () => {
    const problem = nb?.problem;
    if (!problem?.set) return;
    const set = await Homework.get(problem.set);
    if (!set) { toast("That homework was removed from this iPad."); return; }
    if (problem.index + 1 >= set.problems.length) { toast(`That was the last problem in ${set.name}.`); return; }
    if (nb.folder) {
      // In a homework folder the next problem already has its own page.
      const next = (await Notebooks.pagesOf(nb.folder)).find((page) => (page.order || 0) === problem.index + 1);
      if (next) { await openNotebook(next.id); return; }
    }
    const worked = strokes.filter((stroke) => !stroke.eraser && !stroke.pin).length >= 3;
    await placeHomework(set.id, problem.index + 1, worked ? "new" : "page");
  };
  if (Homework) {
    renderHomework();
    Homework.onChange(() => renderHomework(hw.set.value));
    hw.set.addEventListener("change", () => renderHomeworkProblems());
    const where = storage("get", "skybridge.homeworkWhere");
    if (where === "page" || where === "new") setWhere(where);
    hw.where.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => { setWhere(button.dataset.where); storage("set", "skybridge.homeworkWhere", button.dataset.where); }));
    hw.problem.addEventListener("change", renderHomeworkStep);
    const step = (by) => { const next = hw.problem.selectedIndex + by; if (next >= 0 && next < hw.problem.options.length) { hw.problem.selectedIndex = next; renderHomeworkStep(); } };
    hw.prev.addEventListener("click", () => step(-1));
    hw.next.addEventListener("click", () => step(1));
    window.SkybridgeEngine?.onChange(renderHomeworkStep);
    hw.go.addEventListener("click", () => placeHomework(hw.set.value, Number(hw.problem.value) || 0, whereValue()));
    hw.folder.addEventListener("click", () => makeHomeworkFolder(hw.set.value));
    hw.importBtn.addEventListener("click", () => hw.file.click());
    hw.file.addEventListener("change", async () => {
      const file = hw.file.files?.[0];
      hw.file.value = "";
      if (!file) return;
      hw.importBtn.disabled = true;
      hw.importBtn.textContent = "Reading the PDF…";
      toast("Reading the PDF. This takes a little while, and only happens once.");
      try {
        const made = await Homework.importPdf(file, { onProgress: (text) => { hw.importBtn.textContent = text; } });
        if (!made.ok) { toast(made.error, !window.SkybridgeAI.hasKey() ? { label: "Open", run: () => { openSmartTab(); } } : undefined); return; }
        await renderHomework(made.set.id);
        toast(made.cached ? `Already saved: ${made.set.name}, ${made.set.problems.length} problems (no call needed)` : `Found ${made.set.problems.length} problems in ${made.set.name}${made.note ? `, but ${made.note}` : ""}`);
      } finally {
        hw.importBtn.disabled = false;
        hw.importBtn.textContent = "Import a PDF";
      }
    });
    hw.remove.addEventListener("click", async () => {
      const removed = await Homework.remove(hw.set.value);
      if (removed) toast(`Removed ${removed.name}`, { label: "Undo", run: () => Homework.restore(removed) });
    });
  }

  function renderPracticeCount() {
    window.SkybridgePractice?.counts().then((count) => {
      el.practiceOut.textContent = count.total ? `${count.total} saved` : "";
    });
  }
  window.SkybridgePractice?.onChange(renderPracticeCount);
  renderPracticeCount();
  el.practiceGo.addEventListener("click", makePractice);
  if (window.SkybridgePractice) {
    for (const topic of window.SkybridgePractice.TOPICS) {
      const option = document.createElement("option");
      option.value = topic.id;
      option.textContent = topic.label;
      el.practiceTopic.append(option);
    }
    el.practiceTopic.value = storage("get", "skybridge.practiceTopic") || "random";
    el.practiceTopic.addEventListener("change", () => storage("set", "skybridge.practiceTopic", el.practiceTopic.value));
    const where = storage("get", "skybridge.practiceWhere");
    if (where === "page" || where === "new") el.practiceWhere.value = where;
    el.practiceWhere.addEventListener("change", () => storage("set", "skybridge.practiceWhere", el.practiceWhere.value));
  }

  async function openNotebook(id) {
    if (nb && nb.id === id) return;
    await saveNow();
    const found = await Notebooks.load(id);
    if (!found) return;
    showNotebook(found);
    if (connected) pushNotebook();
  }

  async function newNotebook() {
    await saveNow();
    const meta = await Notebooks.create();
    showNotebook(await Notebooks.load(meta.id));
    if (connected) pushNotebook();
    toast(`${meta.name} started`);
  }

  async function deleteNotebook(id) {
    const wasOpen = nb && nb.id === id;
    if (wasOpen) await saveNow();
    const removed = await Notebooks.remove(id);
    if (!removed) return;
    if (wasOpen) {
      const rest = await Notebooks.list();
      if (rest.length) showNotebook(await Notebooks.load(rest[0].id));
      else showNotebook(await Notebooks.load((await Notebooks.create()).id));
      if (connected) pushNotebook();
    }
    renderNotebookList();
    toast(`Deleted ${removed.meta.name}`, {
      label: "Undo",
      run: async () => {
        await Notebooks.restore(removed);
        if (wasOpen) await openNotebook(removed.meta.id);
        renderNotebookList();
      },
    });
  }

  function ago(time) {
    const minutes = Math.round((Date.now() - time) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  const ICON_PENCIL = '<path d="m12.5 4.5 3 3M4 16l.7-3.3L13.6 3.8a1.4 1.4 0 0 1 2 0l.6.6a1.4 1.4 0 0 1 0 2l-8.9 8.9z"/>';
  const ICON_TRASH = '<path d="M4.5 6h11M8 6V4.2h4V6M6 6l.6 9.5h6.8L14 6"/>';
  const ICON_REFRESH = '<path d="M16 10a6 6 0 1 1-1.8-4.2M16 3.5v3h-3"/>';
  const ICON_CHECK = '<path d="m4.5 10.5 3.5 3.5 7.5-8"/>';
  function iconButton(button, label, path) {
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${path}</svg>`;
  }

  // Smart features footer: how many pages were read in the background this session, and which app version is running.
  async function renderBgReads() {
    const log = window.SkybridgeSmart?.readLog?.() || [];
    let version = "";
    try { version = (await caches.keys()).find((name) => name.startsWith("skybridge-board-"))?.slice("skybridge-board-".length) || ""; } catch {}
    const auto = log.filter((item) => !item.manual).length;
    const last = log[log.length - 1];
    el.bgReads.textContent = `Pages read this session: ${auto} in the background, ${log.length - auto} when asked${last ? `. Last: “${last.name}” at ${new Date(last.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}. A named page is not read again. App version ${version || "unknown"}.`;
  }
  window.SkybridgeSmart?.onStatus?.(renderBgReads);
  el.notebookBtn.addEventListener("click", renderBgReads);
  el.updateApp.addEventListener("click", async () => {
    try {
      for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
      for (const name of await caches.keys()) if (name.startsWith("skybridge-board-")) await caches.delete(name);
    } catch {}
    location.reload();
  });

  function makeNotebookRow(book, snippet, query) {
    const open = nb && nb.id === book.id;
    if (open) Object.assign(book, { name: nb.name, count: strokes.filter((stroke) => !stroke.eraser).length, updated: Math.max(book.updated, nb.updated || 0) });
    const row = document.createElement("li");
    row.className = "nb-item";
    if (open) row.setAttribute("aria-current", "true");
    const main = document.createElement("button");
    main.type = "button";
    main.className = "nb-open";
    const title = document.createElement("b");
    title.textContent = book.name;
    const note = document.createElement("small");
    note.textContent = `${ago(book.updated)} · ${book.count} ${book.count === 1 ? "stroke" : "strokes"}`;
    main.append(title, note);
    if (book.tags?.length) {
      const tags = document.createElement("span");
      tags.className = "nb-tags";
      for (const tag of book.tags) {
        const chip = document.createElement("i");
        chip.textContent = tag;
        tags.append(chip);
      }
      main.append(tags);
    }
    if (query && snippet) {
      const found = document.createElement("small");
      found.className = "nb-snippet";
      found.textContent = snippet;
      main.append(found);
    }
    main.addEventListener("click", async () => { await openNotebook(book.id); el.notebookSheet.hidden = true; el.notebookBtn.setAttribute("aria-expanded", "false"); });
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "nb-act";
    iconButton(rename, "Rename", ICON_PENCIL);
    rename.addEventListener("click", () => editName(row, main, rename, book));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "nb-act danger";
    iconButton(remove, "Delete", ICON_TRASH);
    remove.addEventListener("click", () => deleteNotebook(book.id));
    const reread = document.createElement("button");
    reread.type = "button";
    reread.className = "nb-act";
    iconButton(reread, "Read this page again", ICON_REFRESH);
    reread.addEventListener("click", async () => {
      reread.disabled = true;
      try { toast(await window.SkybridgeSmart.reread(book.id)); } finally { reread.disabled = false; renderNotebookList(); }
    });
    const actions = document.createElement("span");
    actions.className = "nb-acts";
    actions.append(rename, ...(window.SkybridgeSmart?.reread ? [reread] : []), remove);
    if (book.folder) {
      row.classList.add("nb-page");
      row.dataset.done = String(!!book.done);
      const tick = document.createElement("button");
      tick.type = "button";
      tick.className = "nb-tick";
      tick.setAttribute("role", "checkbox");
      tick.setAttribute("aria-checked", String(!!book.done));
      iconButton(tick, book.done ? "Done. Tap to undo" : "Mark done", ICON_CHECK);
      tick.addEventListener("click", async () => { await setPageDone(book.id, !book.done); renderNotebookList(); });
      row.append(tick);
    }
    row.append(main, actions);
    return row;

  }

  // ---- homework folders: a folder per homework, one page per problem, a bar of how many are done ----
  const openFolders = new Set();
  const closedFolders = new Set();
  const ICON_CHEVRON = '<path d="m7 4.5 5.5 5.5L7 15.5"/>';

  async function setPageDone(id, finished) {
    const meta = await Notebooks.setDone(id, finished);
    if (meta && nb && nb.id === id) nb.done = meta.done;
    return meta;
  }

  function makeFolderRows(folder, kids) {
    const total = kids.length;
    const finished = kids.filter((page) => page.done).length;
    const expanded = openFolders.has(folder.id);
    const head = document.createElement("li");
    head.className = "nb-folder";
    head.dataset.open = String(expanded);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nb-open nb-folder-main";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.innerHTML = `<svg class="nb-chevron" viewBox="0 0 20 20" aria-hidden="true">${ICON_CHEVRON}</svg>`;
    const text = document.createElement("span");
    text.className = "nb-folder-text";
    const title = document.createElement("b");
    title.textContent = folder.name;
    const note = document.createElement("small");
    note.textContent = total ? `${finished} of ${total} problems done` : "No problems";
    const bar = document.createElement("span");
    bar.className = "nb-bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(total));
    bar.setAttribute("aria-valuenow", String(finished));
    const fill = document.createElement("i");
    fill.style.width = total ? `${Math.round((finished / total) * 100)}%` : "0%";
    bar.append(fill);
    text.append(title, note, bar);
    toggle.append(text);
    toggle.addEventListener("click", () => {
      if (expanded) { openFolders.delete(folder.id); closedFolders.add(folder.id); } else { openFolders.add(folder.id); closedFolders.delete(folder.id); }
      renderNotebookList();
    });
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "nb-act";
    iconButton(rename, "Rename folder", ICON_PENCIL);
    rename.addEventListener("click", async () => {
      const name = prompt("Folder name", folder.name);
      if (name && await Notebooks.renameFolder(folder.id, name)) renderNotebookList();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "nb-act danger";
    iconButton(remove, "Delete folder and its pages", ICON_TRASH);
    remove.addEventListener("click", () => deleteFolder(folder.id));
    const actions = document.createElement("span");
    actions.className = "nb-acts";
    actions.append(rename, remove);
    head.append(toggle, actions);
    const rows = [head];
    if (expanded) {
      for (const page of kids) rows.push(makeNotebookRow(page, "", ""));
      const foot = document.createElement("li");
      foot.className = "nb-folder-foot";
      const label = document.createElement("small");
      label.textContent = "Hand it in:";
      const pdf = document.createElement("button");
      pdf.type = "button";
      pdf.className = "nb-btn";
      pdf.textContent = "Combined PDF";
      const photos = document.createElement("button");
      photos.type = "button";
      photos.className = "nb-btn";
      photos.textContent = "Photos";
      for (const [button, kind] of [[pdf, "pdf"], [photos, "photos"]]) {
        button.disabled = !total || !window.SkybridgeExport?.exportFolder;
        button.addEventListener("click", async () => {
          const was = button.textContent;
          pdf.disabled = photos.disabled = true;
          button.textContent = "Working…";
          try {
            await saveNow();
            const message = await window.SkybridgeExport.exportFolder(folder.id, kind);
            if (message) toast(message);
          } catch (error) {
            toast(error?.message || "Couldn't export");
          } finally {
            button.textContent = was;
            pdf.disabled = photos.disabled = false;
          }
        });
      }
      foot.append(label, pdf, photos);
      rows.push(foot);
    }
    return rows;
  }

  async function deleteFolder(id) {
    if (nb?.folder === id) await saveNow();
    const removed = await Notebooks.removeFolder(id);
    if (!removed) return;
    if (nb && removed.pages.some((page) => page.meta.id === nb.id)) {
      const rest = await Notebooks.list();
      showNotebook(await Notebooks.load(rest.length ? rest[0].id : (await Notebooks.create()).id));
      if (connected) pushNotebook();
    }
    renderNotebookList();
    toast(`Deleted ${removed.folder.name} and its ${removed.pages.length} pages`, {
      label: "Undo",
      run: async () => { await Notebooks.restoreFolder(removed); renderNotebookList(); },
    });
  }

  // One page per problem, in order, each with the problem ready to pin. Made from the Homework tab.
  async function makeHomeworkFolder(setId) {
    const set = await Homework.get(setId);
    if (!set) return;
    const folders = await Notebooks.listFolders();
    const existing = folders.find((folder) => folder.set === set.id);
    if (existing) {
      openFolders.add(existing.id);
      closedFolders.delete(existing.id);
      toast(`${set.name} already has a folder`);
      showNbPage("books", true);
      renderNotebookList();
      return;
    }
    await saveNow();
    const folder = await Notebooks.createFolder(set.name, { set: set.id });
    let first = null;
    for (let i = 0; i < set.problems.length; i += 1) {
      const problem = Homework.problemOf(set, i);
      const made = await Notebooks.create(`${set.name} ${problem.title}`.slice(0, 60));
      await Notebooks.save(made.id, { meta: { problem, folder: folder.id, order: i, done: false, named: true }, touch: false });
      first = first || made.id;
    }
    openFolders.add(folder.id);
    closedFolders.delete(folder.id);
    if (first) showNotebook(await Notebooks.load(first));
    if (connected) pushNotebook();
    renderNotebookList();
    toast(`Made a folder for ${set.name}: ${set.problems.length} pages`);
  }

  async function renderNotebookList() {
    if (el.notebookSheet.hidden) return;
    const Smart = window.SkybridgeSmart;
    const query = el.notebookSearch.value.trim();
    const results = Smart ? await Smart.search(query) : (await Notebooks.list()).map((meta) => ({ meta, snippet: "" }));
    if (query && !results.length) {
      const none = document.createElement("li");
      none.className = "nb-none";
      none.textContent = Smart?.pending?.() ? "Nothing found yet. Some pages haven't been read, so their handwriting isn't searchable." : "Nothing found.";
      el.notebookList.replaceChildren(none);
      return;
    }
    const rows = [];
    if (query) {
      rows.push(...results.map(({ meta: book, snippet }) => makeNotebookRow(book, snippet, query)));
    } else {
      const folders = await Notebooks.listFolders();
      const pages = await Notebooks.list();
      for (const folder of folders) {
        const kids = pages.filter((page) => page.folder === folder.id).sort((a, b) => (a.order || 0) - (b.order || 0));
        if (kids.some((page) => nb && page.id === nb.id) && !closedFolders.has(folder.id)) openFolders.add(folder.id);
        rows.push(...makeFolderRows(folder, kids));
      }
      const byId = new Map(results.map(({ meta, snippet }) => [meta.id, { meta, snippet }]));
      for (const { meta: book, snippet } of byId.values()) if (!book.folder || !folders.some((f) => f.id === book.folder)) rows.push(makeNotebookRow(book, snippet, query));
    }
    el.notebookList.replaceChildren(...rows);
  }

  function editName(row, main, rename, book) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = book.name;
    input.maxLength = 80;
    input.setAttribute("aria-label", "Notebook name");
    row.replaceChild(input, main);
    iconButton(rename, "Save", ICON_CHECK);
    let finished = false;
    const finish = async (keep) => {
      if (finished) return;
      finished = true;
      const name = input.value.replace(/\s+/g, " ").trim();
      if (keep && name && name !== book.name) {
        const meta = await Notebooks.rename(book.id, name);
        if (meta && nb && nb.id === book.id) nb.name = meta.name;
        renderNotebookUi();
      }
      renderNotebookList();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") finish(true);
      else if (event.key === "Escape") finish(false);
    });
    rename.onclick = () => finish(true);
    input.focus();
    input.select();
  }

  function renderNotebookUi() {
    if (nb) el.notebookName.textContent = nb.name;
    el.notebookBtn.title = nb ? `Notebooks. Open: ${nb.name}` : "Notebooks";
    const standalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
    el.installNote.hidden = standalone || !window.isSecureContext;
    if (el.notebookSheet.hidden) return;
    let out = "Offline";
    let note = "Everything you write is saved on this iPad, and reaches your PC when it is on.";
    if (!code || (hosted && !host)) {
      out = "Not paired";
      note = hosted
        ? "This board works on its own. To also show it on your PC (so Gemini can see it), type the address and pairing code from Skybridge's iPad panel."
        : "Open the board from the QR code in Skybridge on your PC to pair it. Until then your notebooks stay on this iPad.";
    } else if (connected) {
      out = pcOpen ? "Live" : "Waiting for Skybridge";
      note = pcOpen ? "Changes reach My board on your PC as you write." : "Connected, but Skybridge isn't open on the PC.";
    } else if (nb?.unsynced) {
      note = "Changes are waiting to sync. They go to your PC when it is on and on the same Wi-Fi.";
    }
    renderSmartUi();
    if (Local) renderLocal();
    el.syncOut.textContent = out;
    el.syncNote.textContent = note;
    el.syncCodeRow.hidden = !hosted;
    if (document.activeElement !== el.syncHost) el.syncHost.value = host || (hosted ? "" : location.host);
    if (hosted && document.activeElement !== el.syncCode) el.syncCode.value = code || "";
    renderNotebookList();
  }

  // Notebooks and Smart features are two swipeable pages, like Pen and Paper. The last one is remembered.
  const NB_PAGES = ["books", "homework", "smart"];
  let nbPage = storage("get", "skybridge.nbPage");
  if (!NB_PAGES.includes(nbPage)) nbPage = "books";
  let nbLock = 0;
  function showNbPage(name, smooth) {
    nbPage = name;
    nbLock = performance.now() + (smooth ? 600 : 100);
    el.nbPages.scrollTo({ left: NB_PAGES.indexOf(name) * el.nbPages.clientWidth, behavior: smooth ? "smooth" : "auto" });
    el.nbTabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.page === name)));
  }
  el.nbTabs.forEach((tab) => tab.addEventListener("click", () => { storage("set", "skybridge.nbPage", tab.dataset.page); showNbPage(tab.dataset.page, true); }));
  el.nbPages.addEventListener("scroll", () => {
    if (performance.now() < nbLock) return;
    const name = NB_PAGES[Math.min(NB_PAGES.length - 1, Math.round(el.nbPages.scrollLeft / el.nbPages.clientWidth))];
    if (name === nbPage) return;
    nbPage = name;
    storage("set", "skybridge.nbPage", name);
    el.nbTabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.page === name)));
  }, { passive: true });
  function openSmartTab() {
    if (el.notebookSheet.hidden) el.notebookBtn.click();
    storage("set", "skybridge.nbPage", "smart");
    showNbPage("smart", false);
  }

  // ---- Smart features: today's free Gemini requests, and the local model ----------------------------
  const Local = window.SkybridgeLocal;
  const Engine = window.SkybridgeEngine;
  // Gemini Live has no daily cap, so it only shows a count.
  function liveRow() {
    const status = window.SkybridgeAI.liveStatus();
    const line = document.createElement("div");
    line.className = "usage-row live";
    const name = document.createElement("span");
    name.textContent = "Live (unlimited)";
    const bar = document.createElement("i");
    bar.style.setProperty("--used", "0%");
    const count = document.createElement("b");
    count.textContent = `${status.used} today`;
    line.append(name, bar, count);
    return line;
  }
  const Live = window.SkybridgeLive;
  function renderLive() {
    if (!Live) return;
    const cfg = Live.config();
    el.liveOn.value = cfg.on ? "on" : "off";
    el.liveModel.value = cfg.model;
    el.liveCheck.value = cfg.check ? "on" : "off";
    el.liveCheckRead.value = cfg.checkRead ? "on" : "off";
    el.liveThinking.value = cfg.thinking;
    el.liveThinkingRow.hidden = cfg.model !== "gemini-3.8-live-extended-thinking";
    const wanted = Engine ? (Engine.choice() === "live" || (Engine.live() && cfg.on)) : cfg.on;
    el.liveOut.textContent = !wanted ? (Engine && !Engine.live() ? "Not used (see What to use)" : "Off") : (window.SkybridgeAI.hasGeminiKey() ? "On" : "Needs a key");
    el.liveOut.dataset.state = wanted && window.SkybridgeAI.hasGeminiKey() ? "on" : "off";
    renderEngine();
  }
  if (Live) {
    for (const model of Live.MODELS) el.liveModel.append(Object.assign(document.createElement("option"), { value: model.id, textContent: model.label }));
    renderLive();
    el.liveOn.addEventListener("change", () => { Live.save({ on: el.liveOn.value === "on" }); renderLive(); });
    el.liveCheck.addEventListener("change", () => { Live.save({ check: el.liveCheck.value === "on" }); renderLive(); });
    for (const level of Live.THINKING) el.liveThinking.append(Object.assign(document.createElement("option"), { value: level.id, textContent: level.label }));
    el.liveThinking.value = Live.config().thinking;
    el.liveCheckRead.addEventListener("change", () => { Live.save({ checkRead: el.liveCheckRead.value === "on" }); renderLive(); });
    el.liveThinking.addEventListener("change", () => { Live.save({ thinking: el.liveThinking.value }); renderLive(); });
    el.liveModel.addEventListener("change", () => { Live.save({ model: el.liveModel.value }); renderLive(); });
    el.liveTest.addEventListener("click", async () => {
      if (!window.SkybridgeAI.hasGeminiKey()) { toast("Add your Gemini key first"); return; }
      el.liveTest.disabled = true;
      el.liveTest.textContent = "Trying…";
      el.liveResult.hidden = true;
      try {
        const result = await Live.test();
        el.liveResult.hidden = false;
        el.liveResult.dataset.state = result.ok ? "on" : "off";
        el.liveResult.textContent = result.ok
          ? `It read the test picture in ${(result.ms / 1000).toFixed(1)} s and said: "${result.text}".`
          : `Live didn't work: ${result.error} Flash will be used instead.`;
      } finally {
        el.liveTest.disabled = false;
        el.liveTest.textContent = "Test it";
        renderUsage();
      }
    });
  }

  function renderUsage() {
    const AI = window.SkybridgeAI;
    if (!AI?.usage) return;
    el.usageList.replaceChildren(...AI.usage().map((row) => {
      const line = document.createElement("div");
      line.className = "usage-row";
      line.dataset.full = String(row.used >= row.rpd || row.out);
      const name = document.createElement("span");
      name.textContent = row.label;
      const bar = document.createElement("i");
      bar.style.setProperty("--used", `${row.out ? 100 : Math.min(100, (row.used / row.rpd) * 100)}%`);
      const count = document.createElement("b");
      count.textContent = row.missing ? "not found" : row.out ? "used up today" : `${row.used} of ${row.rpd}`;
      line.append(name, bar, count);
      return line;
    }), liveRow());
    const liveWhy = window.SkybridgeAI.liveStatus();
    el.usageNote.textContent = (liveWhy.on && liveWhy.error ? `Live last said: ${liveWhy.error} ` : "") + "Free requests used today. The free key allows about 5 a minute and 20 a day per model, and the day starts again around midnight Pacific (3 AM Eastern). The quota belongs to your key, so Skybridge on the PC and AI Studio use it too, and this iPad only counts its own requests. When Google says a model is used up, its bar fills.";
  }
  window.SkybridgeAI?.onUsage(renderUsage);
  renderUsage();

  // ---- The master switch and the "which engine does what" table ----
  function renderEngine() {
    if (!Engine) return;
    if (!el.engineSeg.children.length) {
      for (const choice of Engine.CHOICES) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "radio");
        button.dataset.engine = choice.id;
        button.textContent = choice.id === "live" ? "Gemini Live" : choice.label;
        button.addEventListener("click", () => Engine.set(choice.id));
        el.engineSeg.append(button);
      }
    }
    for (const button of el.engineSeg.children) button.setAttribute("aria-checked", String(button.dataset.engine === Engine.choice()));
    el.engineHint.textContent = Engine.CHOICES.find((c) => c.id === Engine.choice()).hint;
    el.engineTable.replaceChildren(...Engine.FEATURES.map((feature) => {
      const row = document.createElement("div");
      row.className = "engine-row";
      row.setAttribute("role", "row");
      const name = document.createElement("b");
      name.textContent = feature.label;
      const will = document.createElement("span");
      will.className = "will";
      will.textContent = `Will use: ${Engine.planText(feature.id)}`;
      const last = document.createElement("span");
      last.className = "last";
      last.textContent = `Last time: ${Engine.lastText(feature.id)}`;
      if (Engine.last(feature.id)?.ok === false) last.dataset.state = "bad";
      row.append(name, will, last);
      return row;
    }));
  }
  if (Engine) {
    Engine.onChange(() => { renderEngine(); if (Local) renderLocal(); renderLive(); renderSmartUi(); });
    renderEngine();
  }

  function renderLocal() {
    if (!Local) return;
    const cfg = Local.config();
    const set = (node, value) => { if (document.activeElement !== node) node.value = value; };
    set(el.localUrl, cfg.url);
    el.localKey.placeholder = cfg.key ? "Saved. Paste a new key to replace it" : "Optional";
    set(el.localModel, cfg.model);
    el.localVision.value = cfg.vision ? "yes" : "no";
    el.localVia.value = cfg.via;
    el.localFast.value = cfg.fast ? "yes" : "no";
    el.localRoute.textContent = Local.explainRoute();
    const hasUrl = Boolean(Local.endpoint(cfg.url));
    const used = hasUrl && Engine.local();
    const on = used;
    el.localOut.textContent = !hasUrl ? "Not set" : used ? (Engine.choice() === "local" ? "Only this" : "Used first") : "Not used (see What to use)";
    el.localOut.dataset.state = on ? "on" : "off";
    el.localRemove.hidden = !cfg.url && !cfg.key;
    el.localPair.hidden = !Local.needsPair();
    renderEngine();
  }
  if (Local) {
    renderLocal();
    Local.attach({ ready: () => connected && pcOpen, send: (message) => send(message) });
    const saveLocal = (patch) => { Local.save(patch); renderLocal(); renderSmartUi(); };
    el.localUrl.addEventListener("change", () => saveLocal({ url: el.localUrl.value.trim() }));
    el.localModel.addEventListener("change", () => saveLocal({ model: el.localModel.value.trim() }));
    el.localKey.addEventListener("change", () => {
      const value = el.localKey.value.trim();
      el.localKey.value = "";
      if (value) { saveLocal({ key: value }); toast("Local key saved on this iPad"); }
    });
    el.localVision.addEventListener("change", () => saveLocal({ vision: el.localVision.value === "yes" }));
    el.localFast.addEventListener("change", () => saveLocal({ fast: el.localFast.value === "yes" }));
    el.localVia.addEventListener("change", () => { saveLocal({ via: el.localVia.value }); el.localResult.hidden = true; });
    el.localPair.addEventListener("click", () => {
      el.syncFold.open = true;
      el.syncFold.scrollIntoView({ block: "start", behavior: "smooth" });
      (el.syncHost.offsetParent ? el.syncHost : el.syncFold).focus?.({ preventScroll: true });
    });
    el.localRemove.addEventListener("click", () => { saveLocal({ url: "", key: "", model: "", vision: false, mode: "first", via: "auto" }); el.localResult.hidden = true; toast("Local model forgotten"); });
    el.localTest.addEventListener("click", async () => {
      el.localTest.disabled = true;
      el.localTest.textContent = "Trying…";
      el.localResult.hidden = true;
      try {
        const result = await Local.test();
        el.localResult.hidden = false;
        renderLocal();
        el.localResult.textContent = result.ok ? `It answered in ${(result.ms / 1000).toFixed(1)} s: "${result.text}".` : result.error;
        el.localResult.dataset.state = result.ok ? "on" : "off";
      } finally {
        el.localTest.disabled = false;
        el.localTest.textContent = "Test it";
      }
    });
  }

  function renderSmartUi() {
    const Smart = window.SkybridgeSmart;
    const AI = window.SkybridgeAI;
    if (!Smart || !AI) return;
    const keyed = AI.hasGeminiKey();
    const pending = Smart.pending();
    el.smartOut.textContent = (keyed ? "Key saved" : Local?.usable({ image: false }) ? "Local model" : pcOpen && connected ? "Using your PC" : "Off");
    el.smartOut.dataset.state = keyed || Local?.usable({ image: false }) || (pcOpen && connected) ? "on" : "off";
    el.smartNote.textContent = (Smart.status() ? `${Smart.status()} ` : "")
      + "Titles, tags and searchable handwriting for every page, and Check my work without your PC. "
      + "Pages are read by Skybridge when your PC is on, otherwise by your local model or Gemini with your own free key.";
    el.geminiKey.placeholder = keyed ? "Saved. Paste a new key to replace it" : "Paste your key";
    el.geminiKeyRemove.hidden = !keyed;
    renderEngine();
  }

  el.notebookSearch.addEventListener("input", renderNotebookList);
  el.geminiKey.addEventListener("change", () => {
    const value = el.geminiKey.value.trim();
    el.geminiKey.value = "";
    if (!value) return;
    window.SkybridgeAI.setKey(value);
    toast("Key saved on this iPad");
    window.SkybridgeSmart?.pump();
    renderNotebookUi();
  });
  el.smartNow.addEventListener("click", async () => {
    el.smartNow.disabled = true;
    toast("Reading your pages…");
    try { toast(await window.SkybridgeSmart.readNow()); } finally { el.smartNow.disabled = false; renderNotebookUi(); }
  });
  el.geminiKeyRemove.addEventListener("click", () => {
    window.SkybridgeAI.setKey("");
    toast("Key removed");
    renderNotebookUi();
  });

  el.notebookBtn.addEventListener("click", () => {
    const open = el.notebookSheet.hidden;
    setSettingsOpen(false);
    el.notebookSheet.hidden = !open;
    el.notebookBtn.setAttribute("aria-expanded", String(open));
    if (open) { renderNotebookUi(); renderUsage(); renderLocal(); renderLive(); showNbPage(nbPage, false); }
  });
  el.notebookNew.addEventListener("click", async () => { await newNotebook(); renderNotebookList(); });
  el.syncRetry.addEventListener("click", () => { retryNow(); toast("Looking for your PC"); });
  el.syncHost.addEventListener("change", () => {
    let value = el.syncHost.value.trim().replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "");
    // The secure port is the one a page served over https can reach.
    if (value && !value.includes(":") && location.protocol === "https:") value += ":8011";
    host = value && value !== location.host ? value : "";
    storage("set", HOST_KEY, host);
    el.offlineHost.textContent = host || location.host;
    retryNow();
  });
  el.syncCode.addEventListener("change", () => {
    code = el.syncCode.value.trim().toLowerCase();
    storage("set", CODE_KEY, code);
    retryNow();
  });

  async function startNotebooks() {
    try {
      await Notebooks.open();
      let found = null;
      const last = Notebooks.current();
      if (last) found = await Notebooks.load(last);
      if (!found) {
        const books = await Notebooks.list();
        if (books.length) found = await Notebooks.load(books[0].id);
      }
      if (!found) found = await Notebooks.load((await Notebooks.create()).id);
      showNotebook(found);
    } catch {
      // Notebooks are an extra: the board still works, connected to the PC as before.
    }
    window.SkybridgeSmart?.init({
      pcReady: () => connected && pcOpen,
      relaySend: (message) => send(message),
      problemText: () => window.SkybridgePractice?.problemText(nb?.problem) || "",
      openId: () => nb?.id,
      lastChange: () => lastChangeAt,
      refresh: () => renderNotebookUi(),
      // A label from a reader: saved on the notebook (and kept on the open one in memory).
      saveMeta(id, changes) {
        saving = saving
          .then(() => Notebooks.save(id, { meta: changes, touch: false }))
          .then(() => { if (nb && nb.id === id) Object.assign(nb, changes); renderNotebookUi(); })
          .catch(() => {});
        return saving;
      },
    });
    window.SkybridgeSmart?.onStatus(() => renderNotebookUi());
    // Naming happens quietly in the background, so say when it worked, and when and why it did not.
    window.SkybridgeSmart?.onNotice((text, openSettings) => {
      toast(text, openSettings ? {
        label: "Open",
        run: () => {
          openSmartTab();
        },
      } : undefined);
    });
    connect();
  }

  // Save when the page goes away, and keep the board for offline use (a service worker needs https).
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveNow(); });
  window.addEventListener("pagehide", saveNow);

  // Keeps the installed board current. A new version installs by itself; this asks the server for
  // one every time the app comes back to the front and every ten minutes, says so when one is ready
  // (the message stays until tapped), and reloads on its own when you return to the app and aren't writing.
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    let hadController = Boolean(navigator.serviceWorker.controller);
    let updateReady = false;
    const reloadNow = () => { saveNow(); location.reload(); };
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // First time: saved for offline use. Later: a newer board is ready.
      if (hadController) {
        updateReady = true;
        toast("A newer board is ready", { label: "Reload", run: reloadNow, sticky: true });
      } else toast("Saved for offline use");
      hadController = true;
    });
    navigator.serviceWorker.register("./sw.js").then((registration) => {
      const check = () => registration.update().catch(() => {});
      setInterval(check, 10 * 60000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        if (updateReady && document.documentElement.dataset.writing !== "on") reloadNow();
        else check();
      });
      check();
    }).catch(() => {});
  }

  // What export.js needs to render the whole board.
  // ---- Check by multiplying: exact and offline (matcheck.js). The matrices are typed or read once, and confirmed here. ----
  const MatCheck = window.SkybridgeMatCheck;
  const mul = {
    btn: document.getElementById("mulBtn"),
    sheet: document.getElementById("mulSheet"),
    preset: document.getElementById("mulPreset"),
    slots: document.getElementById("mulSlots"),
    result: document.getElementById("mulResult"),
    check: document.getElementById("mulCheck"),
    close: document.getElementById("mulClose"),
  };
  const mulDrafts = new Map(); // notebook id -> { preset, text: { U: "...", ... } }
  const mulSides = (preset) => [...new Set([...preset.left, ...preset.right])].filter((name) => name !== "I");
  const mulDraft = () => {
    const key = nb?.id || "";
    if (!mulDrafts.has(key)) mulDrafts.set(key, { preset: storage("get", "skybridge.mulPreset") || MatCheck.PRESETS[0].id, text: {} });
    return mulDrafts.get(key);
  };
  const mulPreset = () => MatCheck.PRESETS.find((item) => item.id === mulDraft().preset) || MatCheck.PRESETS[0];
  const gridText = (rows) => rows.map((row) => row.map((value) => window.SkybridgeMath.fmt(value)).join(" ")).join("\n");

  function renderMulSlots() {
    const preset = mulPreset();
    const draft = mulDraft();
    mul.preset.value = preset.id;
    mul.result.textContent = "";
    mul.result.dataset.state = "";
    const problemMatrices = nb?.problem ? MatCheck.fromProblem(nb.problem) : [];
    mul.slots.replaceChildren(...mulSides(preset).map((name) => {
      const box = document.createElement("div");
      box.className = "mul-slot";
      const label = document.createElement("b");
      label.textContent = name;
      const area = document.createElement("textarea");
      area.rows = 4;
      area.spellcheck = false;
      area.autocapitalize = "off";
      area.setAttribute("aria-label", `Matrix ${name}`);
      area.placeholder = "1 2\n3 4";
      area.value = draft.text[name] || "";
      area.addEventListener("input", () => { draft.text[name] = area.value; area.removeAttribute("aria-invalid"); });
      box.append(label, area);
      const given = problemMatrices.find((item) => item.name === name) || (name === "A" && problemMatrices.length === 1 ? problemMatrices[0] : null);
      if (given) {
        const fill = document.createElement("button");
        fill.type = "button";
        fill.className = "nb-link";
        fill.textContent = `Use ${given.name || name} from the problem`;
        fill.addEventListener("click", () => { area.value = draft.text[name] = gridText(given.rows); });
        box.append(fill);
      }
      const read = document.createElement("button");
      read.type = "button";
      read.className = "nb-link";
      read.textContent = "Read selection";
      read.addEventListener("click", async () => {
        const picked = lasso.selected.filter((stroke) => !stroke.text);
        if (!picked.length) { toast("Lasso the handwritten matrix first"); return; }
        read.disabled = true;
        read.textContent = "Reading…";
        try {
          const result = await window.SkybridgeSmart.convert(picked);
          if (!result.ok) { toast(result.error); return; }
          let rows = null;
          try { rows = MatCheck.matricesIn(result.text)[0]?.rows || MatCheck.parseEntries(result.text); } catch {}
          if (!rows) { area.value = draft.text[name] = result.text || ""; toast("Couldn't make a grid of that. Fix the numbers by hand."); return; }
          area.value = draft.text[name] = gridText(rows);
          toast("Read it. Check each number before you tap Check.");
        } finally {
          read.disabled = false;
          read.textContent = "Read selection";
        }
      });
      if (window.SkybridgeSmart?.convert) box.append(read);
      return box;
    }));
  }

  function runMulCheck() {
    const preset = mulPreset();
    const draft = mulDraft();
    const matrices = {};
    for (const name of mulSides(preset)) {
      const area = mul.slots.querySelector(`textarea[aria-label="Matrix ${name}"]`);
      try {
        matrices[name] = MatCheck.parseEntries(draft.text[name] || "");
      } catch (error) {
        area?.setAttribute("aria-invalid", "true");
        mul.result.dataset.state = "error";
        mul.result.textContent = `${name}: ${error.message}. Type one row per line, numbers separated by spaces.`;
        return;
      }
    }
    const out = MatCheck.check(preset, matrices);
    mul.result.dataset.state = out.ok ? out.verdict : "error";
    mul.result.textContent = out.ok ? out.text : out.error;
    // A correct answer gets what Check my work gives: a green Correct! beside the work, and the done tick.
    if (out.ok && out.verdict === "correct") {
      showVerdict({ ok: true, live: false, text: out.text, verdict: "correct", box: null });
      mul.sheet.hidden = true;
      mul.btn.setAttribute("aria-expanded", "false");
    }
  }

  if (MatCheck && window.SkybridgeMath) {
    mul.preset.replaceChildren(...MatCheck.PRESETS.map((item) => Object.assign(document.createElement("option"), { value: item.id, textContent: item.label })));
    const setMul = (open) => {
      mul.sheet.hidden = !open;
      mul.btn.setAttribute("aria-expanded", String(open));
      if (open) renderMulSlots();
    };
    mul.btn.addEventListener("click", () => setMul(mul.sheet.hidden));
    mul.close.addEventListener("click", () => setMul(false));
    mul.preset.addEventListener("change", () => { mulDraft().preset = mul.preset.value; storage("set", "skybridge.mulPreset", mul.preset.value); renderMulSlots(); });
    mul.check.addEventListener("click", runMulCheck);
  } else {
    mul.btn.hidden = true;
  }

  window.SkybridgePad = { flush: saveNow, pinnedStrokes, strokes, lasso, settings, cssColor, drawStroke, toast, stage: el.stage, geminiBoard: el.geminiBoard, geminiPane: el.geminiPane, fitGemini: fitGeminiBoard, geminiSize: () => geminiSize || { w: 640, pad: [16, 24, 16, 24] } };

  renderSettings();
  renderLayout();
  new ResizeObserver(resize).observe(el.stage);
  updateButtons();
  startNotebooks();
  registerServiceWorker();
})();
