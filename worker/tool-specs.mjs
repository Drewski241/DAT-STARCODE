/**
 * Canonical tool catalog for the coding agent loop (prompt + future native tools).
 */

/** @typedef {{ name: string, description: string, args: Record<string, string> }} ToolSpec */

/** @type {ToolSpec[]} */
export const CODING_TOOL_SPECS = [
  {
    name: "list_files",
    description: "List all files in the workspace",
    args: {},
  },
  {
    name: "read_file",
    description: "Read a UTF-8 workspace file",
    args: { path: "string" },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file with full contents",
    args: { path: "string", content: "string" },
  },
  {
    name: "str_replace",
    description:
      "Exact surgical edit — oldText must match uniquely unless replaceAll",
    args: {
      path: "string",
      oldText: "string",
      newText: "string",
      replaceAll: "boolean?",
    },
  },
  {
    name: "run",
    description: "Run a short shell command in the workspace",
    args: { command: "string" },
  },
  {
    name: "npm_install",
    description: "npm install with a long timeout (optional package list)",
    args: { packages: "string?" },
  },
  {
    name: "start_server",
    description: "Start an allowlisted background dev server",
    args: { command: "string", name: "string?" },
  },
  {
    name: "stop_server",
    description: "Stop a background server started earlier",
    args: { name: "string?" },
  },
  {
    name: "server_logs",
    description: "Tail logs from a background server",
    args: { name: "string?", lines: "number?" },
  },
  {
    name: "check_url",
    description:
      "Headless HTTP GET against a localhost URL (title/status) — no desktop browser",
    args: { url: "string" },
  },
  {
    name: "web_search",
    description: "Search the public web",
    args: { query: "string" },
  },
  {
    name: "fetch_url",
    description: "Fetch a URL as truncated text",
    args: { url: "string" },
  },
  {
    name: "clvm_verify",
    description: "Compile/run ChiaLisp or evaluate CLVM",
    args: {
      program: "string",
      solution: "string?",
      mode: "brun|run",
      expect: "string?",
    },
  },
  {
    name: "spend_check",
    description: "Run named brun samples against a program",
    args: { program: "string", samples: "array" },
  },
  {
    name: "puzzle_hash",
    description: "cdv-build a .clsp and return puzzle hash / hex",
    args: { path: "string", curryArgs: "string[]?" },
  },
];

/**
 * Compact schema block for the system prompt.
 * @param {ToolSpec[]} [specs]
 */
export function formatToolSpecsForPrompt(specs = CODING_TOOL_SPECS) {
  const lines = [
    "Tool schemas (args must match):",
    ...specs.map((t) => {
      const args = Object.entries(t.args || {})
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      return `- ${t.name}(${args}) — ${t.description}`;
    }),
  ];
  return lines.join("\n");
}
