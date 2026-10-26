# Web app / website playbook

User is building or debugging an app/site (HTML, React, Next.js, Node API, CSS).

## First moves

1. `list_files` — find `package.json`, `src/`, `app/`, `pages/`, `index.html`.
2. Read `package.json` scripts and `.env.example` if present.
3. If they pasted an error, follow **error-fix.md** (classify → fix → re-run).

## Prefer

- Runnable output: `index.html` or `npm run build` / `start_server` with `npm run dev`.
- Surgical edits with `str_replace` for existing files; `write_file` only for new files or full rewrites.
- `npm_install` when deps are missing (longer timeout than plain `run`).
- Document how to run in the final message.
- **Never** `xdg-open` / desktop browser. Use `start_server`, then tell the user the URL or Studio Preview.

## Servers

1. `npm_install` if `node_modules` missing.
2. `start_server` with `npm run dev` or `node server.js`.
3. `server_logs` to confirm listen / catch compile errors.
4. `stop_server` when done debugging (worker also cleans up at end of turn).

## Common fixes

| Symptom | Action |
| --- | --- |
| MODULE_NOT_FOUND | `npm_install` / add dependency |
| TS#### | `str_replace` at file:line |
| Failed to compile (Next) | fix import / client-server boundary |
| Hydration mismatch | remove browser-only values from SSR first paint |
| Missing env | copy from `.env.example`, never invent secrets |

## Done when

- Verify command (`npm test` / `npm run build`) exits 0 when those scripts exist, **or**
- You explain the blocker and the exact next command for the user.
