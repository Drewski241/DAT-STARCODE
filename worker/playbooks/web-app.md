# Web app / website playbook

User is building or debugging an app/site (HTML, React, Next.js, Node API, CSS).

## First moves

1. `list_files` — find `package.json`, `src/`, `app/`, `pages/`, `index.html`.
2. Read `package.json` scripts and `.env.example` if present.
3. If they pasted an error, follow **error-fix.md** (classify → fix → re-run).

## Prefer

- Runnable output: `index.html` or `npm run dev` / `npm run build`.
- Small diffs; keep existing design unless asked.
- Document how to run in the final message.

## Common fixes

| Symptom | Action |
| --- | --- |
| MODULE_NOT_FOUND | `npm install` / add dependency |
| TS#### | fix types at file:line |
| Failed to compile (Next) | fix import / client-server boundary |
| Hydration mismatch | remove browser-only values from SSR first paint |
| Missing env | copy from `.env.example`, never invent secrets |

## Done when

- Failing command re-run succeeds, **or**
- You explain the blocker and the exact next command for the user.
