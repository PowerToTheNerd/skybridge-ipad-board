// Run: node tests/shapes.test.js
// Shape snapping: wobbly hand-drawn shapes become clean ones; handwriting and unsure strokes are left alone.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ctx = { window: {}, console };
ctx.window.window = ctx.window;
ctx.document = { createElement: () => ({ getContext: () => ({}) }) };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require.resolve("../../experimental-html-ui/inkstroke.js"), "utf8"), ctx);
const Ink = ctx.window.SkybridgeInk;

let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
const wobble = (amount) => (point) => [point[0] + rand() * amount, point[1] + rand() * amount];
const line = (a, b, n = 30) => Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / (n - 1), a[1] + ((b[1] - a[1]) * i) / (n - 1)]);
const path = (...corners) => corners.slice(1).flatMap((c, i) => line(corners[i], c, 24).slice(i ? 1 : 0));
const ellipse = (cx, cy, rx, ry, tilt = 0, turns = 1.02, from = 0.3) => Array.from({ length: 90 }, (_, i) => {
  const t = from + (i / 89) * turns * Math.PI * 2;
  const x = rx * Math.cos(t);
  const y = ry * Math.sin(t);
  return [cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)];
});
const kind = (points, opts) => Ink.snapKind(points.map(wobble(2.5)), opts)?.kind || null;
const run = (name, fn) => { fn(); console.log("ok -", name); };

run("circles, ellipses and tilted ellipses", () => {
  assert.equal(kind(ellipse(200, 200, 60, 58)), "circle");
  assert.equal(kind(ellipse(200, 200, 90, 45)), "ellipse");
  assert.equal(kind(ellipse(200, 200, 90, 45, 0.6)), "ellipse");
  const level = Ink.snapKind(ellipse(200, 200, 90, 45, 0.05));
  const ys = level.points.map((p) => p[1]);
  assert.ok(Math.abs((Math.max(...ys) - Math.min(...ys)) / 2 - 45) < 1.5, "a near-level ellipse is made level");
});
run("a circle ends where it began", () => {
  const { points } = Ink.snapKind(ellipse(200, 200, 60, 60));
  assert.ok(Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < 0.5);
});
run("rectangles and squares, level or tilted", () => {
  assert.equal(kind(path([100, 100], [260, 100], [260, 190], [100, 190], [102, 104])), "rectangle");
  assert.equal(kind(path([100, 100], [200, 100], [200, 200], [100, 200], [101, 103])), "square");
  const t = (p) => [150 + (p[0] - 150) * Math.cos(0.5) - (p[1] - 150) * Math.sin(0.5), 150 + (p[0] - 150) * Math.sin(0.5) + (p[1] - 150) * Math.cos(0.5)];
  assert.equal(kind(path([80, 110], [240, 110], [240, 200], [80, 200], [82, 114]).map(t)), "rectangle");
  const clean = Ink.snapKind(path([100, 100], [260, 100], [260, 190], [100, 190], [100, 100]).map(wobble(2)));
  const xs = clean.points.map((p) => p[0]);
  assert.ok(new Set(xs.map((x) => Math.round(x))).size <= 80, "a level rectangle has straight sides");
});
run("triangles", () => {
  assert.equal(kind(path([100, 200], [200, 80], [300, 200], [104, 198])), "triangle");
});
run("arrows", () => {
  const arrow = [...path([100, 200], [300, 200]), ...path([300, 200], [270, 178]).slice(1), ...path([270, 178], [300, 200]).slice(1), ...path([300, 200], [270, 222]).slice(1)];
  assert.equal(kind(arrow), "arrow");
  const down = [...path([200, 80], [200, 280]), ...path([200, 280], [178, 250]).slice(1), ...path([178, 250], [200, 280]).slice(1), ...path([200, 280], [222, 250]).slice(1)];
  assert.equal(kind(down), "arrow");
});
run("lines and brackets still snap", () => {
  assert.equal(kind(line([50, 50], [250, 54])), "line");
  const bracket = [[120, 60], [100, 62], [100, 130], [100, 200], [120, 202]];
  assert.equal(kind(path(...bracket)), "bracket");
});
run("handwriting-sized shapes are left alone by a page-wide pass, but snap when asked for", () => {
  const small = ellipse(100, 100, 12, 14);
  assert.equal(kind(small, { minSize: 70 }), null);
  assert.equal(kind(small), null, "below the 40px floor, even when held");
  assert.equal(kind(ellipse(100, 100, 22, 22)), "circle");
  assert.equal(kind(ellipse(100, 100, 22, 22), { minSize: 70 }), null);
});
run("loose scribbles, open arcs and zigzags are not shapes", () => {
  assert.equal(kind(ellipse(200, 200, 70, 70, 0, 0.55)), null, "a half circle");
  assert.equal(kind(path([100, 100], [200, 160], [110, 200], [210, 120], [120, 90])), null, "a squiggle");
  assert.equal(kind(path([100, 100], [200, 100], [200, 200], [120, 200], [100, 150])), null, "a gap in the box");
  const zig = Array.from({ length: 60 }, (_, i) => [100 + i * 3, 150 + (i % 2 ? 40 : -40)]);
  assert.equal(kind(zig), null);
});
run("a lumpy blob is not a circle", () => {
  const blob = Array.from({ length: 90 }, (_, i) => {
    const t = (i / 89) * Math.PI * 2 * 1.02;
    const r = 60 + 25 * Math.sin(3 * t);
    return [200 + r * Math.cos(t), 200 + r * Math.sin(t)];
  });
  assert.equal(kind(blob), null);
  assert.equal(kind(blob, { careful: true }), null);
});
run("snap() returns plain [x, y] points", () => {
  const points = Ink.snap(ellipse(200, 200, 60, 60).map((p) => [...p, 0.5]));
  assert.ok(points.length > 20 && points.every((p) => p.length === 2));
});
