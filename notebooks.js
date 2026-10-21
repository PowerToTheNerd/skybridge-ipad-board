/*
 * Notebooks saved on the iPad itself (IndexedDB), so the board works without the PC.
 *
 * A notebook is a name plus what is on its My board page: today a list of strokes and where
 * the view was left. Shapes and text boxes can join later as more item kinds in `items`
 * (a stroke is { kind: "stroke" } by default), without changing how notebooks are stored.
 *
 * window.SkybridgeNotebooks: open(), list(), create(name), load(id), save(id, data),
 * rename(id, name), remove(id) (returns what it removed, so it can be put back), restore(record),
 * and current()/setCurrent(id) for the notebook that was open last.
 *
 * A page's strokes are kept in parts of a few dozen strokes each, named by a fingerprint of what is in
 * them, so saving a big page writes only the part that changed (see "Parts" below). Older pages stored
 * as one list still load, and move to parts the next time they are saved.
 */
(() => {
  const DB_NAME = "skybridge-board";
  const META = "books";
  const DATA = "ink";
  const PICS = "pics"; // photos placed on pages: { id, data (a data: URL), w, h }, kept apart from the strokes so saving ink stays light
  const CURRENT_KEY = "skybridge-board-current";
  const FORMAT = 1;

  let db = null;
  // If IndexedDB is unavailable (a private window), notebooks live in memory for this visit.
  const memory = { books: new Map(), ink: new Map(), pics: new Map() };
  let persistent = true;

  const request = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const done = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  function storage(action, key, value) {
    try {
      if (action === "set") localStorage.setItem(key, value);
      else return localStorage.getItem(key);
    } catch {}
    return null;
  }

  async function open() {
    if (db || !persistent) return;
    try {
      db = await new Promise((resolve, reject) => {
        const opening = indexedDB.open(DB_NAME, 2);
        opening.onupgradeneeded = () => {
          const names = opening.result.objectStoreNames;
          if (!names.contains(META)) opening.result.createObjectStore(META, { keyPath: "id" });
          if (!names.contains(DATA)) opening.result.createObjectStore(DATA, { keyPath: "id" });
          if (!names.contains(PICS)) opening.result.createObjectStore(PICS, { keyPath: "id" });
        };
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
        opening.onblocked = () => reject(new Error("blocked"));
      });
      // Ask the browser to keep these notebooks when the iPad is short of space.
      navigator.storage?.persist?.().catch(() => {});
    } catch {
      persistent = false;
    }
  }

  const newId = () => {
    const bytes = new Uint8Array(9);
    (self.crypto || window.crypto).getRandomValues(bytes);
    return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
  };

  async function all() {
    await open();
    if (!persistent) return [...memory.books.values()];
    return request(db.transaction(META).objectStore(META).getAll());
  }

  // Folders are records in the same store (kind: "folder"); they are not notebooks, so list() skips them.
  async function list() {
    const books = (await all()).filter((book) => book.kind !== "folder");
    return books.sort((a, b) => b.updated - a.updated);
  }

  async function listFolders() {
    const folders = (await all()).filter((book) => book.kind === "folder");
    return folders.sort((a, b) => b.updated - a.updated);
  }

  // The pages in a folder, in problem order.
  async function pagesOf(folderId) {
    const books = (await all()).filter((book) => book.kind !== "folder" && book.folder === folderId);
    return books.sort((a, b) => (a.order || 0) - (b.order || 0) || a.created - b.created);
  }

  async function createFolder(name, extra = {}) {
    const meta = { id: newId(), kind: "folder", name: cleanName(name) || "Folder", created: Date.now(), updated: Date.now(), count: 0, ...extra, v: FORMAT };
    await putBoth(meta);
    return meta;
  }

  async function renameFolder(id, name) {
    const found = (await all()).find((book) => book.id === id && book.kind === "folder");
    const clean = cleanName(name);
    if (!found || !clean) return null;
    const meta = { ...found, name: clean, updated: Date.now() };
    await putBoth(meta);
    return meta;
  }

  // Take a folder and its pages away; the result puts them all back with restoreFolder().
  async function removeFolder(id) {
    const folder = (await all()).find((book) => book.id === id && book.kind === "folder");
    if (!folder) return null;
    const pages = [];
    for (const page of await pagesOf(id)) pages.push(await remove(page.id));
    await open();
    if (!persistent) memory.books.delete(id);
    else {
      const tx = db.transaction(META, "readwrite");
      tx.objectStore(META).delete(id);
      await done(tx);
    }
    return { folder, pages: pages.filter(Boolean) };
  }

  async function restoreFolder(removed) {
    if (!removed) return;
    await putBoth(removed.folder);
    for (const page of removed.pages) await restore(page);
  }

  // A page in a folder is done (a finished problem) or not.
  async function setDone(id, finished) {
    return save(id, { meta: { done: !!finished }, touch: false });
  }

  async function putBoth(meta, data) {
    await open();
    if (!persistent) {
      memory.books.set(meta.id, meta);
      if (data) memory.ink.set(meta.id, data);
      return;
    }
    if (data) return writeInk(meta, data.id, split(data.id, data.strokes || []), data.view);
    const tx = db.transaction([META], "readwrite");
    tx.objectStore(META).put(meta);
    await done(tx);
  }

  // ---- Parts ----
  // The ink record of a page is { id, view, parts: [part ids] }, and each part is { id, of, strokes } in the
  // same store. A part's id is the page id plus a fingerprint of its strokes, so a part that has not changed
  // keeps its id and is not written again. Parts end after strokes picked by their own id, so taking a
  // stroke out or putting one in changes only the part around it.
  const PART = "~";
  const PART_MAX = 96;
  const stored = new Map(); // page id -> the part ids it has in storage now
  const float = new Float64Array(1);
  const halves = new Uint32Array(float.buffer);
  const M1 = 0x01000193;
  const M2 = 0x5bd1e995;
  const pointPrints = new WeakMap(); // a stroke's points array -> { count, a, b }

  function textInto(h, text, m) {
    for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), m);
    return h;
  }
  function pointsPrint(points) {
    if (!Array.isArray(points)) return { a: 1, b: 1 };
    const hit = pointPrints.get(points);
    if (hit && hit.count === points.length) return hit;
    let a = 0x811c9dc5 ^ points.length;
    let b = 0x2545f491 ^ points.length;
    for (const point of points) {
      const n = Array.isArray(point) ? point.length : 0;
      a = Math.imul(a ^ n, M1);
      b = Math.imul(b ^ n, M2);
      for (let i = 0; i < n; i += 1) {
        float[0] = point[i];
        a = Math.imul(Math.imul(a ^ halves[0], M1) ^ halves[1], M1);
        b = Math.imul(Math.imul(b ^ halves[1], M2) ^ halves[0], M2);
      }
    }
    const print = { count: points.length, a, b };
    pointPrints.set(points, print);
    return print;
  }
  // Everything about a stroke as it is stored, except what `keep` leaves out (what the board keeps only for the
  // screen). Read straight from the stroke, without building strings, so a big page is quick to go through.
  function valueInto(h, value, m) {
    if (typeof value === "number") {
      float[0] = value;
      return Math.imul(Math.imul(Math.imul(h ^ 1, m) ^ halves[0], m) ^ halves[1], m);
    }
    if (typeof value === "string") return textInto(Math.imul(h ^ 2, m), value, m);
    if (typeof value === "boolean") return Math.imul(h ^ (value ? 3 : 4), m);
    if (value === null || value === undefined) return Math.imul(h ^ (value === null ? 5 : 6), m);
    return textInto(Math.imul(h ^ 7, m), JSON.stringify(value) || "", m);
  }
  function strokePrint(stroke, keep) {
    let a = 0x6a09e667;
    let b = 0x3c6ef372;
    for (const key in stroke) {
      if (key === "points" || (keep && !keep.has(key))) continue;
      const value = stroke[key];
      a = valueInto(textInto(a, key, M1), value, M1);
      b = valueInto(textInto(b, key, M2), value, M2);
    }
    const points = pointsPrint(stroke.points);
    return [Math.imul(a ^ points.a, M1), Math.imul(b ^ points.b, M2)];
  }
  // Which of the strokes' fields `copy` keeps: it is tried once on a stroke that has all of them.
  function keptBy(copy, strokes) {
    if (!copy) return null;
    const probe = {};
    for (const stroke of strokes) for (const key in stroke) probe[key] = 0;
    probe.points = [];
    return new Set(Object.keys(copy(probe)));
  }
  const ends = (strokeId) => typeof strokeId === "string" && (textInto(0x811c9dc5, strokeId, M1) & 31) === 0;
  function partId(id, run, keep) {
    let a = 0x811c9dc5;
    let b = 0x2545f491;
    for (const stroke of run) {
      const [x, y] = strokePrint(stroke, keep);
      a = Math.imul(a ^ x, M1);
      b = Math.imul(b ^ y, M2);
    }
    return `${id}${PART}${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}.${run.length}`;
  }
  // The strokes in parts. A part this page does not have in storage yet is copied now, as it is at this moment.
  function split(id, strokes, copy) {
    const have = stored.get(id);
    const keep = keptBy(copy, strokes);
    const parts = [];
    let run = [];
    const close = () => {
      if (!run.length) return;
      const key = partId(id, run, keep);
      parts.push({ key, source: run, strokes: have && have.has(key) ? null : (copy ? run.map(copy) : run) });
      run = [];
    };
    for (const stroke of strokes) {
      run.push(stroke);
      if (run.length >= PART_MAX || ends(stroke?.id)) close();
    }
    close();
    return parts;
  }

  // Writes a page's ink: the parts it does not have yet, its list of parts and its view, and takes away the
  // parts it no longer uses, all in one go. parts null keeps the strokes and changes only the view.
  function writeInk(meta, id, parts, view) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(meta ? [META, DATA] : [DATA], "readwrite");
      const ink = tx.objectStore(DATA);
      if (meta) tx.objectStore(META).put(meta);
      let kept = null;
      const asked = ink.get(id);
      asked.onsuccess = () => {
        const old = asked.result;
        const startView = view || old?.view || { x: 0, y: 0, zoom: 1 };
        if (!parts && old?.parts) {
          ink.put({ ...old, view: startView });
          kept = new Set(old.parts);
          return;
        }
        const list = parts || split(id, old?.strokes || []); // an older page, saved as one list: into parts now
        const before = new Set(old?.parts || []);
        const keys = [];
        for (const part of list) {
          let key = part.key;
          if (!before.has(key)) {
            let strokes = part.strokes;
            if (!strokes) {
              // Storage changed under us (a restore, say): copy it now, and name it by what is copied.
              strokes = part.source.map((stroke) => ({ ...stroke }));
              key = partId(id, strokes);
            }
            ink.put({ id: key, of: id, strokes });
          }
          keys.push(key);
        }
        kept = new Set(keys);
        for (const key of before) if (!kept.has(key)) ink.delete(key);
        ink.put({ id, view: startView, parts: keys });
      };
      tx.oncomplete = () => { if (kept) stored.set(id, kept); resolve(); };
      tx.onerror = () => { stored.delete(id); reject(tx.error); };
      tx.onabort = () => { stored.delete(id); reject(tx.error); };
    });
  }

  // A page's ink record with its strokes put back together, from an open transaction on the ink store.
  function readInk(store, id) {
    return new Promise((resolve, reject) => {
      const asked = store.get(id);
      asked.onerror = () => reject(asked.error);
      asked.onsuccess = () => {
        const record = asked.result;
        if (!record?.parts) { resolve(record); return; }
        const got = new Map();
        let left = record.parts.length;
        if (!left) { stored.set(id, new Set()); resolve({ id, view: record.view, strokes: [] }); return; }
        for (const key of new Set(record.parts)) {
          const part = store.get(key);
          part.onerror = () => reject(part.error);
          part.onsuccess = () => {
            got.set(key, part.result?.strokes || []);
            left -= record.parts.filter((k) => k === key).length;
            if (left > 0) return;
            stored.set(id, new Set(record.parts));
            resolve({ id, view: record.view, strokes: record.parts.flatMap((k) => got.get(k) || []) });
          };
        }
      };
    });
  }

  async function create(name) {
    const books = (await all()).filter((book) => book.kind !== "folder");
    const meta = {
      id: newId(),
      name: cleanName(name) || `Notebook ${books.length + 1}`,
      created: Date.now(),
      updated: Date.now(),
      count: 0,
      seen: 0, // how many PC edits of this notebook the iPad has seen
      unsynced: true, // changed here since the PC last had it
      named: false, // true once you rename it, so a page title never overwrites your name
      title: "", // what a reader found the page to be about, and its tags and searchable text
      tags: [],
      text: "",
      hash: "", // a fingerprint of the strokes, and of the strokes the title and text came from
      readHash: "",
      readAt: 0,
      v: FORMAT,
    };
    await putBoth(meta, { id: meta.id, strokes: [], view: { x: 0, y: 0, zoom: 1 } });
    return meta;
  }

  async function load(id) {
    await open();
    if (!persistent) {
      const meta = memory.books.get(id);
      return meta ? { meta, strokes: memory.ink.get(id)?.strokes || [], view: memory.ink.get(id)?.view } : null;
    }
    const tx = db.transaction([META, DATA]);
    const [meta, data] = await Promise.all([request(tx.objectStore(META).get(id)), readInk(tx.objectStore(DATA), id)]);
    return meta ? { meta, strokes: data?.strokes || [], view: data?.view } : null;
  }

  async function loadMeta(id) {
    await open();
    if (!persistent) {
      const meta = memory.books.get(id);
      return meta ? { meta, strokes: null, view: memory.ink.get(id)?.view } : null;
    }
    const meta = await request(db.transaction(META).objectStore(META).get(id));
    return meta ? { meta, strokes: null, view: null } : null;
  }

  // A fingerprint of the strokes: it changes when any stroke is added, removed, moved or recoloured.
  function hashOf(strokes) {
    let h = 0x811c9dc5;
    const feed = (text) => {
      for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    };
    for (const stroke of strokes) {
      const pts = stroke.points || [];
      const first = pts[0] || [];
      const last = pts[pts.length - 1] || [];
      feed(`${stroke.id}|${pts.length}|${first[0]},${first[1]}|${last[0]},${last[1]}|${stroke.color}|${stroke.width}|${stroke.eraser ? 1 : 0}${stroke.hl ? 1 : 0}${stroke.nib ? "|" + stroke.nib : ""}${stroke.text ? "|" + stroke.text : ""}${stroke.rich ? "|rich" + JSON.stringify([stroke.rich.sig, stroke.rich.titleColor, stroke.rich.ink]) : ""}${stroke.img ? "|img" + stroke.img : ""};`);
    }
    return (h >>> 0).toString(36);
  }

  // Saves the strokes and view, and any changes to the notebook's own details (`meta`).
  // touch: false keeps the "last changed" time (for labels added by a reader).
  // copy: how to store a stroke (the board leaves out what is only for the screen); only the parts of the page
  // that changed are copied and written, so saving a big page stays quick.
  async function save(id, { strokes, view, meta: changes, touch, copy }) {
    await open();
    // The parts are worked out now, before anything waits, so they hold the strokes as they are at this moment.
    const parts = strokes && persistent ? split(id, strokes, copy) : null;
    const found = await loadMeta(id);
    if (!found) return null;
    const meta = { ...found.meta, ...(changes || {}), updated: touch === false ? found.meta.updated : Date.now() };
    // `updated` moves whenever a notebook is opened or saved; `edited` moves only when the writing changes.
    // A restored backup uses it to tell which copy has the newer work.
    if (meta.edited === undefined) meta.edited = found.meta.updated || 0;
    if (changes?.problem && JSON.stringify(changes.problem.colors) !== JSON.stringify(found.meta.problem?.colors)) meta.edited = Date.now();
    if (strokes) {
      meta.count = strokes.filter((stroke) => !stroke.eraser).length;
      const hash = hashOf(strokes);
      if (hash !== found.meta.hash) meta.edited = Date.now();
      meta.hash = hash;
    }
    if (!persistent) {
      const ink = memory.ink.get(id) || { id, strokes: [], view: { x: 0, y: 0, zoom: 1 } };
      await putBoth(meta, { id, strokes: strokes ? (copy ? strokes.map(copy) : strokes) : ink.strokes, view: view || ink.view });
    } else if (strokes || view) {
      await writeInk(meta, id, parts, view);
    } else {
      await putBoth(meta); // only the details: the ink is not read or written at all
    }
    return meta;
  }

  const cleanName = (name) => String(name || "").replace(/\s+/g, " ").trim().slice(0, 80);

  async function rename(id, name) {
    const found = await load(id);
    const clean = cleanName(name);
    if (!found || !clean) return null;
    const meta = { ...found.meta, name: clean, named: true };
    await putBoth(meta);
    return meta;
  }

  async function putPic(pic) {
    await open();
    if (!persistent) { memory.pics.set(pic.id, pic); return; }
    const tx = db.transaction(PICS, "readwrite");
    tx.objectStore(PICS).put(pic);
    await done(tx);
  }

  async function getPics(ids) {
    await open();
    const out = new Map();
    for (const id of new Set(ids)) {
      const pic = persistent ? await request(db.transaction(PICS).objectStore(PICS).get(id)) : memory.pics.get(id);
      if (pic) out.set(id, pic);
    }
    return out;
  }

  const picIds = (strokes) => [...new Set((strokes || []).filter((stroke) => stroke.img).map((stroke) => stroke.img))];

  async function remove(id) {
    const found = await load(id);
    if (!found) return null;
    // The photos go with the page; the record carries them so Undo can bring them back.
    found.pics = [...(await getPics(picIds(found.strokes))).values()];
    if (!persistent) {
      memory.books.delete(id);
      memory.ink.delete(id);
    } else {
      const tx = db.transaction([META, DATA], "readwrite");
      tx.objectStore(META).delete(id);
      const ink = tx.objectStore(DATA);
      const asked = ink.get(id);
      asked.onsuccess = () => {
        for (const key of new Set(asked.result?.parts || [])) ink.delete(key);
        ink.delete(id);
      };
      await done(tx);
      stored.delete(id);
      if (found.pics.length) {
        // A photo that was moved or copied into another note stays for that note.
        const others = await request(db.transaction(DATA).objectStore(DATA).getAll());
        const used = new Set(others.flatMap((record) => picIds(record.strokes)));
        const gone = db.transaction(PICS, "readwrite");
        for (const pic of found.pics) if (!used.has(pic.id)) gone.objectStore(PICS).delete(pic.id);
        await done(gone);
      }
    }
    if (!persistent) {
      const used = new Set([...memory.ink.values()].flatMap((record) => picIds(record.strokes)));
      for (const pic of found.pics) if (!used.has(pic.id)) memory.pics.delete(pic.id);
    }
    return found;
  }

  async function restore(found) {
    if (!found) return;
    for (const pic of found.pics || []) await putPic(pic);
    await putBoth(found.meta, { id: found.meta.id, strokes: found.strokes, view: found.view });
  }

  // Everything stored here, for a backup file: notebooks and folders, their strokes and views, and the photos.
  async function dump() {
    await open();
    if (!persistent) return { books: [...memory.books.values()], ink: [...memory.ink.values()], pics: [...memory.pics.values()] };
    const tx = db.transaction([META, DATA, PICS]);
    const [books, records, pics] = await Promise.all([META, DATA, PICS].map((name) => request(tx.objectStore(name).getAll())));
    // A backup holds each page's strokes as one list, as it always has.
    const parts = new Map(records.filter((record) => record.of).map((record) => [record.id, record.strokes || []]));
    const ink = records.filter((record) => !record.of).map((record) => (record.parts
      ? { id: record.id, strokes: record.parts.flatMap((key) => parts.get(key) || []), view: record.view }
      : record));
    return { books, ink, pics };
  }

  const editedAt = (meta) => Number(meta.edited) || Number(meta.updated) || 0;

  // Put a backup's notebooks here without losing anything. A notebook that is already here stays unless the
  // backup's copy has newer writing; nothing is ever deleted.
  async function merge({ books = [], ink = [], pics = [] }) {
    await open();
    const have = new Map((await all()).map((book) => [book.id, book]));
    const inkOf = new Map(ink.filter((record) => record && typeof record.id === "string").map((record) => [record.id, record]));
    const havePics = new Set(persistent ? await request(db.transaction(PICS).objectStore(PICS).getAllKeys()) : memory.pics.keys());
    const out = { notebooks: 0, folders: 0, replaced: 0, kept: 0, skipped: 0, photos: 0, changed: new Set() };
    for (const pic of pics) {
      if (!pic || typeof pic.id !== "string" || typeof pic.data !== "string" || !pic.data.startsWith("data:image/") || havePics.has(pic.id)) continue;
      await putPic(pic);
      out.photos += 1;
    }
    for (const meta of books) {
      if (!meta || typeof meta.id !== "string" || !meta.id || meta.id.length > 64) { out.skipped += 1; continue; }
      const here = have.get(meta.id);
      // Already here: the same writing, or newer work, stays. Only a backup copy with newer work replaces it.
      if (here && ((here.hash && here.hash === meta.hash) || editedAt(here) >= editedAt(meta))) { out.kept += 1; continue; }
      const folder = meta.kind === "folder";
      const record = inkOf.get(meta.id);
      if (!folder && !Array.isArray(record?.strokes)) { out.skipped += 1; continue; }
      await putBoth({ ...meta, v: FORMAT }, folder ? undefined : { id: meta.id, strokes: record.strokes, view: record.view });
      if (here) out.replaced += 1;
      else if (folder) out.folders += 1;
      else out.notebooks += 1;
      out.changed.add(meta.id);
    }
    return out;
  }

  window.SkybridgeNotebooks = {
    dump, merge, open, putPic, getPics, list, listFolders, pagesOf, createFolder, renameFolder, removeFolder, restoreFolder, setDone, create, load, save, rename, remove, restore, hashOf,
    current: () => storage("get", CURRENT_KEY),
    setCurrent: (id) => storage("set", CURRENT_KEY, id),
    isPersistent: () => persistent,
  };
})();
