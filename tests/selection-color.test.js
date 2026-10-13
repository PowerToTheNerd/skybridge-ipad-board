// Run: node tests/selection-color.test.js
// Exercise the actual selection handlers with the same snapshot contract as Undo and relay updates.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../pad.js"), "utf8");
const handlers = source.slice(source.indexOf("  function renderSelectionColorTools()"), source.indexOf('  el.lassoDelete.addEventListener'));
const copy = (value) => JSON.parse(JSON.stringify(value));
const label = {};
const events = {};
const ctx = {
  lasso: { selected: [] }, strokes: [], selectionColorTarget: "all", selectionColorKey: "",
  el: {
    selectionColorTools: {},
    lassoPresets: {},
    selectionColorTarget: { value: "all", addEventListener: (name, fn) => { events[name] = fn; } },
    lassoColor: { querySelector: () => label, setAttribute() {} },
  },
  cssColor: () => "#e3ece6",
  itemOf: (list, stroke) => ({ s: copy(stroke), i: list.indexOf(stroke) }),
  record: (...args) => { ctx.history = copy(args); },
  send: (message) => { ctx.message = copy(message); },
  rebuildBase() {}, schedulePaint() {},
};
vm.createContext(ctx);
vm.runInContext(handlers, ctx);
const select = (strokes) => {
  ctx.strokes = strokes;
  ctx.lasso.selected = strokes;
  ctx.renderSelectionColorTools();
};
const target = (value) => { ctx.el.selectionColorTarget.value = value; events.change(); };
const question = (id = "q", color = "#2f6fd6", rich = {}) => ({
  id, color, pin: true, pg: "group", weight: 1, width: 1, points: [[20, 30], [400, 220]],
  rich: { sig: "saved-layout", text: "Find the inverse of $A$.", lines: ["A=\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}"], nat: [380, 190], titleColor: null, ink: "ink", ...rich },
});
const run = (name, fn) => { fn(); console.log("ok -", name); };

run("text-only preserves inherited maths and title, geometry and source", () => {
  const q = question();
  const original = copy(q);
  select([q]); target("text"); ctx.recolorSelection("#c0392b");
  assert.deepEqual(copy(q), { ...original, color: "#c0392b", rich: { ...original.rich, ink: original.color, titleColor: original.color } });
  assert.deepEqual(ctx.history, ["mine", [{ s: original, i: 0 }], [{ s: copy(q), i: 0 }]]);
  assert.deepEqual(ctx.message, { t: "put", strokes: [{ ...copy(q), i: 0 }] });
});
run("Auto ink does not keep inheriting the new text colour", () => {
  const q = question("auto", "ink");
  select([q]); target("text"); ctx.recolorSelection("#c0392b");
  assert.equal(q.rich.ink, "#e3ece6");
  assert.equal(q.rich.titleColor, "ink");
});
run("maths-only and title-only preserve other roles and skip ink and photos", () => {
  const q = question("mixed", "#2f6fd6", { titleColor: "#8a94a0", ink: "#2f8f4e" });
  const ink = { id: "pen", color: "ink", points: [[1, 2], [3, 4]] };
  const photo = { id: "photo", img: "pic", points: [[1, 2], [3, 4]] };
  const original = copy(q);
  select([q, ink, photo]); target("math"); ctx.recolorSelection("#c0392b");
  assert.deepEqual(copy(q), { ...original, rich: { ...original.rich, ink: "#c0392b" } });
  assert.equal(ink.color, "ink"); assert.equal(photo.color, undefined);
  assert.equal(ctx.message.strokes.length, 1);
  target("title"); ctx.recolorSelection("#7c4fd0");
  assert.equal(q.rich.titleColor, "#7c4fd0"); assert.equal(q.rich.ink, "#c0392b"); assert.equal(q.color, original.color);
});
run("All keeps the existing whole-selection behaviour", () => {
  const q = question("all", "ink", { titleColor: "#8a94a0", ink: "#2f8f4e" });
  const ink = { id: "plain", color: "ink", points: [[1, 2], [3, 4]] };
  select([q, ink]); target("all"); ctx.recolorSelection("#2f6fd6");
  assert.equal(q.color, "#2f6fd6"); assert.equal(q.rich.ink, "ink"); assert.equal(q.rich.titleColor, null);
  assert.equal(ink.color, "#2f6fd6");
});
run("target persists for the same selection and resets for a different selection or no question", () => {
  select([question("first")]); target("math");
  ctx.renderSelectionColorTools(); assert.equal(ctx.selectionColorTarget, "math");
  select([question("second")]); assert.equal(ctx.selectionColorTarget, "all");
  target("title"); select([{ id: "plain", color: "ink" }]);
  assert.equal(ctx.selectionColorTarget, "all"); assert.equal(ctx.el.selectionColorTools.hidden, true);
  assert.equal(label.textContent, "Colour");
});
run("notebook change tracking includes maths and title colours without changing the layout signature", () => {
  const notebook = fs.readFileSync(require.resolve("../notebooks.js"), "utf8");
  vm.runInContext(notebook.slice(notebook.indexOf("  function hashOf(strokes)"), notebook.indexOf("  // Saves the strokes and view")), ctx);
  const q = question(); const original = ctx.hashOf([q]);
  q.rich.ink = "#c0392b"; assert.notEqual(ctx.hashOf([q]), original);
  q.rich.ink = "ink"; q.rich.titleColor = "#7c4fd0"; assert.notEqual(ctx.hashOf([q]), original);
  assert.equal(q.rich.sig, "saved-layout");
});
console.log("all selection colour tests passed");
