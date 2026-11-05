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
4. `check_url` on the localhost URL (headless — no desktop browser).
5. `screenshot_url` once the page responds — Studio shows **Preview screenshot**.
6. `stop_server` when done debugging (worker also cleans up at end of turn).

## Common fixes

| Symptom | Action |
| --- | --- |
| MODULE_NOT_FOUND | `npm_install` / add dependency |
| TS#### | `str_replace` at file:line |
| Failed to compile (Next) | fix import / client-server boundary |
| Hydration mismatch | remove browser-only values from SSR first paint |
| Missing env | copy from `.env.example`, never invent secrets |

## Playable games

A card, board, or browser game is done only when someone can start it and play a turn in `index.html`.

- The Start / Play button must deal cards, show them, and update the score. An empty click handler is not done.
- The worker clicks that button in a headless browser before accepting done. Stop once the click shows a card, score, or winner.
- Keep it static: `index.html`, `styles.css`, and `app.js`. Do not add `http-server` unless they asked for a server.
- The button id in the HTML must match the listener in `app.js`, and `app.js` must parse (no extra `}`).

## Done when

- Verify command (`npm test` / `npm run build`) exits 0 when those scripts exist, **or**
- You explain the blocker and the exact next command for the user.
