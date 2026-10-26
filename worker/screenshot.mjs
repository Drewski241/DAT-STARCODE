/**
 * Optional Playwright screenshots (headless). Falls back with install hints.
 * Saves UTF-8-safe preview JSON for Studio sync.
 */
import { promises as fs } from "fs";
import path from "path";
import { checkHttpUrl, extractListenUrls } from "./http-check.mjs";

export const PREVIEW_JSON_REL = ".datstarcoder/preview.json";

/**
 * @returns {Promise<false | typeof import('playwright')>}
 */
export async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    return false;
  }
}

/**
 * @param {string} root
 * @param {{
 *   url?: string,
 *   name?: string,
 *   fullPage?: boolean,
 *   logText?: string,
 * }} opts
 */
export async function captureScreenshot(root, opts = {}) {
  let url = String(opts.url || opts.path || "").trim();
  if (!url && opts.logText) {
    url = extractListenUrls(opts.logText)[0] || "";
  }
  // Workspace-relative HTML → file:// so Studio can preview without a server.
  if (url && !/^https?:\/\//i.test(url) && !/^file:/i.test(url)) {
    const rel = url.replace(/^\.\//, "");
    if (/\.(html?|htm)$/i.test(rel) || rel === "index.html") {
      const full = path.resolve(root, rel);
      const rootResolved = path.resolve(root);
      if (
        full === rootResolved ||
        full.startsWith(rootResolved + path.sep)
      ) {
        try {
          await fs.access(full);
          url = `file://${full}`;
        } catch {
          return {
            ok: false,
            message: `screenshot path not found in workspace: ${rel}`,
          };
        }
      }
    }
  }
  if (!url) {
    return {
      ok: false,
      message:
        "screenshot_url needs url (http://127.0.0.1:PORT/ or index.html) or a running start_server with a listen line in logs",
    };
  }

  /** @type {{ ok: boolean, status?: number, url?: string, title?: string, message?: string }} */
  let probe = { ok: true, url, message: "file" };
  if (/^https?:\/\//i.test(url)) {
    // Quick reachability first (also SSRF-guards to localhost).
    probe = await checkHttpUrl(url);
    if (!probe.ok) {
      return {
        ok: false,
        url,
        probe,
        message: `page not reachable: ${probe.message}`,
      };
    }
  } else if (!/^file:/i.test(url)) {
    return {
      ok: false,
      url,
      message: "screenshot_url only allows http(s) localhost or workspace .html paths",
    };
  }

  const pw = await loadPlaywright();
  if (!pw) {
    return {
      ok: false,
      url,
      probe,
      playwright: false,
      message:
        "Playwright not installed on worker. Run: npm i -D playwright && npx playwright install chromium",
      hint: "check_url still works without Playwright; install it for screenshots in Studio.",
    };
  }

  const name = String(opts.name || "preview")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 40);
  const shotDir = path.join(root, ".datstarcoder", "screenshots");
  await fs.mkdir(shotDir, { recursive: true });
  const pngPath = path.join(shotDir, `${name}.png`);

  let browser;
  try {
    browser = await pw.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 });
    const title = await page.title();
    await page.screenshot({
      path: pngPath,
      fullPage: Boolean(opts.fullPage),
      type: "png",
    });
    const buf = await fs.readFile(pngPath);
    const pngBase64 = buf.toString("base64");
    // Keep a UTF-8 sidecar so Studio sync (text-only) still gets the image.
    const b64Rel = `.datstarcoder/screenshots/${name}.png.b64`;
    await fs.writeFile(path.join(root, b64Rel), pngBase64, "utf8");

    const preview = {
      url,
      title: title || probe.title || null,
      status: probe.status,
      name,
      pngRel: `.datstarcoder/screenshots/${name}.png`,
      b64Rel,
      pngBase64,
      bytes: buf.length,
      capturedAt: new Date().toISOString(),
      playwright: true,
    };
    await fs.writeFile(
      path.join(root, PREVIEW_JSON_REL),
      `${JSON.stringify({ ...preview, pngBase64: undefined, hasImage: true, b64Rel }, null, 2)}\n`,
      "utf8",
    );
    // Also write a small index that embeds truncated meta + points at b64
    await fs.writeFile(
      path.join(root, ".datstarcoder", "preview.meta.json"),
      `${JSON.stringify(
        {
          url: preview.url,
          title: preview.title,
          status: preview.status,
          name: preview.name,
          b64Rel: preview.b64Rel,
          capturedAt: preview.capturedAt,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    return {
      ok: true,
      url,
      title: preview.title,
      status: probe.status,
      b64Rel,
      previewPath: PREVIEW_JSON_REL,
      bytes: buf.length,
      message: `screenshot ok · ${title || url} (${buf.length} bytes)`,
    };
  } catch (err) {
    return {
      ok: false,
      url,
      probe,
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Collect screenshot base64 sidecars into pushable UTF-8 files.
 * Binary .png may fail utf8 read — sidecars + preview.meta are enough for Studio.
 * @param {string} root
 * @param {{ path: string, content: string }[]} files
 */
export async function ensurePreviewFilesListed(root, files) {
  const out = [...files];
  const have = new Set(out.map((f) => f.path));
  for (const rel of [
    PREVIEW_JSON_REL,
    ".datstarcoder/preview.meta.json",
  ]) {
    if (have.has(rel)) continue;
    try {
      const content = await fs.readFile(path.join(root, rel), "utf8");
      out.push({ path: rel, content });
      have.add(rel);
    } catch {
      /* missing */
    }
  }
  // Include .b64 sidecars (may be large but text). If only a binary .png exists
  // (or a UTF-8-mangled copy), rebuild the sidecar from raw bytes when valid.
  try {
    const shotDir = path.join(root, ".datstarcoder", "screenshots");
    const names = await fs.readdir(shotDir);
    for (const n of names) {
      if (n.endsWith(".png.b64")) {
        const rel = `.datstarcoder/screenshots/${n}`;
        if (have.has(rel)) continue;
        const content = await fs.readFile(path.join(root, rel), "utf8");
        if (Buffer.byteLength(content, "utf8") > 900_000) continue;
        out.push({ path: rel, content });
        have.add(rel);
        continue;
      }
      if (!n.endsWith(".png")) continue;
      const b64Name = `${n}.b64`;
      const b64Rel = `.datstarcoder/screenshots/${b64Name}`;
      if (have.has(b64Rel)) continue;
      try {
        await fs.access(path.join(shotDir, b64Name));
        continue; // listed on next loop / already present on disk for readdir
      } catch {
        /* rebuild from png bytes */
      }
      try {
        const buf = await fs.readFile(path.join(shotDir, n));
        if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) continue;
        const content = buf.toString("base64");
        if (Buffer.byteLength(content, "utf8") > 900_000) continue;
        await fs.writeFile(path.join(root, b64Rel), content, "utf8");
        out.push({ path: b64Rel, content });
        have.add(b64Rel);
      } catch {
        /* unreadable */
      }
    }
  } catch {
    /* no shots */
  }
  // Never push raw .png — utf8 collect corrupts them (U+FFFD).
  return out.filter((f) => !/\.png$/i.test(f.path) || /\.png\.b64$/i.test(f.path));
}
