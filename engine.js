/*
 * The master switch: which engine the smart features use. One choice for everything, and a plain record of which
 * engine answered each feature last time, so nobody has to open each section to find out what is being used.
 *
 *   hybrid  the local model first (when it is set up for the job), then Gemini Live (when switched on), then Gemini
 *   gemini  Gemini's free models only
 *   local   your local model only; nothing leaves for Gemini
 *   live    Gemini Live (experimental) for what it can do (page names, To text), Gemini for the rest
 *
 * window.SkybridgeEngine = { choice(), set(choice), local(), live(), gemini(), plan(feature), record(feature, entry), last(feature), onChange(fn), FEATURES, CHOICES, ago(ms) }
 */
(() => {
  const KEY = "skybridge.engine";
  const LAST = "skybridge.engineLast";
  const CHOICES = [
    { id: "hybrid", label: "Hybrid", hint: "Auto: your local model first when it can do the job, then Gemini Live if it is on, then Gemini. When one fails or is used up, the next one answers." },
    { id: "gemini", label: "Gemini", hint: "Only Gemini's free models. The local model and Live are not used." },
    { id: "local", label: "Local model", hint: "Only your local model. Nothing is sent to Gemini. Things it can't do are told so instead of failing quietly." },
    { id: "live", label: "Gemini Live", hint: "Experimental. Live reads page names and To text (it has no daily limit). Check my work, practice and PDFs still use Gemini, because Live can't do them reliably." },
  ];
  // What each feature needs: a picture, or only words, or a PDF.
  const FEATURES = [
    { id: "naming", label: "Page names", needs: "image", live: true },
    { id: "totext", label: "To text", needs: "image", live: true },
    { id: "check", label: "Check my work", needs: "image", live: false },
    { id: "practice", label: "Practice problems", needs: "text", live: false },
    { id: "homework", label: "Homework PDF", needs: "pdf", live: false },
  ];
  const listeners = new Set();
  const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

  // First run after this change: carry over what the separate settings said.
  function migrated() {
    const local = read("skybridge.local") || {};
    const live = read("skybridge.live") || {};
    if (local.url && local.mode === "only") return "local";
    if (local.url && local.mode === "off" && !live.on) return "gemini";
    return "hybrid";
  }
  let current = (() => {
    const saved = read(KEY);
    if (saved && CHOICES.some((c) => c.id === saved.choice)) return saved.choice;
    const first = migrated();
    write(KEY, { choice: first });
    return first;
  })();
  let lastSeen = read(LAST) || {};

  const choice = () => current;
  function set(next) {
    if (!CHOICES.some((c) => c.id === next) || next === current) return;
    current = next;
    write(KEY, { choice: next });
    listeners.forEach((fn) => fn());
  }
  // May each engine be used at all under this choice? (Whether it is set up is the engine's own business.)
  const local = () => current === "hybrid" || current === "local";
  const live = () => current === "hybrid" || current === "live";
  const gemini = () => current !== "local";

  function record(feature, entry) {
    lastSeen = { ...lastSeen, [feature]: { ...entry, at: Date.now() } };
    write(LAST, lastSeen);
    listeners.forEach((fn) => fn());
  }
  const last = (feature) => lastSeen[feature] || null;

  const NAMES = { local: "Local model", live: "Gemini Live", gemini: "Gemini" };

  // The engines this feature would go through right now, in order, or the reason it can't.
  function plan(feature) {
    const spec = FEATURES.find((f) => f.id === feature);
    const Local = window.SkybridgeLocal;
    const Live = window.SkybridgeLive;
    const AI = window.SkybridgeAI;
    const steps = [];
    const notes = [];
    const wants = { image: spec.needs === "image" || spec.needs === "pdf", pdf: false };
    if (local()) {
      const set = Boolean(Local?.endpoint(Local.config().url));
      if (!set) { if (current === "local") notes.push("Set up the local model first"); }
      else if (wants.image && !Local.config().vision) { if (current === "local") notes.push("Turn on \"Can it read pictures\" for the local model"); else notes.push("local model can't read pictures"); }
      else steps.push("local");
    }
    if (live() && spec.live) {
      const configured = current === "live" || Boolean(Live?.config().on);
      if (configured && Live && AI?.hasGeminiKey()) steps.push("live");
    }
    if (gemini()) {
      if (AI?.hasGeminiKey()) steps.push("gemini");
      else notes.push("needs a Gemini key");
    }
    return { steps, notes };
  }

  const planText = (feature) => {
    const { steps, notes } = plan(feature);
    if (!steps.length) return notes.join("; ") || "Not set up";
    return steps.map((s) => NAMES[s]).join(" then ") + (notes.length && current === "hybrid" ? ` (${notes.join("; ")})` : "");
  };

  function ago(then) {
    const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 45) return "just now";
    if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
    return `${Math.round(seconds / 86400)} d ago`;
  }

  // "Local model (qwen) 2 min ago" or "Gemini 2.5 Flash 2 min ago, after Local model: couldn't reach the server".
  function lastText(feature) {
    const item = last(feature);
    if (!item) return "Not used yet";
    const trail = (item.trail || []).map((t) => `${NAMES[t.engine] || t.engine}: ${t.why}`).join("; ");
    if (!item.ok) {
      const error = item.error || "no answer";
      const extra = (item.trail || []).filter((t) => !error.includes(t.why)).map((t) => `${NAMES[t.engine] || t.engine}: ${t.why}`).join("; ");
      return `Failed ${ago(item.at)}: ${error}${extra ? ` (${extra})` : ""}`;
    }
    const who = `${NAMES[item.engine] || item.engine}${item.model && item.model !== NAMES[item.engine] && item.model !== "your local model" ? ` (${item.model})` : ""}`;
    return `${who}, ${ago(item.at)}${trail ? `, after ${trail}` : ""}`;
  }

  window.SkybridgeEngine = { choice, set, local, live, gemini, plan, planText, record, last, lastText, onChange: (fn) => listeners.add(fn), FEATURES, CHOICES, NAMES, ago };
})();
