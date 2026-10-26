# Error-fix playbook

The user pasted a failing build/runtime log or asked to fix an error.

## Loop (mandatory)

1. **Classify** the first real error (ignore warnings noise).
2. **Open** the cited `file:line` with `read_file`.
3. **Minimal fix** via `str_replace` (preferred) or `write_file` — do not rewrite the whole app.
4. **Re-run** the same failing command with `run` / `npm_install` (or the suggested command from ERROR_CLASS).
5. If still failing, repeat once; then `{"done":true}` with what you tried and the remaining error snippet.

## Rules

- Prefer the first TypeScript / MODULE_NOT_FOUND / Failed to compile line.
- Do not invent files that are not in `list_files`.
- Do not claim fixed unless the re-run exits 0 or clearly progresses.
- Keep answers short: cause → change → how to verify.
- Gtk / xdg-open / desktop browser noise is **not** a project failure — done with Preview instructions.
