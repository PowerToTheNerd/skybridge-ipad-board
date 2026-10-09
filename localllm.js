/*
 * A local model: any OpenAI-compatible server (Unsloth Studio, llama.cpp, Ollama, LM Studio...) at an
 * address and key you type. The key stays on this iPad. ai.js tries it first (or only), and falls back to Gemini.
 *
 * Where the request goes depends on the page:
 *  - an https address (a Tailscale or Cloudflare tunnel, Tailscale HTTPS...) is called straight from the iPad;
 *  - an http address works straight from the iPad only when this page is itself http (opened from the PC);
 *  - this page, served from GitHub, is https, and a browser will not let https call http (mixed content). So
 *    the request goes through Skybridge on the PC, which makes the call (and only to a local address). The PC
 *    has to be on, and the address is the one the PC would use (http://127.0.0.1:8888/v1 for a server on the PC).
 *
 * window.SkybridgeLocal = { config(), save(patch), usable({image,pdf}), route(), chat({prompt,image,schema,temperature}), test(), explainRoute(), attach(bridge), onRelay(message), label() }
 */
(() => {
  const KEY = "skybridge.local";
  const TIMEOUT_MS = 120000;
  const DEFAULTS = { url: "", key: "", model: "", vision: false, mode: "first" };
  let bridge = null; // { ready(): bool, send(message) } to the PC
  const waits = new Map();

  class LocalError extends Error {
    constructor(message, kind = "local") { super(message); this.kind = kind; }
  }

  function config() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...DEFAULTS }; }
  }
  function save(patch) {
    const next = { ...config(), ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
    return next;
  }

  // The chat endpoint for what was typed: http://host:8888, .../v1 and the full path all work.
  function endpoint(raw) {
    let text = String(raw || "").trim();
    if (!text) return "";
    if (!/^[a-z]+:\/\//i.test(text)) text = `http://${text}`;
    let url;
    try { url = new URL(text); } catch { return ""; }
    if (!/^https?:$/.test(url.protocol)) return "";
    let path = url.pathname.replace(/\/+$/, "");
    if (!/\/chat\/completions$/.test(path)) path += /\/v\d+$/.test(path) ? "/chat/completions" : "/v1/chat/completions";
    url.pathname = path;
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  const mixed = (url) => location.protocol === "https:" && /^http:/i.test(url);
  const route = () => {
    const url = endpoint(config().url);
    if (!url) return "none";
    return mixed(url) ? "relay" : "direct";
  };

  function explainRoute() {
    const cfg = config();
    const url = endpoint(cfg.url);
    if (!url) return "Type your server's address, for example http://127.0.0.1:8888/v1.";
    if (mixed(url)) {
      return "This page is https, and a browser won't let an https page call an http address directly. So requests go through Skybridge on your PC, which must be on, and the address must be one the PC can reach (http://127.0.0.1:8888/v1 for a server on the PC). For use without the PC, give an https address (a Tailscale or Cloudflare tunnel).";
    }
    return /^https:/i.test(url)
      ? "This https address is called straight from the iPad, so it works without the PC. The server must allow requests from this page (CORS)."
      : "This page is http, so the iPad calls the address directly. The server must allow requests from this page (CORS).";
  }

  const label = () => config().model || "your local model";

  // Is it set up for a request of this kind?
  function usable({ image = false, pdf = false } = {}) {
    const cfg = config();
    if (!endpoint(cfg.url) || cfg.mode === "off" || pdf) return false;
    return !image || cfg.vision;
  }

  function bodyFor(cfg, { prompt, image, schema, temperature }, json) {
    const instruction = schema
      ? `${prompt}\n\nReply with ONE JSON object only, no commentary, matching this schema: ${JSON.stringify(schema)}`
      : prompt;
    const content = image
      ? [{ type: "text", text: instruction }, { type: "image_url", image_url: { url: `data:image/png;base64,${image}` } }]
      : instruction;
    return {
      model: cfg.model || "local",
      messages: [{ role: "user", content }],
      temperature: typeof temperature === "number" ? Math.min(temperature, 1) : 0,
      stream: false,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    };
  }

  const textOf = (data) => {
    const content = data?.choices?.[0]?.message?.content;
    if (Array.isArray(content)) return content.map((part) => part?.text || "").join("");
    return String(content || "");
  };

  async function direct(url, cfg, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await response.text();
      let data = null;
      try { data = JSON.parse(raw); } catch {}
      if (!response.ok) return { ok: false, status: response.status, error: data?.error?.message || data?.detail || raw.slice(0, 200) || `The server answered ${response.status}.` };
      return { ok: true, text: textOf(data) };
    } catch (error) {
      if (error.name === "AbortError") return { ok: false, status: 0, error: "The local model took too long." };
      return { ok: false, status: 0, network: true, error: "Couldn't reach the local server." };
    } finally {
      clearTimeout(timer);
    }
  }

  function viaPc(url, cfg, body) {
    return new Promise((resolve) => {
      if (!bridge?.ready()) { resolve({ ok: false, status: 0, error: "This address goes through Skybridge, and your PC isn't connected." }); return; }
      const id = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const timer = setTimeout(() => { waits.delete(id); resolve({ ok: false, status: 0, error: "No answer from the PC." }); }, TIMEOUT_MS + 5000);
      waits.set(id, { resolve, timer });
      bridge.send({ t: "llm", id, url, key: cfg.key, body });
    });
  }

  function onRelay(message) {
    const wait = waits.get(message.id);
    if (!wait) return;
    waits.delete(message.id);
    clearTimeout(wait.timer);
    wait.resolve({ ok: message.ok === true, status: message.status || 0, text: String(message.text || ""), error: String(message.error || "") });
  }

  async function chat(request) {
    const cfg = config();
    const url = endpoint(cfg.url);
    if (!url) throw new LocalError("No local model address is set.");
    const send = (body) => (mixed(url) ? viaPc(url, cfg, body) : direct(url, cfg, body));
    let result = await send(bodyFor(cfg, request, true));
    // A server that doesn't know response_format: ask again without it.
    if (!result.ok && result.status >= 400 && result.status < 500 && /response_format|json_object|json/i.test(result.error)) result = await send(bodyFor(cfg, request, false));
    // Blocked by the browser (no CORS) while a PC is paired: let the PC make the call.
    if (!result.ok && result.network && !mixed(url) && bridge?.ready()) result = await viaPc(url, cfg, bodyFor(cfg, request, true));
    if (!result.ok) {
      const why = result.status === 401 || result.status === 403 ? "The local server didn't accept the key." : result.error;
      throw new LocalError(why || "The local model didn't answer.");
    }
    if (!result.text.trim()) throw new LocalError("The local model gave an empty answer.");
    return result.text;
  }

  async function test() {
    const started = Date.now();
    try {
      const text = await chat({ prompt: "Reply with the single word: ready", temperature: 0 });
      return { ok: true, text: text.trim().slice(0, 80), ms: Date.now() - started };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  window.SkybridgeLocal = { config, save, endpoint, usable, route, chat, test, explainRoute, attach: (given) => { bridge = given; }, onRelay, label, LocalError };
})();
