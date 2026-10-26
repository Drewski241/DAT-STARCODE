/**
 * Headless HTTP check against a local/dev URL (no desktop browser).
 */
import http from "http";
import https from "https";
import { URL } from "url";

/**
 * Pull likely listen URLs from server log text.
 * @param {string} text
 * @returns {string[]}
 */
export function extractListenUrls(text) {
  const s = String(text || "");
  /** @type {string[]} */
  const found = [];
  const re =
    /https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)[:\d][^\s"'<>]*/gi;
  let m;
  while ((m = re.exec(s))) {
    let u = m[0].replace(/[),\].]+$/, "");
    u = u.replace("0.0.0.0", "127.0.0.1");
    if (!found.includes(u)) found.push(u);
  }
  // "listening 3847" / READY 3000
  const portOnly = s.match(/\b(?:listening|ready|port)\D{0,12}(\d{2,5})\b/i);
  if (portOnly && found.length === 0) {
    found.push(`http://127.0.0.1:${portOnly[1]}/`);
  }
  return found.slice(0, 5);
}

/**
 * @param {string} urlStr
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, status?: number, url: string, title?: string, snippet?: string, message: string }>}
 */
export async function checkHttpUrl(urlStr, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  let url;
  try {
    url = new URL(String(urlStr || ""));
  } catch {
    return { ok: false, url: String(urlStr || ""), message: "invalid URL" };
  }
  if (!/^https?:$/i.test(url.protocol)) {
    return { ok: false, url: url.href, message: "only http(s) allowed" };
  }
  // SSRF guard: local/dev only for worker headless checks
  const host = url.hostname.toLowerCase();
  if (
    host !== "127.0.0.1" &&
    host !== "localhost" &&
    host !== "::1"
  ) {
    return {
      ok: false,
      url: url.href,
      message: "check_url is limited to localhost / 127.0.0.1 on the worker",
    };
  }

  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve) => {
    const req = lib.get(
      url,
      { timeout: timeoutMs, headers: { Accept: "text/html,*/*", "User-Agent": "DAT-STARCODER-check/0.1" } },
      (res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        res.on("data", (c) => {
          if (Buffer.concat(chunks).length < 32_000) chunks.push(c);
        });
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const title =
            body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ||
            undefined;
          const status = res.statusCode || 0;
          const ok = status >= 200 && status < 400;
          resolve({
            ok,
            status,
            url: url.href,
            title,
            snippet: body.slice(0, 400).replace(/\s+/g, " ").trim(),
            message: ok
              ? `HTTP ${status}${title ? ` · ${title}` : ""}`
              : `HTTP ${status} from ${url.href}`,
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({
        ok: false,
        url: url.href,
        message: `timed out after ${timeoutMs}ms`,
      });
    });
    req.on("error", (err) => {
      resolve({
        ok: false,
        url: url.href,
        message: err instanceof Error ? err.message : String(err),
      });
    });
  });
}
