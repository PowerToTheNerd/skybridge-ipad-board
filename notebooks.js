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
  const CURRENT_KEY = "skybridge-board-current";
  const FORMAT = 1;

  let db = null;
  // If IndexedDB is unavailable (a private window), notebooks live in memory for this visit.
  const memory = { books: new Map(), ink: new Map() };
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
        const opening = indexedDB.open(DB_NAME, 1);
        opening.onupgradeneeded = () => {
          opening.result.createObjectStore(META, { keyPath: "id" });
          opening.result.createObjectStore(DATA, { keyPath: "id" });
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
      feed(`${stroke.id}|${pts.length}|${first[0]},${first[1]}|${last[0]},${last[1]}|${stroke.color}|${stroke.width}|${stroke.eraser ? 1 : 0}${stroke.hl ? 1 : 0}${stroke.text ? "|" + stroke.text : ""};`);
    }
    return (h >>> 0).toString(36);
  }

  // Saves the strokes and view, and any changes to the notebook's own details (`meta`).
  // touch: false keeps the "last changed" time (for labels added by a reader).
  async function save(id, { strokes, view, meta: changes, touch }) {
    const found = await load(id);
    if (!found) return null;
    const meta = { ...found.meta, ...(changes || {}), updated: touch === false ? found.meta.updated : Date.now() };
    if (strokes) {
      meta.count = strokes.filter((stroke) => !stroke.eraser).length;
      meta.hash = hashOf(strokes);
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

  async function remove(id) {
    const found = await load(id);
    if (!found) return null;
    if (!persistent) {
      memory.books.delete(id);
      memory.ink.delete(id);
    } else {
      const tx = db.transaction([META, DATA], "readwrite");
      tx.objectStore(META).delete(id);
      tx.objectStore(DATA).delete(id);
      await done(tx);
    }
    return found;
  }

  async function restore(found) {
    if (!found) return;
    await putBoth(found.meta, { id: found.meta.id, strokes: found.strokes, view: found.view });
  }

  window.SkybridgeNotebooks = {
    open, list, listFolders, pagesOf, createFolder, renameFolder, removeFolder, restoreFolder, setDone, create, load, save, rename, remove, restore, hashOf,
    current: () => storage("get", CURRENT_KEY),
    setCurrent: (id) => storage("set", CURRENT_KEY, id),
    isPersistent: () => persistent,
  };
})();
