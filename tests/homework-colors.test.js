// Run: node tests/homework-colors.test.js
const assert = require("node:assert/strict");
const C = require("../homework-colors.js");
const copy = (v) => JSON.parse(JSON.stringify(v));
function fixture() {
  const sets = new Map(["a", "b"].map((id) => [id, { id, name: `Homework ${id}`, problems: [0, 1, 2, 3].map((i) => ({ label: `3${String.fromCharCode(65 + i)}`, text: "Find the inverse of A.", lines: ["A=\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}"] })) }]));
  const make = (id, set, index, source = "homework") => ({
    meta: { id, name: id, folder: "folder", problem: { source, set, index, title: "3A", text: "Original text", lines: ["A=[1 2; 3 4]"], pinned: true } },
    strokes: [
      { id: `${id}-question`, pin: true, color: "ink", points: [[10, 20], [300, 400]], rich: { sig: "original", titleColor: null, ink: "ink", text: "Original text", lines: ["A=[1 2; 3 4]"] } },
      { id: `${id}-student`, color: "#2f6fd6", points: [[1, 2], [3, 4]] },
    ], view: { x: 20, y: 30, zoom: 1.5 },
  });
  const pages = new Map([make("p0", "a", 0), make("p1", "a", 1), make("copy1", "a", 1), make("other", "b", 0), make("practice", null, 0, "practice")].map((r) => [r.meta.id, r]));
  let failId = null;
  const env = {
    notebooks: {
      list: async () => [...pages.values()].map((r) => copy(r.meta)), load: async (id) => pages.has(id) ? copy(pages.get(id)) : null,
      save: async (id, data) => {
        if (failId === id) { failId = null; throw new Error("test storage failure"); }
        const old = pages.get(id); const next = { ...old, meta: { ...old.meta, ...copy(data.meta) }, strokes: copy(data.strokes) }; pages.set(id, next); return next.meta;
      },
    },
    homework: { list: async () => copy([...sets.values()]), get: async (id) => sets.has(id) ? copy(sets.get(id)) : null, restore: async (set) => { sets.set(set.id, copy(set)); } },
  };
  return { pages, sets, env, fail: (id) => { failId = id; } };
}
(async () => {
  for (const paper of ["#0d1613", "#e6e3dc", "#ddd2bb", "#777777", "#526370"]) for (const preset of C.PRESETS) {
    const shaded = C.combo(preset.id, "shade", paper), same = C.combo(preset.id, "same", paper);
    assert.ok(C.valid(shaded)); assert.equal(same.text, same.math); assert.notEqual(shaded.text, shaded.title);
    for (const role of ["text", "math", "title"]) assert.ok(C.contrast(shaded[role], paper) >= 4.5, `${preset.id}/${role} unreadable on ${paper}`);
  }
  console.log("ok - coordinated presets and matching maths remain readable on light, dark and custom paper");
  const colors = C.combo("ocean", "shade");
  {
    const { pages, sets, env } = fixture(); const original = copy(pages.get("p0"));
    const result = await C.apply({ scope: "current", currentId: "p0", pages: ["p1"], problems: [{ set: "a", index: 3 }], colors }, env);
    assert.deepEqual(result.pageIds, ["p0"]); assert.equal(sets.get("a").colors, undefined);
    assert.deepEqual(pages.get("p0").strokes[1], original.strokes[1]); assert.deepEqual(pages.get("p0").view, original.view);
    assert.deepEqual(pages.get("p0").strokes[0].points, original.strokes[0].points);
    const changed = pages.get("p0"); changed.strokes.push({ id: "new-student-ink", color: "ink", points: [[8, 9], [10, 11]] }); changed.strokes[0].points = [[40, 50], [330, 430]]; changed.meta.name = "Renamed"; changed.meta.done = true;
    await result.undo();
    const restored = pages.get("p0"); assert.equal(restored.strokes[0].color, "ink"); assert.equal(restored.strokes.length, 3); assert.deepEqual(restored.strokes[0].points, [[40, 50], [330, 430]]);
    assert.equal(restored.meta.name, "Renamed"); assert.equal(restored.meta.done, true); assert.equal(restored.meta.problem.colors, undefined);
  }
  console.log("ok - this-page scope and Undo preserve geometry, subsequent student ink and page metadata");
  {
    const { pages, sets, env } = fixture();
    const result = await C.apply({ scope: "selected", pages: ["p1"], problems: [{ set: "a", index: 3 }], colors }, env);
    assert.deepEqual(result.pageIds, ["p1"]); assert.equal(pages.get("copy1").strokes[0].color, "ink"); assert.equal(pages.get("other").strokes[0].color, "ink");
    assert.deepEqual(C.coloursFor(sets.get("a"), 3), colors); assert.equal(C.coloursFor(sets.get("a"), 2), null);
  }
  console.log("ok - selected note pages leave duplicate/other pages alone; unplaced problems inherit selected colours");
  {
    const { pages, sets, env } = fixture(); sets.get("a").problemColors = { 1: C.combo("plum", "same") };
    const result = await C.apply({ scope: "homework", currentSet: "a", colors }, env);
    assert.deepEqual(result.pageIds.sort(), ["copy1", "p0", "p1"]); assert.deepEqual(sets.get("a").problemColors, {});
    assert.deepEqual(C.coloursFor(sets.get("a"), 2), colors); assert.equal(pages.get("other").strokes[0].color, "ink");
    await result.undo(); assert.equal(sets.get("a").colors, undefined); assert.ok(sets.get("a").problemColors[1]);
  }
  console.log("ok - one homework updates existing and future pages, replaces overrides, and can be undone");
  {
    const { pages, sets, env } = fixture();
    const result = await C.apply({ scope: "all", colors }, env);
    assert.equal(result.sets, 2); assert.equal(result.pageIds.length, 4); assert.equal(pages.get("practice").strokes[0].color, "ink"); assert.deepEqual(sets.get("b").colors, colors);
  }
  console.log("ok - all homework covers every saved PDF without recolouring practice pages");
  {
    const { pages, sets, env, fail } = fixture(); const beforePages = copy([...pages]), beforeSets = copy([...sets]); fail("p1");
    await assert.rejects(C.apply({ scope: "all", colors }, env), /storage failure/);
    assert.deepEqual([...pages], beforePages); assert.deepEqual([...sets], beforeSets);
    await assert.rejects(C.apply({ scope: "selected", colors }, env), /Choose at least/);
  }
  console.log("ok - failed batch edits roll back and empty selection cannot change homework");
  console.log("all homework colour tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
