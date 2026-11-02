/**
 * Drop heavy Ollama models after a job so the next person's turn
 * does not inherit a 32B resident set on a 16GB box.
 * 7B / 8B stay loaded. Set OLLAMA_UNLOAD_HEAVY=0 to keep 32B warm.
 */

/**
 * @param {string} model
 */
export function isHeavyOllamaModel(model) {
  return /(^|[^a-z0-9])(14b|32b|70b|72b)([^a-z0-9]|$)/i.test(String(model || ""));
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function unloadHeavyAfterJob(env = process.env) {
  const raw = env.OLLAMA_UNLOAD_HEAVY;
  if (raw == null || String(raw).trim() === "") return true;
  return !/^(0|false|off|no)$/i.test(String(raw).trim());
}

/**
 * @param {string} ollamaUrl
 * @param {{ fetchImpl?: typeof fetch, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<string[]>} model names that were unloaded
 */
export async function releaseLoadedHeavyModels(ollamaUrl, opts = {}) {
  if (!unloadHeavyAfterJob(opts.env)) return [];
  const fetchImpl = opts.fetchImpl || fetch;
  const base = String(ollamaUrl || "").replace(/\/$/, "");
  const ps = await fetchImpl(`${base}/api/ps`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!ps.ok) {
    const text = typeof ps.text === "function" ? await ps.text() : "";
    throw new Error(`Ollama ps ${ps.status}: ${String(text).slice(0, 200)}`);
  }
  const body = await ps.json();
  const loaded = Array.isArray(body?.models) ? body.models : [];
  /** @type {string[]} */
  const heavy = [];
  for (const row of loaded) {
    const name = String(row?.name || row?.model || "").trim();
    if (name && isHeavyOllamaModel(name)) heavy.push(name);
  }
  for (const model of heavy) {
    const res = await fetchImpl(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, keep_alive: 0, stream: false }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = typeof res.text === "function" ? await res.text() : "";
      throw new Error(
        `Ollama unload ${model} ${res.status}: ${String(text).slice(0, 200)}`,
      );
    }
  }
  return heavy;
}
