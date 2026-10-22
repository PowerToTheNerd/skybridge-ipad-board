// Run: node tests/pen-color.test.js
// A colour you picked is drawn exactly (white stays white, even on light paper); only the built-in pen
// colours are nudged to stay readable on the paper.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = { window: {} };
context.self = context.window;
vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve("../../experimental-html-ui/inkstroke.js"), "utf8"), context);
const Ink = context.window.SkybridgeInk;

const lightPaper = "#e6e3dc";
const darkPaper = "#0d1613";
assert.equal(Ink.penColorOn("#ffffff", lightPaper), "#ffffff");
assert.equal(Ink.penColorOn("#fafafa", lightPaper), "#fafafa");
assert.equal(Ink.penColorOn("#111111", darkPaper), "#111111");
assert.equal(Ink.penColorOn("#3a7bd5", darkPaper), "#3a7bd5");
// A built-in colour too dark for dark paper is still lifted, as before.
assert.notEqual(Ink.penColorOn("#1e1e1e", darkPaper), "#1e1e1e");
assert.equal(Ink.penColorOn("#1e1e1e", darkPaper), Ink.colorOn("#1e1e1e", darkPaper));
console.log("pen-color: ok");
