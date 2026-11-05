import { isSafeWorkspacePath, normalizePath } from "@/lib/extract-files";

const MAX_PREVIEW_CHARS = 1_500_000;
const EXTERNAL_HREF = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Map a link or script URL onto a workspace-relative path.
 * Remote URLs and paths that escape the workspace return null.
 */
export function resolveWorkspaceHref(
  fromFile: string,
  href: string,
): string | null {
  const raw = String(href || "").trim();
  if (!raw || raw.startsWith("#") || EXTERNAL_HREF.test(raw)) return null;
  const pathOnly = raw.split("#")[0]?.split("?")[0] ?? "";
  if (!pathOnly) return null;

  const fromDir = fromFile.includes("/")
    ? fromFile.slice(0, fromFile.lastIndexOf("/"))
    : "";
  const base = pathOnly.startsWith("/")
    ? pathOnly.replace(/^\/+/, "")
    : [fromDir, pathOnly].filter(Boolean).join("/");

  const out: string[] = [];
  for (const part of base.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(part);
  }

  const rel = normalizePath(out.join("/"));
  return isSafeWorkspacePath(rel) ? rel : null;
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`,
    "i",
  );
  const match = tag.match(re);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? "";
}

function escapeStyle(css: string) {
  return css.replace(/<\/style/gi, "<\\/style");
}

function escapeScript(js: string) {
  return js.replace(/<\/script/gi, "<\\/script");
}

type Swap = { start: number; end: number; text: string };

/**
 * Inline same-project stylesheets and classic scripts so a sandboxed
 * srcDoc preview can run the page without a second download.
 */
export async function bundleHtmlPreview(
  htmlPath: string,
  readFile: (rel: string) => Promise<string | null>,
): Promise<string | null> {
  const relHtml = normalizePath(htmlPath);
  if (!isSafeWorkspacePath(relHtml) || !/\.html?$/i.test(relHtml)) return null;
  const html = await readFile(relHtml);
  if (html == null) return null;

  const swaps: Swap[] = [];
  const linkRe = /<link\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html))) {
    const tag = match[0];
    const relAttr = attr(tag, "rel") || "";
    const href = attr(tag, "href");
    if (!href) continue;
    const looksLikeCss = /\.css$/i.test(href.split(/[?#]/)[0] || "");
    if (!/stylesheet/i.test(relAttr) && !(relAttr === "" && looksLikeCss)) {
      continue;
    }
    const asset = resolveWorkspaceHref(relHtml, href);
    if (!asset) continue;
    const css = await readFile(asset);
    if (css == null) continue;
    swaps.push({
      start: match.index,
      end: match.index + tag.length,
      text: `<style data-workspace-src="${asset}">\n${escapeStyle(css)}\n</style>`,
    });
  }

  const scriptRe =
    /<script\b([^>]*?)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi;
  while ((match = scriptRe.exec(html))) {
    const asset = resolveWorkspaceHref(relHtml, match[3] || "");
    if (!asset) continue;
    const js = await readFile(asset);
    if (js == null) continue;
    const attrs = `${match[1] || ""} ${match[4] || ""}`.replace(/\s+/g, " ").trim();
    swaps.push({
      start: match.index,
      end: match.index + match[0].length,
      text: `<script${attrs ? ` ${attrs}` : ""}>\n${escapeScript(js)}\n</script>`,
    });
  }

  swaps.sort((a, b) => b.start - a.start);
  let out = html;
  for (const swap of swaps) {
    out = out.slice(0, swap.start) + swap.text + out.slice(swap.end);
  }
  if (out.length > MAX_PREVIEW_CHARS) return html;
  return out;
}
