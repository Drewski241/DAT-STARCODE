export type ExtractedFile = {
  path: string;
  content: string;
};

const MAX_FILES = 40;
const MAX_FILE_BYTES = 400_000;

/**
 * Pull file paths out of agent markdown.
 *
 * Supported shapes:
 *   ```src/foo.ts
 *   ```typescript:src/foo.ts
 *   ```ts path=src/foo.ts
 *   ### File: src/foo.ts   (followed by a fenced block)
 *   **File:** `src/foo.ts` (followed by a fenced block)
 */
export function extractFilesFromMarkdown(markdown: string): ExtractedFile[] {
  const files: ExtractedFile[] = [];
  const seen = new Set<string>();

  const fenceRe =
    /```([^\n`]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(markdown)) !== null) {
    const header = match[1].trim();
    const content = match[2].replace(/\n$/, "");
    const path = pathFromFenceHeader(header, markdown, match.index);
    if (!path) continue;
    pushFile(files, seen, path, content);
    if (files.length >= MAX_FILES) break;
  }

  return files;
}

function pathFromFenceHeader(
  header: string,
  full: string,
  fenceIndex: number,
): string | null {
  if (!header) {
    return pathFromPrecedingLabel(full, fenceIndex);
  }

  // ```typescript:src/foo.ts  or  ```ts src/foo.ts  or  ```src/foo.ts
  const colon = header.match(
    /^(?:[\w.+-]+\s*:)?\s*([A-Za-z0-9_./@+-]+\.[A-Za-z0-9]+)\s*$/,
  );
  if (colon?.[1] && looksLikePath(colon[1])) return normalizePath(colon[1]);

  const pathEq = header.match(/(?:path|file)\s*=\s*["']?([^"'\s]+)["']?/i);
  if (pathEq?.[1] && looksLikePath(pathEq[1])) return normalizePath(pathEq[1]);

  const tokens = header.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (looksLikePath(token)) return normalizePath(token);
  }

  return pathFromPrecedingLabel(full, fenceIndex);
}

function pathFromPrecedingLabel(full: string, fenceIndex: number): string | null {
  const before = full.slice(Math.max(0, fenceIndex - 240), fenceIndex);
  const label =
    before.match(
      /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?(?:File|Path|Filename)(?:\*\*)?\s*[:\-]\s*`?([A-Za-z0-9_./@+-]+\.[A-Za-z0-9]+)`?\s*$/i,
    ) ??
    before.match(
      /(?:^|\n)\s*`([A-Za-z0-9_./@+-]+\.[A-Za-z0-9]+)`\s*$/,
    );
  if (label?.[1] && looksLikePath(label[1])) return normalizePath(label[1]);
  return null;
}

function looksLikePath(value: string): boolean {
  if (!value.includes(".") && !value.includes("/")) return false;
  if (value.startsWith("http://") || value.startsWith("https://")) return false;
  if (/^(bash|sh|shell|json|yaml|yml|text|txt|md|markdown|ts|tsx|js|jsx|py|rust|go|css|html|sql|diff|plaintext)$/i.test(value)) {
    return false;
  }
  return /^[A-Za-z0-9_./@+-]+$/.test(value);
}

export function normalizePath(raw: string): string {
  return raw
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

export function isSafeWorkspacePath(relPath: string): boolean {
  if (!relPath || relPath.length > 240) return false;
  if (relPath.includes("\0")) return false;
  const parts = relPath.split("/");
  if (parts.some((p) => !p || p === "." || p === "..")) return false;
  return /^[A-Za-z0-9_./@+-]+$/.test(relPath);
}

function pushFile(
  files: ExtractedFile[],
  seen: Set<string>,
  path: string,
  content: string,
) {
  if (!isSafeWorkspacePath(path)) return;
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) return;
  if (seen.has(path)) {
    const idx = files.findIndex((f) => f.path === path);
    if (idx >= 0) files[idx] = { path, content };
    return;
  }
  seen.add(path);
  files.push({ path, content });
}
