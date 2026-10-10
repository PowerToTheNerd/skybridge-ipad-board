/*
 * Theme weather: a little weather on the toolbar and the tool rail. Settings > Effects.
 *
 * Only the theme's own surfaces change; the paper and Gemini's board are never touched. Each effect
 * draws on a small canvas BEHIND the buttons (on the bar's glass), so nothing covers a control.
 * One shared loop at about 30 frames a second, stopped while a pen is down, while the page is
 * hidden, and with reduced motion. Off by default.
 *
 *   Rain: drops bead on the glass, some grow heavy and run down, then dry off.
 *   Wind: now and then a gust carries a leaf across; some hit the glass, flutter, and are blown away.
 */
(() => {
  "use strict";
  const KEY = "skybridge-fx-v2";
  const LOOKS = [["off", "None"], ["rain", "Rain"], ["wind", "Wind"]];
  const HINTS = {
    off: "A little weather on the toolbar and tool rail. Your paper never changes.",
    rain: "Drops bead on the toolbar and rail, and now and then one runs down.",
    wind: "Now and then a gust blows a leaf across the toolbar and rail. Some catch for a moment.",
  };
  const state = { mode: "off", k: 0.5 };
  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch {}
  if (!LOOKS.some(([id]) => id === state.mode)) state.mode = "off";
  state.k = Math.min(1, Math.max(0.1, Number(state.k) || 0.5));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };

  const root = document.documentElement;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  const rnd = Math.random;
  const between = (a, b) => a + rnd() * (b - a);

  // ---- a canvas on each theme surface ------------------------------------------------------------
  const surfaces = [];
  for (const host of document.querySelectorAll(".bar, .rail")) {
    const wrap = document.createElement("i");
    wrap.className = "fx-chrome";
    wrap.setAttribute("aria-hidden", "true");
    const cv = document.createElement("canvas");
    wrap.appendChild(cv);
    host.prepend(wrap);
    surfaces.push({ host, wrap, cv, g: cv.getContext("2d"), w: 0, h: 0, beads: [], leaves: [], gusts: [], next: 0 });
  }
  if (!surfaces.length) return;
  function size(s) {
    const w = s.host.clientWidth, h = s.host.clientHeight;
    if (w === s.w && h === s.h) return;
    s.w = w; s.h = h;
    s.cv.width = Math.max(1, Math.round(w * DPR));
    s.cv.height = Math.max(1, Math.round(h * DPR));
    s.beads = s.beads.filter((b) => b.x < w && b.y < h);
  }

  // ---- colours that follow the theme ---------------------------------------------------------------
  let light = false;
  let beadSprites = [];
  function readTheme() {
    const m = getComputedStyle(root).getPropertyValue("--bar-rgb").match(/\d+/g);
    const was = light;
    light = m ? (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 > 0.5 : false;
    if (!beadSprites.length || was !== light) beadSprites = makeBeads();
  }

  // A water bead: clear in the middle, a bright rim where light comes through, a darker lower edge
  // and a small highlight. Drawn once per size, then just copied.
  function makeBeads() {
    const out = [];
    for (let r = 1; r <= 7; r++) {
      const px = Math.ceil((r * 2 + 4) * DPR);
      const c = document.createElement("canvas");
      c.width = c.height = px;
      const g = c.getContext("2d");
      g.scale(DPR, DPR);
      const m = r + 2;
      const body = g.createRadialGradient(m - r * 0.3, m - r * 0.35, r * 0.1, m, m, r);
      body.addColorStop(0, light ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.03)");
      body.addColorStop(0.75, light ? "rgba(120,140,160,0.10)" : "rgba(210,230,240,0.10)");
      body.addColorStop(1, light ? "rgba(70,90,110,0.32)" : "rgba(225,242,250,0.42)");
      g.fillStyle = body;
      g.beginPath(); g.ellipse(m, m, r, r * 0.92, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = light ? "rgba(40,55,70,0.30)" : "rgba(0,0,0,0.35)";
      g.lineWidth = Math.max(0.6, r * 0.18);
      g.beginPath(); g.ellipse(m, m + r * 0.06, r * 0.92, r * 0.82, 0, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
      g.fillStyle = light ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.75)";
      g.beginPath(); g.arc(m - r * 0.38, m - r * 0.4, Math.max(0.45, r * 0.2), 0, Math.PI * 2); g.fill();
      out[r] = { c, m };
    }
    return out;
  }

  // A few leaves in autumn colours, drawn once.
  const LEAF_COLOURS = [[196, 124, 52], [172, 86, 44], [150, 142, 62], [124, 92, 52], [204, 160, 70]];
  const leafSprites = LEAF_COLOURS.map(([r, g2, b]) => {
    const L = 22, W = 11;
    const c = document.createElement("canvas");
    c.width = Math.ceil((L + 4) * DPR); c.height = Math.ceil((W + 4) * DPR);
    const g = c.getContext("2d");
    g.scale(DPR, DPR);
    g.translate(2, 2 + W / 2);
    g.fillStyle = `rgba(${r},${g2},${b},0.85)`;
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(L * 0.45, -W * 0.75, L, 0);
    g.quadraticCurveTo(L * 0.45, W * 0.75, 0, 0);
    g.fill();
    g.strokeStyle = `rgba(${Math.round(r * 0.6)},${Math.round(g2 * 0.6)},${Math.round(b * 0.6)},0.8)`;
    g.lineWidth = 0.6;
    g.beginPath(); g.moveTo(-1.5, 0); g.lineTo(L * 0.9, 0); g.stroke();
    return { c };
  });

  // ---- rain -------------------------------------------------------------------------------------------
  function rainStep(s, dt, now) {
    const area = Math.max(0.35, (s.w * s.h) / 70000); // the toolbar is about 1
    const cap = Math.round((12 + 48 * state.k) * area);
    if (s.beads.length < cap && rnd() < dt * (2 + 8 * state.k) * area) {
      s.beads.push({ x: between(2, s.w - 2), y: between(2, s.h - 2), r: between(1.4, 4.4), vy: 0, born: now, life: between(10, 24), run: false });
    }
    for (const b of s.beads) {
      if (b.gone) continue;
      if (!b.run && b.r > 3.6 && rnd() < dt * 0.05 * (1 + state.k)) b.run = true;
      if (b.run) {
        b.vy = Math.min(70, b.vy + dt * 60);
        b.y += b.vy * dt;
        b.x += Math.sin(now * 3 + b.r * 9) * dt * 3;
        // A running drop leaves a tiny bead behind now and then, and picks up the ones in its way.
        if (rnd() < dt * 1.5) s.beads.push({ x: b.x, y: b.y - b.r, r: 1, vy: 0, born: now, life: between(3, 7), run: false });
        for (const o of s.beads) {
          if (o !== b && !o.run && !o.gone && Math.abs(o.x - b.x) < b.r && o.y > b.y && o.y - b.y < b.r + o.r) {
            o.gone = true;
            b.r = Math.min(7, Math.hypot(b.r, o.r * 0.6));
          }
        }
        if (b.y - b.r > s.h) b.gone = true;
      } else if (now - b.born > b.life) b.gone = true;
    }
    s.beads = s.beads.filter((b) => !b.gone);
  }
  function rainDraw(s, now) {
    for (const b of s.beads) {
      const fade = b.run ? 1 : Math.min(1, (now - b.born) * 3, (1 - (now - b.born) / b.life) * 4);
      const n = Math.max(1, Math.min(7, Math.round(b.r)));
      const sp = beadSprites[n];
      if (!sp) continue;
      s.g.globalAlpha = Math.max(0, fade) * (0.55 + 0.45 * state.k);
      const scale = b.r / n;
      const stretch = b.run ? 1.15 : 1;
      s.g.drawImage(sp.c, (b.x - sp.m * scale) * DPR, (b.y - sp.m * scale * stretch) * DPR, sp.c.width * scale, sp.c.height * scale * stretch);
    }
    s.g.globalAlpha = 1;
  }

  // ---- wind -------------------------------------------------------------------------------------------
  function windStep(s, dt, now) {
    if (!s.next) s.next = now + between(0.5, 3);
    if (now > s.next) {
      // A gust: a couple of faint streaks, and often a leaf or two.
      s.next = now + between(4, 10) / (0.5 + state.k);
      for (let i = 0; i < 1 + Math.round(rnd() * 2); i++) s.gusts.push({ y: between(0.2, 0.8) * s.h, x: -60 - i * 40, len: between(40, 110), v: between(380, 560), a: between(0.06, 0.12) });
      const n = rnd() < 0.35 + 0.5 * state.k ? 1 + (rnd() < state.k * 0.5 ? 1 : 0) : 0;
      for (let i = 0; i < n; i++) {
        s.leaves.push({
          sp: leafSprites[Math.floor(rnd() * leafSprites.length)], x: -20 - i * 30, y: between(0.15, 0.85) * s.h,
          vx: between(140, 260), ph: rnd() * 6, spin: between(-6, 6), rot: rnd() * 6, scale: between(0.8, 1.2),
          catchAt: rnd() < 0.4 ? between(s.w * 0.15, s.w * 0.85) : Infinity, held: 0,
        });
      }
    }
    for (const L of s.leaves) {
      if (L.held > 0) { // caught on the glass: a little flutter, then the wind takes it again
        L.held -= dt;
        L.rot += Math.sin(now * 22) * dt * 2.5;
        if (L.held <= 0) { L.catchAt = Infinity; L.vx = 40; }
        continue;
      }
      if (L.x >= L.catchAt) { L.held = between(0.5, 1.6); L.vx = 0; continue; }
      L.vx = Math.min(300, L.vx + dt * 260);
      L.x += L.vx * dt;
      L.ph += dt * 4;
      L.y += Math.sin(L.ph) * dt * 14;
      L.rot += L.spin * dt;
      if (L.x > s.w + 30) L.gone = true;
    }
    for (const G of s.gusts) { G.x += G.v * dt; if (G.x - G.len > s.w) G.gone = true; }
    s.leaves = s.leaves.filter((L) => !L.gone);
    s.gusts = s.gusts.filter((G) => !G.gone);
  }
  function windDraw(s) {
    const g = s.g;
    g.lineCap = "round";
    const c = light ? "60,80,90" : "220,235,240";
    for (const G of s.gusts) {
      const grad = g.createLinearGradient((G.x - G.len) * DPR, 0, G.x * DPR, 0);
      grad.addColorStop(0, `rgba(${c},0)`); grad.addColorStop(1, `rgba(${c},${G.a * (0.6 + 0.6 * state.k)})`);
      g.strokeStyle = grad; g.lineWidth = DPR;
      g.beginPath();
      g.moveTo((G.x - G.len) * DPR, G.y * DPR);
      g.quadraticCurveTo((G.x - G.len / 2) * DPR, (G.y - 3) * DPR, G.x * DPR, G.y * DPR);
      g.stroke();
    }
    for (const L of s.leaves) {
      g.save();
      g.translate(L.x * DPR, L.y * DPR);
      g.rotate(L.rot);
      g.scale(L.scale, L.scale * Math.max(0.35, Math.abs(Math.cos(L.ph * 0.7)))); // tumbling
      g.globalAlpha = 0.6 + 0.35 * state.k;
      g.drawImage(L.sp.c, -L.sp.c.width / 2, -L.sp.c.height / 2);
      g.restore();
    }
  }

  // ---- the loop -----------------------------------------------------------------------------------------
  let frame = 0, last = 0;
  function tick(t) {
    frame = requestAnimationFrame(tick);
    if (t - last < 32) return;
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    const now = t / 1000;
    for (const s of surfaces) {
      if (!s.w || !s.h) continue;
      if (state.mode === "rain") rainStep(s, dt, now); else windStep(s, dt, now);
      s.g.clearRect(0, 0, s.cv.width, s.cv.height);
      if (state.mode === "rain") rainDraw(s, now); else windDraw(s);
    }
  }
  const canRun = () => state.mode !== "off" && !reduced?.matches && !document.hidden && root.dataset.writing !== "on";
  function sync() {
    root.dataset.fx = state.mode;
    if (state.mode !== "rain") surfaces.forEach((s) => { s.beads = []; });
    if (state.mode !== "wind") surfaces.forEach((s) => { s.leaves = []; s.gusts = []; s.next = 0; });
    if (state.mode === "off") surfaces.forEach((s) => s.g.clearRect(0, 0, s.cv.width, s.cv.height));
    if (canRun()) {
      if (!frame) { last = performance.now(); frame = requestAnimationFrame(tick); }
    } else if (frame) { cancelAnimationFrame(frame); frame = 0; }
    // Reduced motion: a still picture of a few drops, and no wind.
    if (state.mode === "rain" && reduced?.matches) {
      for (const s of surfaces) {
        size(s);
        s.beads = Array.from({ length: Math.round(6 + 16 * state.k) }, () => ({ x: between(2, s.w - 2), y: between(2, s.h - 2), r: between(1.4, 4), born: -10, life: 1e9 }));
        s.g.clearRect(0, 0, s.cv.width, s.cv.height);
        rainDraw(s, 0);
      }
    }
  }

  // ---- keep up with the app -------------------------------------------------------------------------------
  let timer = 0;
  const later = () => { clearTimeout(timer); timer = setTimeout(() => { readTheme(); surfaces.forEach(size); }, 150); };
  new MutationObserver(later).observe(root, { attributes: true, attributeFilter: ["style", "data-theme", "class"] });
  if (window.ResizeObserver) { const ro = new ResizeObserver(later); surfaces.forEach((s) => ro.observe(s.host)); }
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-writing"] });
  document.addEventListener("visibilitychange", sync);
  reduced?.addEventListener?.("change", sync);

  // ---- Settings > Effects ---------------------------------------------------------------------------------
  const host = document.getElementById("labList");
  const ui = { chips: {} };
  function paint() {
    for (const [id, b] of Object.entries(ui.chips)) b.setAttribute("aria-checked", String(state.mode === id));
    if (!ui.k) return;
    ui.hint.textContent = HINTS[state.mode];
    ui.k.value = Math.round(state.k * 100);
    ui.kOut.textContent = `${Math.round(state.k * 100)}%`;
    ui.kRow.hidden = state.mode === "off";
  }
  const choose = (mode) => { state.mode = mode; save(); readTheme(); surfaces.forEach(size); sync(); paint(); };
  if (host) {
    const sec = document.createElement("section");
    sec.className = "fx-section";
    const title = document.createElement("h3");
    title.textContent = "Theme weather";
    ui.hint = document.createElement("p");
    ui.hint.className = "setting-hint";
    const row = document.createElement("div");
    row.className = "segmented fx-seg";
    row.setAttribute("role", "radiogroup");
    row.setAttribute("aria-label", "Theme weather");
    for (const [id, name] of LOOKS) {
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "radio"); b.textContent = name;
      b.addEventListener("click", () => choose(id));
      row.appendChild(b); ui.chips[id] = b;
    }
    ui.kRow = document.createElement("label");
    ui.kRow.className = "setting";
    ui.kRow.innerHTML = '<span class="setting-head">How much <output></output></span><input type="range" min="10" max="100" step="5">';
    ui.k = ui.kRow.querySelector("input"); ui.kOut = ui.kRow.querySelector("output");
    ui.k.addEventListener("input", () => { state.k = Number(ui.k.value) / 100; save(); paint(); if (reduced?.matches) sync(); });
    sec.append(title, ui.hint, row, ui.kRow);
    const anchor = host.previousElementSibling;
    anchor ? anchor.after(sec) : host.before(sec);
  }

  readTheme();
  surfaces.forEach(size);
  paint();
  sync();
  window.SkybridgeFx = { get mode() { return state.mode; }, set: (mode) => choose(LOOKS.some(([id]) => id === mode) ? mode : "off"), setIntensity(v) { state.k = Math.min(1, Math.max(0.1, v)); save(); paint(); } };
})();
