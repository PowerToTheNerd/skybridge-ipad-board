/*
 * A local model: any OpenAI-compatible server (Unsloth Studio, llama.cpp, Ollama, LM Studio...) at an
 * address and key you type. The key stays on this iPad. ai.js tries it first (or only), and falls back to Gemini.
 *
 * Where the request goes depends on the page:
 *  - an https address (a Tailscale or Cloudflare tunnel, Tailscale HTTPS...) is called straight from the iPad;
 *  - an http address works straight from the iPad only when this page is itself http (opened from the PC);
 *  - this page, served from GitHub, is https, and a browser will not let https call http (mixed content). So
 *    the request goes through Skybridge on the PC, which makes the call (and only to a local address). The PC
 *    has to be on, and the address is the one the PC would use (http://127.0.0.1:1234/v1 for LM Studio on the PC).
 *
 * window.SkybridgeLocal = { config(), save(patch), usable({image,pdf}), route(), chat({prompt,image,schema,temperature}), cancel(), busy(), onProgress(fn), test(), models(), explainRoute(), attach(bridge), onRelay(message), label() }
 */
(() => {
  const KEY = "skybridge.local";
  const IDLE_MS = 120000; // streaming: give up after this long with no token at all (thinking tokens count)
  const WHOLE_MS = 300000; // an answer that isn't streamed (or goes through the PC): the longest to wait for it
  const DEFAULTS = { url: "", key: "", model: "", vision: false, visionBy: {}, mode: "first", via: "auto", fast: false }; // via: auto | pc (through Skybridge) | solo (straight from this iPad)
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
  // What each model turned out to be able to do (read pictures or not) is remembered by name, so changing
  // the model name changes "Can it read pictures" to match without another test.
  const visionOf = (cfg, model) => (cfg.visionBy && typeof cfg.visionBy === "object" ? cfg.visionBy[model || ""] : undefined);
  function save(patch) {
    const was = config();
    const next = { ...was, ...patch };
    if ("model" in patch && patch.model !== was.model && !("vision" in patch)) {
      const known = visionOf(next, patch.model);
      if (typeof known === "boolean") next.vision = known;
    }
    if ("vision" in patch && !("visionBy" in patch)) next.visionBy = { ...(was.visionBy || {}), [next.model || ""]: next.vision === true };
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

  const TAILSCALE = "On the PC run: tailscale serve --bg --https=443 http://127.0.0.1:1234 (1234 is LM Studio's port; use your server's), then type the https://…ts.net address it prints. The iPad needs the Tailscale app on.";

  // One short line for under the address; { long: true } is the full explanation (under "More options").
  function explainRoute({ long = false } = {}) {
    const cfg = config();
    const url = endpoint(cfg.url);
    if (!url) return long ? "Type your server's address, for example http://127.0.0.1:1234/v1 (LM Studio's address)." : "";
    if (route() === "relay") {
      return long
        ? "Requests go through Skybridge on your PC, so pair with it once (Sync with Skybridge) and keep Skybridge running there; its page doesn't need to be open. Type the address as the PC sees it: http://127.0.0.1:1234/v1 if LM Studio runs on that PC, or the other computer's Wi-Fi address like http://192.168.1.20:1234/v1 (LM Studio: turn on Serve on Local Network). The PC only calls home-network addresses. No Tailscale needed at home."
        : "Goes through Skybridge on your PC (keep it running there).";
    }
    if (mixed(url)) {
      return long
        ? "Solo: this iPad calls the address itself. A browser blocks an https page (this one) from calling an http address, so this only works for an https address. " + TAILSCALE
        : "Solo needs an https address. Switch to Through Skybridge in More options for an http one.";
    }
    return /^https:/i.test(url)
      ? (long ? "This https address is called straight from the iPad, so it works without the PC. The server must allow requests from this page (CORS)." : "Called straight from this iPad.")
      : (long ? "This page is http, so the iPad calls the address directly. The server must allow requests from this page (CORS)." : "Called straight from this iPad (the server must allow it: CORS).");
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

  // Gemini-style schemas write types in capitals; OpenAI-style servers want them lower-case.
  const plainSchema = (node) => Array.isArray(node) ? node.map(plainSchema)
    : node && typeof node === "object" ? Object.fromEntries(Object.entries(node).map(([key, value]) => [key, key === "type" && typeof value === "string" ? value.toLowerCase() : plainSchema(value)]))
    : node;

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
      ...(json === "schema" && schema ? { response_format: { type: "json_schema", json_schema: { name: "answer", schema: plainSchema(schema) } } } : json ? { response_format: { type: "json_object" } } : {}),
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
      if (!bridge?.ready()) { resolve({ ok: false, status: 0, pair: true, error: "Pair with Skybridge first (Sync with Skybridge below) and keep it running on your PC. This address is http, so the iPad can only reach it through the PC." }); return; }
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

  // The model names the server offers (GET .../v1/models), through the PC or straight from the iPad.
  const modelsUrl = (url) => url.replace(/\/chat\/completions$/, "/models");
  async function models() {
    const cfg = config();
    const url = endpoint(cfg.url);
    if (!url) return { ok: false, models: [], error: "Type the server's address first." };
    if (route() === "relay") {
      const answer = await new Promise((resolve) => {
        if (!bridge?.ready()) { resolve({ ok: false, pair: true, error: "Pair with Skybridge first (Sync with Skybridge below) and keep it running on your PC." }); return; }
        const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const timer = setTimeout(() => { waits.delete(id); resolve({ ok: false, error: "No answer from the PC." }); }, 40000);
        waits.set(id, { resolve: (result) => { clearTimeout(timer); waits.delete(id); resolve(result); }, timer, ticker: 0 });
        bridge.send({ t: "llm-models", id, url, key: cfg.key });
      });
      return { ok: answer.ok === true, models: answer.models || [], error: answer.ok ? "" : (answer.status === 401 || answer.status === 403 ? "The local server didn't accept the key." : answer.error || "Couldn't list the models.") };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(modelsUrl(url), { headers: cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}, signal: controller.signal });
      if (!response.ok) return { ok: false, models: [], error: response.status === 401 || response.status === 403 ? "The local server didn't accept the key." : `The server answered ${response.status}.` };
      const data = await response.json();
      const listed = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
      const names = [];
      for (const item of listed) {
        const name = typeof item === "string" ? item : item?.id || item?.name || item?.model;
        if (typeof name === "string" && name && !names.includes(name)) names.push(name);
      }
      return { ok: true, models: names.slice(0, 60), error: "" };
    } catch {
      return { ok: false, models: [], ...(await whyDirectFailed(url)) };
    } finally {
      clearTimeout(timer);
    }
  }

  function onRelay(message) {
    const wait = waits.get(message.id);
    if (!wait) return;
    wait.resolve({ ok: message.ok === true, status: message.status || 0, text: String(message.text || ""), models: Array.isArray(message.models) ? message.models.filter((name) => typeof name === "string") : [], error: String(message.error || "") });
  }

  async function chat(request) {
    let cfg = config();
    const url = endpoint(cfg.url);
    if (!url) throw new LocalError("No local model address is set.");
    const send = (body) => (route() === "relay" ? viaPc(url, cfg, body) : direct(url, cfg, body));
    const options = { json: true, fast: cfg.fast === true };
    let result = await send(bodyFor(cfg, request, options));
    // A server that doesn't know response_format or the Fast mode fields: ask again without them.
    // One that wants a model name (LM Studio can) is asked what it has; if it has just one, that is the one.
    let askedModels = false;
    for (let tries = 0; tries < 3 && !result.ok && result.status >= 400 && result.status < 500; tries++) {
      if (options.fast && /reasoning|chat_template|enable_thinking|thinking|extra|unknown|unrecognized|unexpected/i.test(result.error)) options.fast = false;
      // LM Studio takes only response_format json_schema: try that (when there is a schema) before giving up on JSON mode.
      else if (options.json === true && request.schema && /response_format|json_object|json_schema/i.test(result.error)) options.json = "schema";
      else if (options.json && /response_format|json_object|json/i.test(result.error)) options.json = false;
      else if (!cfg.model && !askedModels && result.status !== 401 && result.status !== 403 && /model/i.test(result.error)) {
        askedModels = true;
        const found = await models();
        if (found.ok && found.models.length === 1) cfg = save({ model: found.models[0] });
        else if (found.ok && found.models.length) { result = { ...result, error: `The server needs a model name. It has: ${found.models.slice(0, 6).join(", ")}. Tap one under Model name.` }; break; }
        else break;
      } else break;
      result = await send(bodyFor(cfg, request, options));
    }
    // Blocked by the browser (no CORS) while a PC is paired: let the PC make the call.
    if (!result.ok && result.network && cfg.via === "auto" && !mixed(url) && bridge?.ready()) result = await viaPc(url, cfg, bodyFor(cfg, request, { json: true, fast: cfg.fast === true }));
    // A model that refuses the picture: remember that, so it isn't asked again, and let the next engine take over.
    if (!result.ok && request.image && result.status >= 400 && result.status < 500 && result.status !== 401 && result.status !== 403 && result.status !== 429
      && /image|vision|multimodal|modalit|content part|image_url/i.test(result.error || "")) {
      save({ vision: false });
      const refused = new LocalError("This model can't read pictures.", "novision");
      refused.status = result.status;
      refused.why = "novision";
      throw refused;
    }
    if (!result.ok) {
      const why = result.status === 401 || result.status === 403 ? "The local server didn't accept the key." : result.error;
      const failure = new LocalError(why || "The local model didn't answer.");
      failure.pair = result.pair === true;
      failure.status = result.status || 0;
      failure.why = result.cancelled ? "cancel" : result.kind || "";
      if (result.cancelled) failure.kind = "cancel";
      if (result.timedOut) failure.kind = "timeout";
      throw failure;
    }
    if (!result.text.trim()) throw new LocalError("The local model gave an empty answer.");
    return result.text;
  }

  // A small picture with a random number on it, for finding out whether the model can see.
  function testPicture() {
    try {
      const digits = String(100 + Math.floor(Math.random() * 900));
      const canvas = document.createElement("canvas");
      canvas.width = 240;
      canvas.height = 96;
      const context = canvas.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, 240, 96);
      context.fillStyle = "#111";
      context.font = "bold 64px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(digits, 120, 50);
      return { digits, image: canvas.toDataURL("image/png").split(",")[1] };
    } catch {
      return null;
    }
  }

  // Words first, then a picture. Whether it reads pictures is remembered (Check my work and page names need that).
  async function test() {
    const started = Date.now();
    let text;
    // Ask the server what it has first, so the list is there to pick from whatever happens next.
    const listed = await models().catch(() => ({ ok: false, models: [] }));
    const names = listed.ok ? listed.models : [];
    if (listed.ok && listed.models.length === 1 && !config().model) save({ model: listed.models[0] });
    try {
      text = (await chat({ prompt: "Reply with the single word: ready", temperature: 0 })).trim().slice(0, 80);
    } catch (error) {
      return { ok: false, error: error.message, pair: error.pair === true, kind: error.why || "", models: names };
    }
    const out = { ok: true, text, ms: Date.now() - started, sees: null, model: config().model, models: names };
    const picture = testPicture();
    if (picture) {
      try {
        const said = await chat({ prompt: "What number is written in this picture? Answer with ONLY the number.", image: picture.image, mime: "image/png", temperature: 0 });
        out.sees = said.replace(/\D/g, "").includes(picture.digits);
      } catch (error) {
        // Refused (a words-only model says so) means no; anything else (slow, dropped) means unknown.
        out.sees = error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 403 ? false : null;
      }
      if (out.sees !== null) save({ vision: out.sees });
    }
    return out;
  }

  const cancel = () => { running?.cancel(); };
  const busy = () => Boolean(running);
  const onProgress = (fn) => { watchers.add(fn); return () => watchers.delete(fn); };
  const needsPair = () => route() === "relay" && !bridge?.ready();

  window.SkybridgeLocal = { config, save, endpoint, usable, route, chat, models, test, explainRoute, needsPair, cancel, busy, onProgress, attach: (given) => { bridge = given; }, onRelay, label, LocalError };
})();
