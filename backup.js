/*
 * Back up and move notebooks: Notebooks > "Back up or move notebooks".
 *
 * Every browser keeps its own copy of the notebooks: Chrome, Safari and the Home Screen app do not see
 * each other's. "Back up everything" saves ONE file with all the notebooks and folders (names, tags,
 * handwriting, view), the photos on the pages and the homework problem lists. "Restore from a backup"
 * reads that file into whatever you are in now. Restoring only ever adds: a notebook that is already
 * here is replaced only when the backup's copy was changed later, and nothing is deleted. The file
 * never holds your Gemini key or any other setting.
 *
 * window.SkybridgeBackup = { make() -> { blob, name, notebooks, folders, photos }, read(file) -> data, apply(data) -> summary }
 */
(() => {
  "use strict";
  const Notebooks = window.SkybridgeNotebooks;
  if (!Notebooks) return;
  const KIND = "skybridge-board-backup";
  const LAST_KEY = "skybridge.lastBackup";

  const storage = (action, key, value) => {
    try {
      if (action === "set") localStorage.setItem(key, value);
      else return localStorage.getItem(key);
    } catch {}
    return null;
  };
  const day = (when) => new Date(when).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  // The file is built from many small pieces, so a lot of photos never need one giant string.
  async function make() {
    await window.SkybridgePad?.flush?.();
    const dumped = await Notebooks.dump();
    // A blank notebook nobody wrote in or renamed (the "Notebook 1" every fresh install starts with) isn't worth carrying.
    const inkOf = new Map(dumped.ink.map((record) => [record.id, record]));
    const books = dumped.books.filter((book) => book.kind === "folder" || book.named || (inkOf.get(book.id)?.strokes || []).some((stroke) => !stroke.eraser));
    const ids = new Set(books.map((book) => book.id));
    const ink = dumped.ink.filter((record) => ids.has(record.id));
    const pics = dumped.pics;
    const homework = window.SkybridgeHomework ? await window.SkybridgeHomework.list() : [];
    const parts = [`{"kind":${JSON.stringify(KIND)},"v":1,"made":${Date.now()},"books":`, JSON.stringify(books), ',"homework":', JSON.stringify(homework), ',"ink":['];
    ink.forEach((record, i) => parts.push((i ? "," : "") + JSON.stringify(record)));
    parts.push('],"pics":[');
    pics.forEach((pic, i) => parts.push((i ? "," : "") + JSON.stringify(pic)));
    parts.push("]}");
    const folders = books.filter((book) => book.kind === "folder").length;
    return {
      blob: new Blob(parts, { type: "application/json" }),
      name: `skybridge-notebooks-${new Date().toISOString().slice(0, 10)}.json`,
      notebooks: books.length - folders,
      folders,
      photos: pics.length,
    };
  }

  async function read(file) {
    let data = null;
    try { data = JSON.parse(await file.text()); } catch { /* handled below */ }
    if (!data || data.kind !== KIND || !Array.isArray(data.books)) throw new Error("That isn't a Skybridge backup file.");
    return data;
  }

  async function apply(data) {
    const result = await Notebooks.merge({ books: data.books, ink: Array.isArray(data.ink) ? data.ink : [], pics: Array.isArray(data.pics) ? data.pics : [] });
    let sets = 0;
    const Homework = window.SkybridgeHomework;
    if (Homework && Array.isArray(data.homework)) {
      for (const set of data.homework) {
        if (!set || typeof set.id !== "string" || !Array.isArray(set.problems)) continue;
        const here = await Homework.get(set.id);
        if (here && (Number(here.added) || 0) >= (Number(set.added) || 0)) continue;
        await Homework.restore(set);
        sets += 1;
      }
    }
    return { ...result, homework: sets };
  }

  // The share sheet where there is one (Save to Files), otherwise a download.
  async function save({ blob, name }) {
    const file = new File([blob], name, { type: "application/json" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Skybridge notebooks" });
        return "shared";
      } catch (error) {
        if (error?.name === "AbortError") return "cancelled";
      }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return "downloaded";
  }

  window.SkybridgeBackup = { make, read, apply };

  // ---- the panel ---------------------------------------------------------------------------------------------
  const el = {
    make: document.getElementById("backupMake"),
    restore: document.getElementById("backupRestore"),
    file: document.getElementById("backupFile"),
    out: document.getElementById("backupOut"),
    note: document.getElementById("backupNote"),
  };
  if (!el.make || !el.restore || !el.file) return;
  const toast = (text) => window.SkybridgePad?.toast?.(text);
  const say = (text) => { if (el.note) el.note.textContent = text; };

  function showLast() {
    const last = Number(storage("get", LAST_KEY)) || 0;
    if (el.out) el.out.textContent = last ? `Last backup ${day(last)}` : "";
  }
  showLast();

  async function busy(button, label, job) {
    const was = button.textContent;
    el.make.disabled = el.restore.disabled = true;
    button.textContent = label;
    try { return await job(); } finally {
      el.make.disabled = el.restore.disabled = false;
      button.textContent = was;
    }
  }

  el.make.addEventListener("click", async () => {
    try {
      const made = await busy(el.make, "Making the file…", make);
      if (!made.notebooks && !made.folders) { say("There is nothing to back up yet."); return; }
      const how = await save(made);
      if (how === "cancelled") return;
      storage("set", LAST_KEY, String(Date.now()));
      showLast();
      const what = `${plural(made.notebooks, "notebook")}${made.folders ? `, ${plural(made.folders, "folder")}` : ""}${made.photos ? `, ${plural(made.photos, "photo")}` : ""}`;
      say(how === "shared"
        ? `Backed up ${what}. In the share sheet, choose Save to Files.`
        : `Backed up ${what} as ${made.name}. Look in Files > Downloads.`);
      toast(`Backed up ${plural(made.notebooks, "notebook")}`);
    } catch (error) {
      say(`That didn't work: ${error?.message || "the backup couldn't be made"}.`);
    }
  });

  el.restore.addEventListener("click", () => el.file.click());
  el.file.addEventListener("change", async () => {
    const file = el.file.files?.[0];
    el.file.value = "";
    if (!file) return;
    try {
      const done = await busy(el.restore, "Restoring…", async () => {
        await window.SkybridgePad?.flush?.(); // what is open is saved first, so its time is up to date
        return apply(await read(file));
      });
      const added = [];
      if (done.notebooks) added.push(plural(done.notebooks, "notebook"));
      if (done.folders) added.push(plural(done.folders, "folder"));
      if (done.photos) added.push(plural(done.photos, "photo"));
      if (done.homework) added.push(plural(done.homework, "homework set"));
      const bits = [];
      if (added.length) bits.push(`Added ${added.join(", ")}`);
      if (done.replaced) bits.push(`${bits.length ? "updated" : "Updated"} ${plural(done.replaced, "notebook")} with newer changes`);
      const kept = done.kept ? ` ${done.kept} already here, so left as ${done.kept === 1 ? "it is" : "they are"}.` : "";
      say(bits.length ? `${bits.join("; ")}.${kept}` : `Nothing new in that backup.${kept}`);
      toast(bits.length ? "Notebooks restored" : "Nothing new in that backup");
      await window.SkybridgePad?.refreshNotebooks?.(done.changed);
    } catch (error) {
      say(error?.message || "That file couldn't be restored.");
    }
  });
})();
