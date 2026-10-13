/* Coordinated question colours, explicit homework/page scopes, and an undoable batch edit. */
((root) => {
  "use strict";
  const PRESETS = [
    { id: "ocean", name: "Ocean & amber", hue: 250, accent: 65 },
    { id: "meadow", name: "Meadow & plum", hue: 160, accent: 320 },
    { id: "plum", name: "Plum & gold", hue: 300, accent: 90 },
    { id: "clay", name: "Clay & blue", hue: 40, accent: 235 },
  ];
  const valid = (c) => c && [c.text, c.math, c.title].every((v) => /^#[0-9a-f]{6}$/i.test(v));
  const luminance = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  };
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  // Compose in OKLCH, then store hex for the board's existing ink renderer and exports.
  function hexFrom(l, c, h) {
    const a = c * Math.cos(h * Math.PI / 180), b = c * Math.sin(h * Math.PI / 180);
    const ll = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const mm = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const ss = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return "#" + [4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss, -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss, -0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss]
      .map((v) => Math.max(0, Math.min(1, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)))
      .map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
  }
  function combo(id, shade, paper = "#0d1613") {
    const preset = PRESETS.find((p) => p.id === id) || PRESETS[0];
    const dark = luminance(paper) < 0.18;
    const colour = (l, c, h) => {
      const made = () => hexFrom(l, l > 0.9 ? c * (1 - l) * 10 : c, h);
      let hex = made();
      for (let i = 0; contrast(hex, paper) < 4.5 && i < 40; i++) {
        l = Math.max(0.08, Math.min(0.98, l + (dark ? 0.015 : -0.015)));
        hex = made();
      }
      return hex;
    };
    const text = colour(dark ? 0.84 : 0.36, 0.065, preset.hue);
    return {
      text, math: shade === "same" ? text : colour(dark ? 0.78 : 0.42, 0.065, preset.hue),
      title: colour(dark ? 0.8 : 0.43, 0.12, preset.accent), preset: preset.id, shade: shade === "same" ? "same" : "shade",
    };
  }
  const coloursFor = (set, index) => {
    const c = set?.problemColors?.[index] || set?.colors;
    return valid(c) ? { ...c } : null;
  };
  function recolor(record, colors) {
    return {
      ...record,
      meta: { ...record.meta, ...(record.meta.problem ? { problem: { ...record.meta.problem, colors: { ...colors } } } : {}) },
      strokes: record.strokes.map((s) => s.pin && s.rich ? { ...s, color: colors.text, rich: { ...s.rich, titleColor: colors.title, ink: colors.math } } : s),
    };
  }
  // Undo only colour fields. New student ink, movements, completion marks, and renamed pages survive.
  function restoreColors(latest, before) {
    const old = new Map(before.strokes.filter((s) => s.pin && s.rich).map((s) => [s.id, s]));
    const restored = { ...latest, meta: { ...latest.meta }, strokes: latest.strokes.map((s) => {
      const was = old.get(s.id);
      return was && s.pin && s.rich ? { ...s, color: was.color, rich: { ...s.rich, titleColor: was.rich.titleColor, ink: was.rich.ink } } : s;
    }) };
    if (latest.meta.problem) {
      restored.meta.problem = { ...latest.meta.problem };
      if (before.meta.problem?.colors) restored.meta.problem.colors = before.meta.problem.colors;
      else delete restored.meta.problem.colors;
    }
    return restored;
  }
  async function apply({ scope, currentId, currentSet, pages = [], problems = [], colors }, { notebooks, homework }) {
    if (!["current", "homework", "selected", "all"].includes(scope)) throw new Error("Choose where to apply the colours.");
    if (!valid(colors)) throw new Error("Choose colours for the text, maths and label.");
    const sets = await homework.list();
    const books = await notebooks.list();
    const pageIds = new Set(scope === "selected" ? pages : []);
    if (scope !== "selected") problems = [];
    const all = scope === "all";
    const oneSet = scope === "homework";
    if (oneSet && !currentSet) throw new Error("Open a homework problem first.");
    if (scope === "current") pageIds.add(currentId);
    const setIds = new Set(all ? sets.map((s) => s.id) : oneSet ? [currentSet] : []);
    const beforeSets = [], beforePages = [], writtenSets = [], writtenPages = [];
    for (const set of sets) {
      const picks = problems.filter((p) => p.set === set.id && Number.isInteger(p.index) && set.problems[p.index]);
      if (!setIds.has(set.id) && !picks.length) continue;
      const next = { ...set };
      if (setIds.has(set.id)) { next.colors = { ...colors }; next.problemColors = {}; }
      else { next.problemColors = { ...set.problemColors }; picks.forEach((p) => { next.problemColors[p.index] = { ...colors }; }); }
      beforeSets.push({ before: set, next });
    }
    for (const book of books) {
      const p = book.problem;
      const match = p?.source === "homework" && (all || (oneSet && p.set === currentSet) || problems.some((pick) => pick.set === p.set && pick.index === p.index));
      if (!pageIds.has(book.id) && !match) continue;
      const record = await notebooks.load(book.id);
      if (!record || (!record.meta.problem && !record.strokes.some((s) => s.pin && s.rich))) continue;
      beforePages.push(record);
    }
    if (!beforePages.length && !beforeSets.length) throw new Error("Choose at least one problem or note page with a question.");
    const savePage = async (record) => {
      const saved = await notebooks.save(record.meta.id, { strokes: record.strokes, meta: { ...(record.meta.problem ? { problem: record.meta.problem } : {}) } });
      if (!saved) throw new Error("A selected note page changed. Choose its colours again.");
      return saved;
    };
    async function undo() {
      for (const entry of writtenSets) {
        const latest = await homework.get(entry.before.id);
        if (latest) {
          const restored = { ...latest };
          if (setIds.has(latest.id)) {
            if (entry.before.colors) restored.colors = entry.before.colors; else delete restored.colors;
            if (entry.before.problemColors) restored.problemColors = entry.before.problemColors; else delete restored.problemColors;
          } else {
            restored.problemColors = { ...latest.problemColors };
            problems.filter((p) => p.set === latest.id).forEach((p) => {
              if (entry.before.problemColors?.[p.index]) restored.problemColors[p.index] = entry.before.problemColors[p.index];
              else delete restored.problemColors[p.index];
            });
          }
          await homework.restore(restored);
        }
      }
      for (const record of writtenPages) {
        const latest = await notebooks.load(record.meta.id);
        if (latest) await savePage(restoreColors(latest, record));
      }
      return writtenPages.map((r) => r.meta.id);
    }
    try {
      for (const entry of beforeSets) { await homework.restore(entry.next); writtenSets.push(entry); }
      for (const record of beforePages) { await savePage(recolor(record, colors)); writtenPages.push(record); }
    } catch (error) { await undo(); throw error; }
    return { pageIds: writtenPages.map((r) => r.meta.id), sets: beforeSets.length, undo };
  }

  function init(pad) {
    const host = document.getElementById("homeworkColors");
    if (!host) return null;
    host.innerHTML = `<h3>Question colours</h3>
      <p class="setting-hint">Coordinated text and maths, with a distinct problem label.</p>
      <label class="combo-field">Combination<select id="comboPreset"><option value="current">Current / custom colours</option>${PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}</select></label>
      <label class="combo-field">Maths<select id="comboShade"><option value="shade">A slight shade of the text</option><option value="same">Match the text</option></select></label>
      <div class="combo-roles" aria-label="Colour preview"><span><i data-role="text"></i>Text</span><span><i data-role="math"></i>Maths</span><span><i data-role="title"></i>3A / label</span></div>
      <label class="combo-field">Apply to<select id="comboScope"><option value="current">This note page</option><option value="homework">This homework</option><option value="selected">Selected problems / pages</option><option value="all">All homework</option></select></label>
      <div id="comboTargets" class="combo-targets" hidden></div>
      <p class="setting-hint" id="comboScopeHint"></p>
      <button type="button" class="tool wide" id="comboApply">Apply colours</button>
      <p class="setting-hint" id="comboStatus" role="status" aria-live="polite"></p>`;
    const preset = host.querySelector("#comboPreset"), shade = host.querySelector("#comboShade"), scope = host.querySelector("#comboScope");
    const targets = host.querySelector("#comboTargets"), button = host.querySelector("#comboApply"), status = host.querySelector("#comboStatus");
    const selectedPages = new Set(), selectedProblems = new Map();
    let busy = false, renderId = 0, automaticScope = true, lastPage = pad.currentPageId();
    const draft = () => preset.value === "current" ? pad.currentColors() : combo(preset.value, shade.value, pad.cssColor("paper"));
    function refresh() {
      const problem = pad.currentProblem();
      if (pad.currentPageId() !== lastPage) { lastPage = pad.currentPageId(); automaticScope = true; }
      if (automaticScope) scope.value = problem ? "current" : "selected";
      scope.querySelector('[value="current"]').disabled = !problem;
      scope.querySelector('[value="homework"]').disabled = problem?.source !== "homework";
      if (scope.selectedOptions[0].disabled) scope.value = "selected";
      targets.hidden = scope.value !== "selected";
      if (!targets.hidden && !targets.children.length && !targets.textContent) renderTargets().catch((error) => { targets.textContent = error.message; });
      const text = { current: "Only the question on the open note page changes.", homework: "Every problem in this homework, including future pages, changes.", selected: "Choose folders, individual problems, or note pages below.", all: "Every saved homework PDF and its question pages changes." };
      host.querySelector("#comboScopeHint").textContent = text[scope.value];
      shade.disabled = preset.value === "current";
      const colors = draft();
      for (const dot of host.querySelectorAll("[data-role]")) dot.style.backgroundColor = colors[dot.dataset.role];
      pad.previewColors(colors);
    }
    const makeChoice = (parent, name, checked, change, disabled = false) => {
      const label = document.createElement("label"); label.className = "combo-choice";
      const input = document.createElement("input"); input.type = "checkbox"; input.checked = checked; input.disabled = disabled;
      input.addEventListener("change", () => change(input.checked));
      label.append(input, document.createTextNode(name)); parent.append(label); return input;
    };
    async function renderTargets() {
      const id = ++renderId;
      targets.textContent = "Loading saved pages…";
      const [sets, books, folders] = await Promise.all([pad.homework.list(), pad.notebooks.list(), pad.notebooks.listFolders()]);
      if (id !== renderId) return;
      targets.replaceChildren();
      const groups = new Map();
      for (const book of books) {
        const folder = folders.find((f) => f.id === book.folder);
        const set = sets.find((s) => s.id === book.problem?.set);
        const key = folder ? `folder:${folder.id}` : set ? `set:${set.id}` : "notes";
        if (!groups.has(key)) groups.set(key, { name: folder?.name || set?.name || "Note pages", set: folder?.set || set?.id, books: [], missing: [] });
        groups.get(key).books.push(book);
      }
      // Keep unplaced problems inside their homework section instead of duplicating folders.
      for (const set of sets) {
        const missing = set.problems.map((p, index) => ({ ...p, index, set: set.id })).filter((p) => !books.some((b) => b.problem?.set === set.id && b.problem.index === p.index));
        if (!missing.length) continue;
        let group = [...groups.values()].find((g) => g.set === set.id);
        if (!group) { group = { name: set.name, set: set.id, books: [], missing: [] }; groups.set(`set:${set.id}`, group); }
        group.missing = missing;
      }
      for (const group of groups.values()) {
        const section = document.createElement("details"); section.className = "combo-folder";
        const summary = document.createElement("summary"); summary.textContent = `${group.name} (${group.books.length + group.missing.length})`; section.append(summary);
        const eligible = group.books.filter((b) => b.problem);
        const inputs = [];
        const keyOf = (p) => JSON.stringify([p.set, p.index]);
        const allSelected = () => eligible.every((b) => selectedPages.has(b.id)) && group.missing.every((p) => selectedProblems.has(keyOf(p)));
        const someSelected = () => eligible.some((b) => selectedPages.has(b.id)) || group.missing.some((p) => selectedProblems.has(keyOf(p)));
        const syncBox = () => { allBox.checked = allSelected(); allBox.indeterminate = !allBox.checked && someSelected(); };
        const allBox = makeChoice(section, "All questions in this section", (eligible.length + group.missing.length) > 0 && allSelected(), (on) => {
          eligible.forEach((b) => on ? selectedPages.add(b.id) : selectedPages.delete(b.id));
          group.missing.forEach((p) => on ? selectedProblems.set(keyOf(p), { set: p.set, index: p.index }) : selectedProblems.delete(keyOf(p)));
          inputs.forEach((input) => { if (!input.disabled) input.checked = on; });
        }, !(eligible.length + group.missing.length));
        for (const book of group.books.sort((a, b) => (a.order || 0) - (b.order || 0))) {
          inputs.push(makeChoice(section, book.problem ? `${book.problem.title || "Question"} · ${book.name}` : `${book.name} (no question)`, selectedPages.has(book.id), (on) => {
            on ? selectedPages.add(book.id) : selectedPages.delete(book.id);
            syncBox();
          }, !book.problem));
        }
        for (const problem of group.missing) {
          const key = keyOf(problem);
          inputs.push(makeChoice(section, `${problem.label || `Problem ${problem.index + 1}`} (not on a page yet)`, selectedProblems.has(key), (on) => {
            on ? selectedProblems.set(key, { set: problem.set, index: problem.index }) : selectedProblems.delete(key); syncBox();
          }));
        }
        allBox.indeterminate = !allBox.checked && someSelected();
        targets.append(section);
      }
      if (!targets.children.length) targets.textContent = "Import homework or create a question page to choose it here.";
    }
    for (const control of [preset, shade]) control.addEventListener("change", refresh);
    scope.addEventListener("change", () => { automaticScope = false; refresh(); if (scope.value === "selected") renderTargets().catch((error) => { targets.textContent = error.message; }); });
    document.getElementById("customQuestionColors")?.addEventListener("click", (event) => {
      if (event.target.closest("[data-value]")) { preset.value = "current"; pad.useCustomColors(); refresh(); }
    });
    button.addEventListener("click", async () => {
      if (busy) return;
      busy = true; button.disabled = true; button.textContent = "Applying…"; status.textContent = "";
      const colors = draft();
      preset.disabled = shade.disabled = scope.disabled = true; targets.inert = true;
      try {
        const result = await pad.applyColors({ scope: scope.value, pages: [...selectedPages], problems: [...selectedProblems.values()], colors });
        status.textContent = `Applied to ${result.pageIds.length} saved page${result.pageIds.length === 1 ? "" : "s"}${result.sets ? " and future homework problems" : ""}.`;
      } catch (error) { status.textContent = error.message || "Couldn't apply colours. Try again."; }
      finally { busy = false; button.disabled = false; button.textContent = "Apply colours"; preset.disabled = scope.disabled = false; targets.inert = false; refresh(); }
    });
    refresh();
    return { refresh, open() { automaticScope = true; scope.value = "current"; preset.value = "current"; pad.useCurrentColors(); refresh(); host.scrollIntoView({ block: "start" }); } };
  }
  const api = { PRESETS, combo, valid, contrast, coloursFor, recolor, restoreColors, apply, init };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SkybridgeHomeworkColors = api;
})(typeof window !== "undefined" ? window : globalThis);
