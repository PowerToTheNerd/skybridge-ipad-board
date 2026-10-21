// Run: node tests/notebooks.test.js
// Notebook storage: pages are kept in parts, a save writes only the parts that changed, and everything
// (load, backup, delete, older one-list pages) still sees whole pages. A small in-memory IndexedDB stands in.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function fakeIndexedDB() {
  const stores = new Map(); // name -> Map(key -> value)
  const log = { puts: [], deletes: [] };
  const later = (fn) => setTimeout(fn, 0);
  function transaction(names) {
    const tx = { pending: 0, done: false };
    const finish = () => later(() => { if (!tx.pending && !tx.done) { tx.done = true; tx.oncomplete?.(); } });
    const req = (work) => {
      const r = {};
      tx.pending += 1;
      later(() => {
        r.result = work();
        r.onsuccess?.();
        tx.pending -= 1;
        finish();
      });
      return r;
    };
    tx.objectStore = (name) => {
      if (![].concat(names).includes(name)) throw new Error(`store ${name} not in this transaction`);
      const data = stores.get(name);
      return {
        get: (key) => req(() => structuredClone(data.get(key))),
        getAll: () => req(() => [...data.values()].map((v) => structuredClone(v))),
        getAllKeys: () => req(() => [...data.keys()]),
        put: (value) => req(() => { log.puts.push([name, value.id]); data.set(value.id, structuredClone(value)); return value.id; }),
        delete: (key) => req(() => { log.deletes.push([name, key]); data.delete(key); }),
      };
    };
    finish();
    return tx;
  }
  const db = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore: (name) => stores.set(name, new Map()),
    transaction,
  };
  return {
    stores, log,
    indexedDB: {
      open() {
        const r = { result: db };
        later(() => { r.onupgradeneeded?.(); r.onsuccess?.(); });
        return r;
      },
    },
  };
}

function load() {
  const fake = fakeIndexedDB();
  let n = 0;
  const window = {};
  const context = {
    window, self: { crypto: { getRandomValues: (bytes) => bytes.map(() => n++ % 251) } },
    indexedDB: fake.indexedDB, navigator: {}, localStorage: { getItem: () => null, setItem() {} },
    IDBKeyRange: {}, structuredClone, setTimeout, Date, Math, JSON, Map, Set, WeakMap, Float64Array, Uint32Array, Promise, Array, Object, String, Number, Error,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve("../notebooks.js"), "utf8"), context);
  return { N: window.SkybridgeNotebooks, fake };
}

const stroke = (i, extra = {}) => ({
  id: `s${i}x${(i * 7919).toString(36)}`, color: "ink", eraser: false, hl: false, width: 2.6, sim: false,
  points: Array.from({ length: 20 }, (_, k) => [i * 3 + k * 0.1, i * 2 + Math.sin(k) * 4, 0.5]), ...extra,
});
// What the board does: it saves its live strokes, and copyStroke leaves out what is only for the screen.
const copyStroke = (s) => { const { done, pen, ...rest } = s; return { ...rest, points: s.points.map((p) => [...p]) }; };
const plain = (list) => list.map(copyStroke);
const inkPuts = (fake) => fake.log.puts.filter(([store, id]) => store === "ink" && id.includes("~")).length;
const parts = (fake) => [...fake.stores.get("ink").values()].filter((r) => r.of);

(async () => {
  const { N, fake } = load();
  const meta = await N.create("Big page");
  const live = Array.from({ length: 600 }, (_, i) => ({ ...stroke(i), done: true, pen: true }));

  // A first save writes every part; the page loads back exactly.
  await N.save(meta.id, { strokes: live, copy: copyStroke, view: { x: 1, y: 2, zoom: 0.5 } });
  const first = inkPuts(fake);
  assert.ok(first >= 6, `expected several parts, got ${first}`);
  let back = await N.load(meta.id);
  assert.deepEqual(back.strokes, plain(live));
  assert.deepEqual(back.view, { x: 1, y: 2, zoom: 0.5 });
  assert.equal(back.meta.count, 600);

  // Saving again with nothing changed writes no parts.
  fake.log.puts.length = 0;
  await N.save(meta.id, { strokes: live, copy: copyStroke, view: { x: 1, y: 2, zoom: 0.5 } });
  assert.equal(inkPuts(fake), 0);

  // One new stroke at the end: one part written. One stroke recoloured in the middle: one part.
  fake.log.puts.length = 0;
  live.push({ ...stroke(600), done: true });
  await N.save(meta.id, { strokes: live, copy: copyStroke, view: { x: 1, y: 2, zoom: 0.5 } });
  assert.equal(inkPuts(fake), 1);
  fake.log.puts.length = 0;
  live[300].color = "mark-2";
  await N.save(meta.id, { strokes: live, copy: copyStroke, view: { x: 1, y: 2, zoom: 0.5 } });
  assert.equal(inkPuts(fake), 1);

  // Moved (new points), erased from the middle, and an undo that puts it back.
  live[10] = { ...live[10], points: live[10].points.map(([x, y, p]) => [x + 5, y + 5, p]) };
  const [gone] = live.splice(200, 1);
  fake.log.puts.length = 0;
  await N.save(meta.id, { strokes: live, copy: copyStroke, view: { x: 1, y: 2, zoom: 0.5 } });
  assert.ok(inkPuts(fake) <= 2, `move + erase wrote ${inkPuts(fake)} parts`);
  back = await N.load(meta.id);
  assert.deepEqual(back.strokes, plain(live));
  live.splice(200, 0, gone);
  await N.save(meta.id, { strokes: live, copy: copyStroke });
  back = await N.load(meta.id);
  assert.deepEqual(back.strokes, plain(live));
  assert.deepEqual(back.view, { x: 1, y: 2, zoom: 0.5 }, "an ink save without a view keeps the view");

  // No part is left behind that the page does not use.
  const used = new Set(fake.stores.get("ink").get(meta.id).parts);
  assert.deepEqual(new Set(parts(fake).map((p) => p.id)), used);

  // A view-only save and a details-only save write no strokes at all.
  fake.log.puts.length = 0;
  await N.save(meta.id, { view: { x: 9, y: 9, zoom: 2 }, meta: { seen: 3 } });
  await N.save(meta.id, { meta: { title: "Inverse matrices" }, touch: false });
  assert.equal(inkPuts(fake), 0);
  back = await N.load(meta.id);
  assert.deepEqual(back.view, { x: 9, y: 9, zoom: 2 });
  assert.equal(back.meta.title, "Inverse matrices");
  assert.equal(back.meta.seen, 3);
  assert.deepEqual(back.strokes, plain(live));

  // After a reload (fresh copies of the strokes, as the board makes them), an unchanged page writes nothing.
  const reopened = back.strokes.map((s) => ({ ...s, done: true }));
  fake.log.puts.length = 0;
  await N.save(meta.id, { strokes: reopened, copy: copyStroke });
  assert.equal(inkPuts(fake), 0);

  // A backup holds whole pages, as before, and restoring one gives the same page.
  const dumped = await N.dump();
  assert.ok(dumped.ink.every((record) => !record.of && !record.parts));
  const record = dumped.ink.find((r) => r.id === meta.id);
  assert.deepEqual(record.strokes, plain(live));

  // Deleting a page takes its parts too; Undo puts it all back.
  const removed = await N.remove(meta.id);
  assert.equal(parts(fake).length, 0);
  assert.deepEqual(removed.strokes, plain(live));
  await N.restore(removed);
  back = await N.load(meta.id);
  assert.deepEqual(back.strokes, plain(live));

  // A page stored the old way (one list) still loads, and moves to parts on its next save.
  const old = await N.create("Old page");
  fake.stores.get("ink").set(old.id, { id: old.id, strokes: plain(live.slice(0, 50)), view: { x: 0, y: 0, zoom: 1 } });
  back = await N.load(old.id);
  assert.deepEqual(back.strokes, plain(live.slice(0, 50)));
  await N.save(old.id, { view: { x: 3, y: 3, zoom: 1 } });
  const moved = fake.stores.get("ink").get(old.id);
  assert.ok(Array.isArray(moved.parts) && !moved.strokes);
  back = await N.load(old.id);
  assert.deepEqual(back.strokes, plain(live.slice(0, 50)));
  assert.deepEqual(back.view, { x: 3, y: 3, zoom: 1 });

  // A backup restored over pages already here replaces their parts cleanly.
  const before = parts(fake).length;
  await N.merge({ books: [{ ...back.meta, edited: Date.now() + 1000, hash: "new" }], ink: [{ id: old.id, strokes: plain(live.slice(0, 5)), view: { x: 0, y: 0, zoom: 1 } }] });
  back = await N.load(old.id);
  assert.deepEqual(back.strokes, plain(live.slice(0, 5)));
  assert.ok(parts(fake).length < before);

  console.log("notebooks: ok");
})().catch((error) => { console.error(error); process.exit(1); });
