/**
 * Worker → Amplify fetches.
 *
 * Node's global fetch (undici) pools TLS sockets. Amplify/CloudFront often
 * closes those idle sockets, and the next claim then fails with:
 *   TypeError: fetch failed
 *   cause: read ECONNRESET
 * This client does not reuse sockets, and retries that reset before the
 * poll loop treats the API as down.
 */
import http from "node:http";
import https from "node:https";

const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EHOSTDOWN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CLOSED",
  "UND_ERR_REQUEST_ABORTED",
]);

export function networkErrorCode(err) {
  const seen = new Set();
  let current = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (current.errno === -104) return "ECONNRESET";
    if (typeof current.code === "string" && current.code) return current.code;
    current = current.cause;
  }
  return "";
}

export function isTransientFetchError(err) {
  const code = networkErrorCode(err);
  if (code && TRANSIENT_CODES.has(code)) return true;
  const name = err?.name || err?.cause?.name || "";
  if (name === "TimeoutError") return true;
  if (name === "AbortError" && /timeout/i.test(String(err?.message || ""))) {
    return true;
  }
  const msg = `${err?.message || ""} ${err?.cause?.message || ""}`;
  return /ECONNRESET|socket hang up|fetch failed|other side closed/i.test(msg);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attemptTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      Object.assign(new Error("timeout"), {
        name: "TimeoutError",
        code: "ETIMEDOUT",
      }),
    );
  }, ms);
  timer.unref?.();
  return {
    signal: controller.signal,
    cancel() {
      clearTimeout(timer);
    },
  };
}

function pinnedFamily() {
  const raw = process.env.WORKER_IP_FAMILY?.trim();
  if (raw === "4" || raw === "6") return Number(raw);
  return undefined;
}

function headerObject(headers) {
  const out = {};
  if (!headers) return out;
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}

function requestOnce({
  url,
  method,
  headers,
  body,
  signal,
  timeoutMs,
  family,
  httpAgent,
  httpsAgent,
}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const succeed = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let target;
    try {
      target = new URL(url);
    } catch (err) {
      fail(err);
      return;
    }

    const isHttps = target.protocol === "https:";
    const lib = isHttps ? https : http;
    const payload =
      body == null || body === ""
        ? null
        : Buffer.isBuffer(body)
          ? body
          : Buffer.from(body);
    const reqHeaders = headerObject(headers);
    if (
      payload &&
      reqHeaders["Content-Length"] == null &&
      reqHeaders["content-length"] == null
    ) {
      reqHeaders["Content-Length"] = String(payload.length);
    }
    if (
      reqHeaders["Accept-Encoding"] == null &&
      reqHeaders["accept-encoding"] == null
    ) {
      reqHeaders["Accept-Encoding"] = "identity";
    }

    const reqOptions = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method,
      headers: reqHeaders,
      agent: isHttps ? httpsAgent : httpAgent,
      autoSelectFamily: !family,
      autoSelectFamilyAttemptTimeout: 1000,
    };
    if (family) reqOptions.family = family;

    const req = lib.request(
      reqOptions,
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("error", fail);
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const responseHeaders = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (value == null) continue;
            responseHeaders[key] = Array.isArray(value) ? value.join(", ") : value;
          }
          succeed(
            new Response(buf, {
              status: res.statusCode || 0,
              headers: responseHeaders,
            }),
          );
        });
      },
    );

    const onAbort = () => {
      const reason =
        signal?.reason instanceof Error ? signal.reason : new Error("aborted");
      req.destroy(reason);
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    req.setTimeout(timeoutMs, () => {
      req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
    });
    req.on("error", fail);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * HTTP client that closes the socket after each response so a poll cannot
 * reuse a TLS session CloudFront already reset.
 */
export function createHttpFetch(options = {}) {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const family = options.family ?? pinnedFamily();
  const httpAgent = new http.Agent({ keepAlive: false });
  const httpsAgent = new https.Agent({ keepAlive: false });

  return async function httpFetch(url, init = {}) {
    const perCallTimeout = init.timeoutMs ?? timeoutMs;
    let currentUrl = url;
    let method = init.method || "GET";
    let body = init.body ?? null;
    const headers = init.headers;

    for (let hop = 0; hop < 5; hop++) {
      const res = await requestOnce({
        url: currentUrl,
        method,
        headers,
        body,
        signal: init.signal,
        timeoutMs: perCallTimeout,
        family,
        httpAgent,
        httpsAgent,
      });
      if (![301, 302, 303, 307, 308].includes(res.status)) return res;
      const location = res.headers.get("location");
      if (!location) return res;
      await res.arrayBuffer().catch(() => {});
      currentUrl = new URL(location, currentUrl).href;
      if (res.status === 301 || res.status === 302 || res.status === 303) {
        method = "GET";
        body = null;
      }
    }
    throw Object.assign(new Error(`too many redirects for ${url}`), {
      code: "ERR_TOO_MANY_REDIRECTS",
    });
  };
}

const defaultFetch = createHttpFetch();

export async function apiFetch(url, init = {}, opts = {}) {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const doFetch = opts.fetchImpl ?? defaultFetch;
  const sleep = opts.sleepImpl ?? defaultSleep;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const timed = init.signal ? null : attemptTimeout(timeoutMs);
    const signal = init.signal ?? timed.signal;
    try {
      return await doFetch(url, { ...init, signal, timeoutMs });
    } catch (err) {
      lastErr = err;
      if (!isTransientFetchError(err) || attempt === attempts - 1) throw err;
      await sleep(opts.retryDelayMs ?? 200 * (attempt + 1));
    } finally {
      timed?.cancel();
    }
  }
  throw lastErr;
}
