// Run: node tests/thunder.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../effects.js"), "utf8");
const stormCode = source.slice(source.indexOf("  const storm ="), source.indexOf("  // ---- wind"));
function setup(supportAudio = true) {
  const calls = { contexts: 0, buffers: 0, starts: [], stops: [], fills: [], gradients: [] };
  const ctx = {
    state: { mode: "rain", k: 1, thunder: true, sound: false },
    reduced: { matches: false }, document: { hidden: false }, root: { dataset: {} }, light: false,
    rnd: () => 0, between: (a) => a, window: {},
  };
  const node = () => ({ connect() {}, disconnect() {} });
  class AudioContext {
    constructor() { calls.contexts++; this.state = "running"; this.currentTime = 0; this.sampleRate = 100; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createBuffer(channels, length) { calls.buffers++; return { getChannelData: () => new Float32Array(length) }; }
    createBufferSource() { return { ...node(), playbackRate: {}, start: (time) => calls.starts.push(time), stop: (time) => calls.stops.push(time) }; }
    createBiquadFilter() { return { ...node(), frequency: {}, Q: {} }; }
    createGain() { return { ...node(), gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} } }; }
  }
  if (supportAudio) ctx.window.AudioContext = AudioContext;
  vm.createContext(ctx);
  vm.runInContext(stormCode + "\nthis.stormState = storm; this.voicesSet = voices;", ctx);
  const surface = { cv: { width: 500, height: 80 }, g: {
    createLinearGradient: () => ({ addColorStop: (at, colour) => calls.gradients.push({ at, colour }) }),
    fillRect: (...args) => calls.fills.push(args),
  } };
  return { ctx, calls, surface };
}
const run = (name, fn) => { fn(); console.log("ok -", name); };
run("lightning waits, uses one shared pulse, and is at least eight seconds apart", () => {
  const { ctx, calls, surface } = setup();
  ctx.stormStep(100); assert.equal(ctx.stormState.at, null); assert.equal(ctx.stormState.next, 108);
  ctx.stormStep(107.9); assert.equal(ctx.stormState.at, null);
  ctx.stormStep(108); assert.equal(ctx.stormState.at, 108); assert.equal(ctx.stormState.next, 116);
  ctx.stormDraw(surface, 108.35); ctx.stormDraw(surface, 108.35);
  assert.equal(calls.fills.length, 2);
  assert.equal(calls.gradients[1].colour, calls.gradients[4].colour);
  const alpha = Number(calls.gradients[1].colour.match(/,([\d.]+)\)$/)[1]);
  assert.ok(alpha <= 0.12 && alpha > 0);
  ctx.stormStep(108.8); assert.equal(ctx.stormState.at, null);
  assert.equal(calls.contexts, 0, "sound must not initialize itself");
});
run("Off, Wind, reduced motion, a hidden page, writing, and the storm toggle suppress thunder", () => {
  const changes = [c => { c.state.mode = "off"; }, c => { c.state.mode = "wind"; }, c => { c.reduced.matches = true; }, c => { c.document.hidden = true; }, c => { c.root.dataset.writing = "on"; }, c => { c.state.thunder = false; }];
  for (const change of changes) {
    const { ctx, calls, surface } = setup();
    ctx.state.sound = true; ctx.unlockAudio(); ctx.stormStep(100); ctx.stormStep(108);
    assert.equal(calls.starts.length, 1);
    change(ctx); ctx.stormStep(108.35); ctx.stormDraw(surface, 108.35);
    assert.equal(ctx.stormState.at, null); assert.equal(ctx.stormState.next, 0);
    assert.equal(ctx.voicesSet.size, 0); assert.equal(calls.fills.length, 0);
    assert.ok(calls.stops.includes(0.08), "an existing rumble must be stopped");
  }
});
run("sound is opt-in, gesture-unlocked, delayed after lightning, and reuses its buffer", () => {
  const { ctx, calls } = setup();
  ctx.unlockAudio(); assert.equal(calls.contexts, 0);
  ctx.state.sound = true; ctx.rumble(); assert.equal(calls.starts.length, 0);
  ctx.unlockAudio(); ctx.rumble(); ctx.rumble();
  assert.equal(calls.contexts, 1); assert.equal(calls.buffers, 1);
  assert.deepEqual(calls.starts, [0.45, 0.45]);
  ctx.stopRumble(); assert.equal(ctx.voicesSet.size, 0);
});
run("sound unavailable still allows visual lightning", () => {
  const { ctx, calls, surface } = setup(false);
  ctx.state.sound = true;
  ctx.unlockAudio(); ctx.stormStep(0); ctx.stormStep(8); ctx.stormDraw(surface, 8.35);
  assert.equal(calls.fills.length, 1); assert.equal(calls.starts.length, 0);
});
console.log("all thunder tests passed");
