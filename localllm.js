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
 * window.SkybridgeLocal = { config(), save(patch), usable({image,pdf}), route(), chat({prompt,image,schema,temperature}), cancel(), busy(), onProgress(fn), test(), explainRoute(), attach(bridge), onRelay(message), label() }
 */
(() => {
  const KEY = "skybridge.local";
  const IDLE_MS = 120000; // streaming: give up after this long with no token at all (thinking tokens count)
  const WHOLE_MS = 300000; // an answer that isn't streamed (or goes through the PC): the longest to wait for it
  const DEFAULTS = { url: "", key: "", model: "", vision: false, mode: "first", via: "auto", fast: false }; // via: auto | pc (through Skybridge) | solo (straight from this iPad)
  let bridge = null; // { ready(): bool, send(message) } to the PC
  const waits = new Map();
  const watchers = new Set();
  let running = null; // { cancel(), started } for the request in flight

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
  const loopback = (url) => { try { return /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(new URL(url).hostname); } catch { return false; } };
  // "relay" = through the PC, "direct" = straight from this iPad.
  const route = () => {
    const url = endpoint(config().url);
    if (!url) return "none";
    const via = config().via;
    if (via === "pc") return "relay";
    if (via === "solo") return "direct";
    return mixed(url) ? "relay" : "direct";
  };

  const TAILSCALE = "On the PC run: tailscale serve --bg --https=443 http://127.0.0.1:8888 (use your server's port), then type the https://…ts.net address it prints. The iPad needs the Tailscale app on.";

  function explainRoute() {
    const cfg = config();
    const url = endpoint(cfg.url);
    if (!url) return "Type your server's address, for example http://127.0.0.1:8888/v1.";
    if (route() === "relay") {
      return "Requests go through Skybridge on your PC: pair with it first (Sync with Skybridge) and keep it on. The address must be one the PC can reach, like your PC's own address (http://10.0.0.5:8888/v1). The PC only calls local-network addresses.";
    }
    if (mixed(url)) {
      return "Solo: this iPad calls the address itself. A browser blocks an https page (this one) from calling an http address, so this only works for an https address. " + TAILSCALE;
    }
    return /^https:/i.test(url)
      ? "This https address is called straight from the iPad, so it works without the PC. The server must allow requests from this page (CORS)."
      : "This page is http, so the iPad calls the address directly. The server must allow requests from this page (CORS).";
  }

  // Why a direct call failed: blocked by the browser, refused by the server's CORS rules, or not reachable at all.
  async function whyDirectFailed(url) {
    if (mixed(url) && !loopback(url)) {
      return { kind: "mixed", error: "The browser blocked it: this page is https and the address is http. Use an https address, or switch to Through Skybridge. " + TAILSCALE };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      await fetch(new URL(url).origin + "/", { mode: "no-cors", signal: controller.signal });
      return { kind: "cors", error: "The server is there but didn't let this page call it (CORS). Allow this page's address in the server's CORS or allowed-origins setting, or switch to Through Skybridge." };
    } catch {
      return { kind: "down", error: "Couldn't reach the server. Check the address and port, that the iPad is on the same Wi-Fi (or Tailscale is on), and that the server allows network access." };
    } finally {
      clearTimeout(timer);
    }
  }

  const label = () => config().model || "your local model";

  // Is it set up for a request of this kind?
  function usable({ image = false, pdf = false } = {}) {
    const cfg = config();
    if (!endpoint(cfg.url) || window.SkybridgeEngine?.local() === false || pdf) return false;
    return !image || cfg.vision;
  }

  function bodyFor(cfg, { prompt, image, mime, schema, temperature }, { json = true, fast = false } = {}) {
    const instruction = schema
      ? `${prompt}\n\nReply with ONE JSON object only, no commentary, matching this schema: ${JSON.stringify(schema)}`
      : prompt;
    const content = image
      ? [{ type: "text", text: instruction }, { type: "image_url", image_url: { url: `data:${mime || "image/png"};base64,${image}` } }]
      : instruction;
    return {
      model: cfg.model || "local",
      messages: [{ role: "user", content }],
      temperature: typeof temperature === "number" ? Math.min(temperature, 1) : 0,
      stream: false,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      // Fast mode: ask a reasoning model not to think at length. Servers that don't know these ignore them.
      ...(fast ? { reasoning_effort: "low", chat_template_kwargs: { enable_thinking: false } } : {}),
    };
  }

  const textOf = (data) => {
    const content = data?.choices?.[0]?.message?.content;
    if (Array.isArray(content)) return content.map((part) => part?.text || "").join("");
    return String(content || "");
  };

  const seconds = (ms) => Math.max(1, Math.round(ms / 1000));
  function emit(info) { watchers.forEach((fn) => { try { fn(info); } catch {} }); }

  // Reads a streamed answer, calling note(kind, text) for each piece. Resolves with the whole answer text.
  async function readStream(response, note, touch) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      touch();
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let piece;
        try { piece = JSON.parse(data); } catch { continue; }
        const delta = piece?.choices?.[0]?.delta || {};
        if (delta.reasoning_content || delta.reasoning) note("thinking", 0);
        if (delta.content) { text += delta.content; note("writing", text.length); }
        if (piece?.error) throw new Error(piece.error.message || "The local model stopped.");
      }
    }
    return text;
  }

  async function direct(url, cfg, body) {
    const controller = new AbortController();
    const started = Date.now();
    let last = started;
    let why = "";
    let phase = "waiting";
    let chars = 0;
    const touch = () => { last = Date.now(); };
    const note = (next, count) => { phase = next; if (count) chars = count; };
    let streamed = false;
    const ticker = setInterval(() => {
      const now = Date.now();
      emit({ phase, seconds: seconds(now - started), chars, fast: cfg.fast === true });
      if (!why && now - last > (streamed ? IDLE_MS : WHOLE_MS)) { why = "idle"; controller.abort(); }
    }, 1000);
    running = { started, cancel: () => { why = "cancel"; controller.abort(); } };
    emit({ phase, seconds: 1, chars: 0, fast: cfg.fast === true });
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}) },
        body: JSON.stringify({ ...body, stream: true }),
        signal: controller.signal,
      });
      touch();
      if (!response.ok) {
        const raw = await response.text();
        let data = null;
        try { data = JSON.parse(raw); } catch {}
        return { ok: false, status: response.status, error: data?.error?.message || data?.detail || raw.slice(0, 200) || `The server answered ${response.status}.` };
      }
      streamed = /event-stream/i.test(response.headers.get("content-type") || "") && Boolean(response.body);
      if (!streamed) {
        // A server that ignores stream:true answers in one piece.
        const data = JSON.parse((await response.text()) || "{}");
        return { ok: true, text: textOf(data) };
      }
      return { ok: true, text: await readStream(response, note, touch) };
    } catch (error) {
      const waited = seconds(Date.now() - started);
      if (why === "cancel") return { ok: false, status: 0, cancelled: true, error: "Cancelled." };
      if (error.name === "AbortError") {
        return { ok: false, status: 0, timedOut: true, error: `The local model went quiet: nothing came back for ${seconds(streamed ? IDLE_MS : WHOLE_MS)} s (${waited} s in all). A reasoning model can think for minutes. Turn on Fast mode in Local model to skip the long thinking.` };
      }
      if (streamed) return { ok: false, status: 0, error: error.message || "The connection to the local model dropped." };
      return { ok: false, status: 0, network: true, ...(await whyDirectFailed(url)) };
    } finally {
      clearInterval(ticker);
      running = null;
      emit({ phase: "done", seconds: seconds(Date.now() - started), chars, fast: cfg.fast === true });
    }
  }

  function viaPc(url, cfg, body) {
    return new Promise((resolve) => {
      if (!bridge?.ready()) { resolve({ ok: false, status: 0, pair: true, error: "Pair with Skybridge first. This address is http, so the iPad can only reach it through your PC." }); return; }
      const id = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const started = Date.now();
      const finish = (result) => {
        const wait = waits.get(id);
        if (!wait) return;
        waits.delete(id);
        clearTimeout(wait.timer);
        clearInterval(wait.ticker);
        running = null;
        emit({ phase: "done", seconds: seconds(Date.now() - started), chars: 0, fast: cfg.fast === true });
        resolve(result);
      };
      const ticker = setInterval(() => emit({ phase: "thinking", seconds: seconds(Date.now() - started), chars: 0, fast: cfg.fast === true }), 1000);
      const timer = setTimeout(() => finish({ ok: false, status: 0, timedOut: true, error: `No answer from the PC after ${seconds(Date.now() - started)} s. A reasoning model can think for minutes: turn on Fast mode in Local model, or use Solo with an https address, which waits as long as it keeps working.` }), WHOLE_MS + 10000);
      waits.set(id, { resolve: finish, timer, ticker });
      running = { started, cancel: () => finish({ ok: false, status: 0, cancelled: true, error: "Cancelled." }) };
      emit({ phase: "waiting", seconds: 1, chars: 0, fast: cfg.fast === true });
      bridge.send({ t: "llm", id, url, key: cfg.key, body: { ...body, stream: false } });
    });
  }

  function onRelay(message) {
    const wait = waits.get(message.id);
    if (!wait) return;
    wait.resolve({ ok: message.ok === true, status: message.status || 0, text: String(message.text || ""), error: String(message.error || "") });
  }

  async function chat(request) {
    const cfg = config();
    const url = endpoint(cfg.url);
    if (!url) throw new LocalError("No local model address is set.");
    const send = (body) => (route() === "relay" ? viaPc(url, cfg, body) : direct(url, cfg, body));
    const options = { json: true, fast: cfg.fast === true };
    let result = await send(bodyFor(cfg, request, options));
    // A server that doesn't know response_format or the Fast mode fields: ask again without them.
    for (let tries = 0; tries < 2 && !result.ok && result.status >= 400 && result.status < 500; tries++) {
      if (options.fast && /reasoning|chat_template|enable_thinking|thinking|extra|unknown|unrecognized|unexpected/i.test(result.error)) options.fast = false;
      else if (options.json && /response_format|json_object|json/i.test(result.error)) options.json = false;
      else break;
      result = await send(bodyFor(cfg, request, options));
    }
    // Blocked by the browser (no CORS) while a PC is paired: let the PC make the call.
    if (!result.ok && result.network && cfg.via === "auto" && !mixed(url) && bridge?.ready()) result = await viaPc(url, cfg, bodyFor(cfg, request, { json: true, fast: cfg.fast === true }));
    if (!result.ok) {
      const why = result.status === 401 || result.status === 403 ? "The local server didn't accept the key." : result.error;
      const failure = new LocalError(why || "The local model didn't answer.");
      failure.pair = result.pair === true;
      failure.why = result.cancelled ? "cancel" : result.kind || "";
      if (result.cancelled) failure.kind = "cancel";
      if (result.timedOut) failure.kind = "timeout";
      throw failure;
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
      return { ok: false, error: error.message, pair: error.pair === true, kind: error.why || "" };
    }
  }

  const cancel = () => { running?.cancel(); };
  const busy = () => Boolean(running);
  const onProgress = (fn) => { watchers.add(fn); return () => watchers.delete(fn); };
  const needsPair = () => route() === "relay" && !bridge?.ready();

  window.SkybridgeLocal = { config, save, endpoint, usable, route, chat, test, explainRoute, needsPair, cancel, busy, onProgress, attach: (given) => { bridge = given; }, onRelay, label, LocalError };
})();
