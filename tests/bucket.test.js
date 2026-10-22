// Run: node tests/bucket.test.js
// Paint bucket: tapping fills the walled-in area around the point and leaves enclosed shapes (windows) empty.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ctx = { window: {}, console };
ctx.window.window = ctx.window;
ctx.document = { createElement: () => ({ getContext: () => ({}) }) };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require.resolve("../../experimental-html-ui/inkstroke.js"), "utf8"), ctx);
const Ink = ctx.window.SkybridgeInk;
let id = 0;
const stroke = (...corners) => ({ id: `s${id++}`, width: 2.6, color: "ink", points: corners.flatMap((c, i) => (i ? Array.from({ length: 24 }, (_, k) => [corners[i - 1][0] + ((c[0] - corners[i - 1][0]) * (k + 1)) / 24, corners[i - 1][1] + ((c[1] - corners[i - 1][1]) * (k + 1)) / 24]) : [[...c]])) });
const box = (x0, y0, x1, y1) => stroke([x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]);
const rings = (points) => { const out = []; for (const p of points) { if (p[2] === 0) out.push([]); out.at(-1).push(p); } return out; };
const area = (ring) => Math.abs(ring.reduce((sum, p, i) => sum + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1], 0) / 2);
const inside = (point, list) => { let on = false; for (const ring of list) { let hit = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i]; const [xj, yj] = ring[j]; if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) hit = !hit; } if (hit) on = !on; } return on; };
const run = (name, fn) => { fn(); console.log("ok -", name); };

run("a closed box fills its inside", () => {
  const got = Ink.regionAt([box(100, 100, 300, 250)], [200, 180]);
  assert.ok(got.points, got.error);
  const list = rings(got.points);
  assert.equal(list.length, 1);
  assert.ok(Math.abs(area(list[0]) - 200 * 150) < 200 * 150 * 0.06, `area ${area(list[0])}`);
  assert.ok(inside([200, 180], list) && !inside([60, 60], list));
});
run("a wall with windows: the windows stay empty", () => {
  const wall = box(100, 100, 500, 300);
  const windows = [box(150, 150, 220, 220), box(380, 150, 450, 220)];
  const got = Ink.regionAt([wall, ...windows], [300, 260]);
  assert.ok(got.points, got.error);
  const list = rings(got.points);
  assert.equal(list.length, 3, "outer edge plus two window holes");
  assert.ok(inside([300, 260], list), "the wall is filled");
  assert.ok(!inside([185, 185], list) && !inside([415, 185], list), "the windows are not");
});
run("tapping inside a window fills only the window", () => {
  const got = Ink.regionAt([box(100, 100, 500, 300), box(150, 150, 220, 220)], [185, 185]);
  assert.ok(got.points, got.error);
  const list = rings(got.points);
  assert.equal(list.length, 1);
  assert.ok(area(list[0]) < 80 * 80 && area(list[0]) > 60 * 60);
});
run("a small gap in the outline is closed; a big one is refused", () => {
  const small = stroke([100, 100], [300, 100], [300, 250], [100, 250], [100, 104]);
  assert.ok(Ink.regionAt([small], [200, 170]).points, "a 4 unit gap");
  const open = stroke([100, 100], [300, 100], [300, 250], [100, 250], [100, 160]);
  assert.equal(Ink.regionAt([open], [200, 170]).error, "open");
});
run("tapping outside everything is refused, with no ink there is nothing to fill", () => {
  assert.equal(Ink.regionAt([box(100, 100, 300, 250)], [600, 600]).error, "open");
  assert.equal(Ink.regionAt([], [10, 10]).error, "empty");
});
run("text, photos, highlighters and earlier fills are not walls", () => {
  const solid = box(100, 100, 300, 250);
  const noise = [{ id: "t", text: "x", points: [[0, 0], [400, 400]] }, { id: "i", img: "p", points: [[0, 0], [400, 400]] }, { id: "h", hl: true, width: 14, points: [[200, 90], [200, 260]] }, { id: "a", area: true, points: [[150, 150, 0], [250, 150], [250, 200]] }];
  const got = Ink.regionAt([solid, ...noise], [200, 180]);
  assert.ok(got.points && rings(got.points).length === 1);
});
run("the outline is data-light", () => {
  const circle = { id: "c", width: 2.6, points: Array.from({ length: 200 }, (_, i) => [400 + 200 * Math.cos((i / 199) * Math.PI * 2), 400 + 200 * Math.sin((i / 199) * Math.PI * 2)]) };
  const got = Ink.regionAt([circle], [400, 400]);
  assert.ok(got.points.length < 400, `${got.points.length} points`);
});
run("fills sit under highlighters, which sit under ink", () => {
  const list = [{ id: "ink" }, { id: "hl", hl: true }, { id: "fill", area: true }];
  assert.equal(Array.from(Ink.layered(list), (s) => s.id).join(), "fill,hl,ink");
});
