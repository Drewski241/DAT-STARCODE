/**
 * Exact-string surgical edits (avoids full-file rewrite thrash).
 */

/**
 * @param {string} body
 * @param {{ oldText: string, newText: string, replaceAll?: boolean }} edit
 * @returns {{ ok: boolean, content?: string, message: string, replacements?: number }}
 */
export function applyStrReplace(body, edit) {
  const src = String(body ?? "");
  const oldText = String(edit?.oldText ?? "");
  const newText = String(edit?.newText ?? "");
  const replaceAll = Boolean(edit?.replaceAll);

  if (!oldText) {
    return { ok: false, message: "oldText is required" };
  }
  if (oldText === newText) {
    return { ok: false, message: "oldText and newText are identical" };
  }

  const count = src.split(oldText).length - 1;
  if (count === 0) {
    return {
      ok: false,
      message:
        "oldText not found in file — read_file again and copy an exact contiguous snippet",
    };
  }
  if (!replaceAll && count > 1) {
    return {
      ok: false,
      message: `oldText matched ${count} times — pass a larger unique snippet or replaceAll:true`,
    };
  }

  const content = replaceAll
    ? src.split(oldText).join(newText)
    : src.replace(oldText, newText);

  return {
    ok: true,
    content,
    replacements: replaceAll ? count : 1,
    message: replaceAll
      ? `replaced ${count} occurrence(s)`
      : "replaced 1 occurrence",
  };
}
