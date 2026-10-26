import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  isAllowedServerCommand,
  startBackground,
  serverLogs,
  stopBackground,
  stopAllBackground,
} from "./process-supervisor.mjs";

assert.equal(isAllowedServerCommand("npm run dev"), true);
assert.equal(isAllowedServerCommand("node server.js"), true);
assert.equal(isAllowedServerCommand("python3 -m http.server 8080"), true);
assert.equal(isAllowedServerCommand("xdg-open http://x"), false);
assert.equal(isAllowedServerCommand("rm -rf /"), false);

const root = await fs.mkdtemp(path.join(os.tmpdir(), "dsc-bg-"));
await fs.writeFile(
  path.join(root, "server.js"),
  `require('http').createServer((q,s)=>s.end('ok')).listen(0,'127.0.0.1',function(){console.log('listening '+this.address().port);});\n`,
  "utf8",
);

const started = await startBackground(root, {
  name: "web",
  command: "node server.js",
});
assert.equal(started.ok, true, started.message);
assert.ok(started.pid);

const logs = await serverLogs(root, { name: "web", lines: 20 });
assert.equal(logs.ok, true);
assert.match(String(logs.logTail), /listening/i);

const stopped = await stopBackground(root, "web");
assert.equal(stopped.ok, true);
await stopAllBackground(root);

console.log("process-supervisor.test.mjs ok");
