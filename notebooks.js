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
    const tx = db.transaction(data ? [META, DATA] : [META], "readwrite");
    tx.objectStore(META).put(meta);
    if (data) tx.objectStore(DATA).put(data);
    await done(tx);
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
    const [meta, data] = await Promise.all([request(tx.objectStore(META).get(id)), request(tx.objectStore(DATA).get(id))]);
    return meta ? { meta, strokes: data?.strokes || [], view: data?.view } : null;
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
      feed(`${stroke.id}|${pts.length}|${first[0]},${first[1]}|${last[0]},${last[1]}|${stroke.color}|${stroke.width}|${stroke.eraser ? 1 : 0}${stroke.hl ? 1 : 0}${stroke.text ? "|" + stroke.text : ""}${stroke.img ? "|img" + stroke.img : ""};`);
    }
    return (h >>> 0).toString(36);
  }

  // Saves the strokes and view, and any changes to the notebook's own details (`meta`).
  // touch: false keeps the "last changed" time (for labels added by a reader).
  async function save(id, { strokes, view, meta: changes, touch }) {
    const found = await load(id);
    if (!found) return null;
    const meta = { ...found.meta, ...(changes || {}), updated: touch === false ? found.meta.updated : Date.now() };
    // `updated` moves whenever a notebook is opened or saved; `edited` moves only when the writing changes.
    // A restored backup uses it to tell which copy has the newer work.
    if (meta.edited === undefined) meta.edited = found.meta.updated || 0;
    if (strokes) {
      meta.count = strokes.filter((stroke) => !stroke.eraser).length;
      const hash = hashOf(strokes);
      if (hash !== found.meta.hash) meta.edited = Date.now();
      meta.hash = hash;
    }
    await putBoth(meta, {
      id,
      strokes: strokes || found.strokes,
      view: view || found.view,
    });
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
      tx.objectStore(DATA).delete(id);
      await done(tx);
      if (found.pics.length) {
        const gone = db.transaction(PICS, "readwrite");
        for (const pic of found.pics) gone.objectStore(PICS).delete(pic.id);
        await done(gone);
      }
    }
    if (!persistent) for (const pic of found.pics) memory.pics.delete(pic.id);
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
    const [books, ink, pics] = await Promise.all([META, DATA, PICS].map((name) => request(tx.objectStore(name).getAll())));
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
