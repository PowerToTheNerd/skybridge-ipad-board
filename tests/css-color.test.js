// Run: node tests/css-color.test.js
// A colour set on the page must show at once: the paper swatches and the saved paper on startup are read in
// the same step as the paper changes. Only drawing (withColors) may look a colour up once and reuse it.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../pad.js"), "utf8");
const code = source.slice(source.indexOf("  let colorCache = null;"), source.indexOf("  // Fixed palette colours are nudged"));
const vars = { "--paper": "#0d1613" };
const context = {
  document: { documentElement: {} },
  getComputedStyle: () => ({ getPropertyValue: (name) => vars[name] || "" }),
};
vm.createContext(context);
vm.runInContext(code + "\nthis.cssColor = cssColor; this.withColors = withColors;", context);

assert.equal(context.cssColor("paper"), "#0d1613");
vars["--paper"] = "#e6e3dc"; // the white paper, set in the same step
assert.equal(context.cssColor("paper"), "#e6e3dc");

// Inside one drawing the first look-up is kept; after it, the page's colour is read again.
context.withColors(() => {
  assert.equal(context.cssColor("paper"), "#e6e3dc");
  vars["--paper"] = "#141618";
  assert.equal(context.cssColor("paper"), "#e6e3dc");
});
assert.equal(context.cssColor("paper"), "#141618");
console.log("css-color: ok");
